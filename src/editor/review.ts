// The wide review tab (custom editor for `*.mergereview`). The helper file holds a ReviewTicket;
// everything shown is loaded from the worker. File contents, commit messages and branch names
// are untrusted: they only ever reach the DOM through textContent, never as HTML.
import '../protocol.ts'
import { sideBySide } from '../core/diffview.ts'
import { defined } from '../defined.ts'
import { VERSION } from '../version.ts'
import type {
  Comparison,
  ConflictChoice,
  ConflictFile,
  ConflictHunk,
  RepoState,
  ReviewTicket,
  SourceOption
} from '../types.ts'
import { STYLES } from './styles.ts'

// ------------------------------------------------------------------ tiny DOM helpers

type Child = Node | string | null | undefined | false
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, '').toLowerCase(), v)
    else if (v === true) node.setAttribute(k, '')
    else if (v !== false) node.setAttribute(k, v)
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c)
  return node
}
const text = (s: string) => document.createTextNode(s)

function button(label: string, onClick: () => void, kind: 'primary' | 'plain' | 'danger' = 'plain', title = '') {
  return el('button', { class: `btn ${kind}`, title, onclick: () => onClick() }, label)
}

// ------------------------------------------------------------------ state

const root = el('div', { class: 'app' })
let ticket: ReviewTicket | null = null
let repo: RepoState | null = null
let cmp: Comparison | null = null
let selected: string | null = null
let conflict: ConflictFile | null = null
let message: { tone: 'ok' | 'warn' | 'err'; text: string } | null = null
let loading = false

const ws = () => defined({ workspaceId: ticket?.workspaceId })

async function call<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (error) {
    message = { tone: 'err', text: error instanceof Error ? error.message : String(error) }
    render()
    return undefined
  }
}

// ------------------------------------------------------------------ loading

async function reload(): Promise<void> {
  if (!ticket) return
  loading = true
  render()
  repo = (await call(() => orca.plugin.request('repo.state', ws(), { timeoutMs: 20_000 }))) ?? null
  const merging = !!repo?.merge
  if (merging) {
    cmp = null
    const files = repo!.merge!.conflicts
    if (!selected || !files.includes(selected)) {
      selected = ticket.view === 'conflict' && files.includes(ticket.path) ? ticket.path : (firstOpen() ?? files[0] ?? null)
    }
    conflict = selected ? ((await call(() => orca.plugin.request('conflict.get', { ...ws(), path: selected! }))) ?? null) : null
  } else {
    conflict = null
    const src = ticket.view === 'conflict' ? null : (ticket.source ?? repo?.suggestedSource ?? null)
    cmp = src ? ((await call(() => orca.plugin.request('repo.compare', { ...ws(), source: src }))) ?? null) : null
    if (ticket.view === 'diff' && !selected) selected = ticket.path
    if (cmp && (!selected || !cmp.files.some((f) => f.path === selected))) selected = cmp.files[0]?.path ?? null
    patchRows = null
    if (cmp && selected) await loadPatch()
  }
  loading = false
  render()
}

function firstOpen(): string | null {
  const m = repo?.merge
  return m ? (m.conflicts.find((f) => !m.markerFree.includes(f)) ?? null) : null
}

let patchRows: ReturnType<typeof sideBySide> | null = null
let patchTruncated = false
async function loadPatch(): Promise<void> {
  if (!cmp || !selected) return
  const r = await call(() => orca.plugin.request('repo.fileDiff', { ...ws(), source: cmp!.source, path: selected! }))
  patchRows = r ? sideBySide(r.patch) : null
  patchTruncated = !!r?.truncated
}

async function select(path: string): Promise<void> {
  selected = path
  message = null
  if (repo?.merge) {
    conflict = (await call(() => orca.plugin.request('conflict.get', { ...ws(), path }))) ?? null
  } else {
    patchRows = null
    render()
    await loadPatch()
  }
  render()
}

// ------------------------------------------------------------------ actions

async function resolve(index: number, choice: ConflictChoice): Promise<void> {
  if (!selected) return
  const r = await call(() => orca.plugin.request('conflict.resolveHunk', { ...ws(), path: selected!, index, choice }))
  if (!r) return
  conflict = r
  if (r.markerFree) message = { tone: 'ok', text: 'Keine Marker mehr in dieser Datei. Als gelöst markieren?' }
  render()
}

async function markResolved(): Promise<void> {
  if (!selected) return
  const ok = await call(() => orca.plugin.request('conflict.markResolved', { ...ws(), path: selected! }))
  if (!ok) return
  message = { tone: 'ok', text: `${selected} ist gelöst.` }
  selected = null
  await reload()
}

async function takeFile(side: 'ours' | 'theirs'): Promise<void> {
  if (!selected) return
  const ok = await call(() => orca.plugin.request('conflict.takeFile', { ...ws(), path: selected!, side }))
  if (!ok) return
  message = { tone: 'ok', text: `${selected}: ${side === 'ours' ? 'dein Stand' : 'eingehende Fassung'} übernommen.` }
  selected = null
  await reload()
}

async function sendNote(note: string, path: string | undefined): Promise<boolean> {
  if (!cmp) return false
  const r = await call(() => orca.plugin.request('agent.feedback', defined({ ...ws(), source: cmp!.source, path, note })))
  if (!r) return false
  message = {
    tone: 'ok',
    text: r.how === 'sent' ? 'An den laufenden Agenten geschickt.' : r.how === 'resumed' ? 'Session fortgesetzt, Anmerkung folgt, sobald der Agent bereit ist.' : 'Neuen Agenten mit der Anmerkung gestartet.'
  }
  render()
  return true
}

// ------------------------------------------------------------------ rendering

function render(): void {
  root.replaceChildren(header(), body(), footer())
}

function header(): HTMLElement {
  const branch = repo?.branch ?? '…'
  const title = repo?.merge
    ? `Merge ${repo.merge.source} → ${branch}`
    : cmp
      ? `${cmp.source} → ${branch}`
      : `Merge & Review · ${branch}`
  return el(
    'header',
    { class: 'top' },
    el('div', { class: 'title' }, title),
    badge(),
    el('div', { class: 'spacer' }),
    loading ? el('span', { class: 'muted' }, 'lädt …') : null,
    button('Neu laden', () => void reload())
  )
}

function badge(): HTMLElement | null {
  if (repo?.merge) {
    const open = repo.merge.conflicts.length - repo.merge.markerFree.length
    return open
      ? el('span', { class: 'badge warn' }, `${open} offen`)
      : el('span', { class: 'badge ok' }, 'bereit zum Abschließen')
  }
  if (!cmp) return null
  const p = cmp.preview
  if (p.upToDate) return el('span', { class: 'badge' }, 'schon enthalten')
  if (p.fastForward) return el('span', { class: 'badge ok' }, 'Fast-forward')
  if (p.clean === false) return el('span', { class: 'badge warn' }, `${p.conflicts.length} Konflikt-Datei(en) erwartet`)
  if (p.clean) return el('span', { class: 'badge ok' }, 'konfliktfrei')
  return null
}

function body(): HTMLElement {
  if (repo?.problem) return el('main', { class: 'empty' }, repo.problem)
  if (!repo) return el('main', { class: 'empty' }, loading ? 'Lade …' : 'Keine Daten.')
  return el('main', { class: 'split' }, sidebar(), el('section', { class: 'content' }, notice(), content()))
}

function notice(): HTMLElement | null {
  return message ? el('div', { class: `notice ${message.tone}` }, message.text) : null
}

function sidebar(): HTMLElement {
  const list = el('nav', { class: 'files' })
  if (repo?.merge) {
    const m = repo.merge
    list.append(el('div', { class: 'group' }, `Konflikte (${m.conflicts.length})`))
    for (const f of m.conflicts) {
      const ready = m.markerFree.includes(f)
      list.append(fileItem(f, ready ? '✓' : '⚠', ready ? 'ok' : 'warn'))
    }
    if (!m.conflicts.length) list.append(el('div', { class: 'muted pad' }, 'Alle gelöst. Abschließen im Panel oder mit „Merge & Review: Merge abschließen“.'))
    return list
  }
  if (!cmp) {
    list.append(el('div', { class: 'muted pad' }, 'Quelle im Panel wählen.'))
    return list
  }
  list.append(el('div', { class: 'group' }, `Dateien (${cmp.files.length})`))
  for (const f of cmp.files) {
    const warn = cmp.preview.conflicts.includes(f.path)
    const delta = f.added === null ? 'bin' : `+${f.added} −${f.deleted}`
    list.append(fileItem(f.path, f.status, warn ? 'warn' : '', delta))
  }
  list.append(el('div', { class: 'group' }, `Commits (${cmp.incoming.length})`))
  for (const c of cmp.incoming.slice(0, 100)) {
    list.append(el('div', { class: 'commit', title: `${c.author} · ${new Date(c.at).toLocaleString()}` }, el('code', {}, c.short), text(' ' + c.subject)))
  }
  return list
}

function fileItem(path: string, mark: string, tone: string, extra = ''): HTMLElement {
  return el(
    'button',
    { class: `file ${path === selected ? 'current' : ''}`, title: path, onclick: () => void select(path) },
    el('span', { class: `mark ${tone}` }, mark),
    el('span', { class: 'path' }, path),
    extra ? el('span', { class: 'muted small' }, extra) : null
  )
}

function content(): HTMLElement | null {
  if (repo?.merge) return conflict ? conflictView(conflict) : el('div', { class: 'empty' }, 'Datei links wählen.')
  if (!cmp) return el('div', { class: 'empty' }, 'Im Panel eine Quelle wählen; der Tab folgt.')
  if (!selected) return el('div', { class: 'empty' }, 'Keine Änderungen.')
  return diffView()
}

// ---- diff (side by side)

function diffView(): HTMLElement {
  const box = el('div', { class: 'diff' })
  const src = cmp!.source
  const isWorkspace = repo?.sources.some((s: SourceOption) => s.ref === src && s.kind === 'workspace')
  box.append(el('div', { class: 'filehead' }, el('strong', {}, selected!), patchTruncated ? el('span', { class: 'muted' }, ' (gekürzt)') : null))
  if (!patchRows) {
    box.append(el('div', { class: 'muted pad' }, 'lädt …'))
    return box
  }
  const table = el('table', { class: 'sbs' })
  const noteField = isWorkspace ? noteBox(selected!) : null
  for (const r of patchRows) {
    if (r.kind === 'meta') continue
    if (r.kind === 'hunk') {
      table.append(el('tr', { class: 'hunk' }, el('td', { colspan: '4' }, r.left ?? '')))
      continue
    }
    const lineNo = (n: number | null) =>
      el('td', {
        class: 'no',
        title: isWorkspace && n ? 'Klicken: Anmerkung zu dieser Zeile' : '',
        onclick: () => {
          if (noteField && n) noteField.prefill(`Zeile ${n}: `)
        }
      }, n === null ? '' : String(n))
    table.append(
      el(
        'tr',
        { class: r.kind },
        lineNo(r.leftNo),
        el('td', { class: `code ${r.left === null ? 'void' : 'old'}` }, r.left ?? ''),
        lineNo(r.rightNo),
        el('td', { class: `code ${r.right === null ? 'void' : 'new'}` }, r.right ?? '')
      )
    )
  }
  box.append(table)
  if (noteField) box.append(noteField.node)
  return box
}

function noteBox(path: string): { node: HTMLElement; prefill: (s: string) => void } {
  const area = el('textarea', { rows: '3', placeholder: 'Anmerkung an den Agenten der Quelle … (Klick auf eine Zeilennummer fügt sie ein)' })
  const node = el(
    'div',
    { class: 'note' },
    area,
    el('div', { class: 'row' }, button('An Agent senden', async () => {
      if (area.value.trim() && (await sendNote(area.value, path))) area.value = ''
    }, 'primary'))
  )
  return {
    node,
    prefill: (s) => {
      area.value = (area.value ? area.value + '\n' : '') + s
      area.focus()
    }
  }
}

// ---- conflicts

function conflictView(file: ConflictFile): HTMLElement {
  const box = el('div', { class: 'conflict' })
  const ours = repo?.branch ?? 'HEAD'
  const theirs = repo?.merge?.source ?? 'eingehend'
  box.append(
    el(
      'div',
      { class: 'filehead' },
      el('strong', {}, file.path),
      el('div', { class: 'spacer' }),
      button('Im Editor bearbeiten', () => void call(() => orca.plugin.request('conflict.openInEditor', { ...ws(), path: file.path }))),
      button(`Ganze Datei: ${ours}`, () => void takeFile('ours')),
      button(`Ganze Datei: ${theirs}`, () => void takeFile('theirs')),
      button('Als gelöst markieren', () => void markResolved(), file.markerFree ? 'primary' : 'plain', file.markerFree ? '' : 'Erst alle Blöcke auflösen')
    )
  )
  if (file.wholeFileOnly) {
    box.append(
      el('div', { class: 'notice warn' },
        !file.stage.ours ? `Auf ${ours} gelöscht, auf ${theirs} geändert.` : !file.stage.theirs ? `Auf ${theirs} gelöscht, auf ${ours} geändert.` : 'Binärdatei: nur eine ganze Seite übernehmen.'
      )
    )
    return box
  }
  if (!file.hunks.length) {
    box.append(el('div', { class: 'notice ok' }, 'Keine Konfliktmarker mehr. Prüfen und als gelöst markieren.'))
    return box
  }
  file.hunks.forEach((h) => box.append(hunkCard(h, file.hunks.length, ours, theirs)))
  return box
}

function hunkCard(h: ConflictHunk, total: number, ours: string, theirs: string): HTMLElement {
  const side = (label: string, body: string, cls: string) =>
    el('div', { class: `side ${cls}` }, el('div', { class: 'label' }, label), el('pre', {}, body || '(leer)'))
  return el(
    'div',
    { class: 'hunk-card' },
    el('div', { class: 'hunk-title' }, `Konflikt ${h.index + 1} von ${total}`),
    el(
      'div',
      { class: `sides ${h.base !== null ? 'three' : ''}` },
      side(`Dein Stand (${ours})`, h.ours, 'ours'),
      h.base !== null ? side('Gemeinsame Basis', h.base, 'base') : null,
      side(`Eingehend (${theirs})`, h.theirs, 'theirs')
    ),
    el(
      'div',
      { class: 'row' },
      button('Meins (1)', () => void resolve(h.index, 'ours')),
      button('Eingehend (2)', () => void resolve(h.index, 'theirs')),
      button('Beide (3)', () => void resolve(h.index, 'both')),
      h.base !== null ? button('Basis', () => void resolve(h.index, 'base')) : null
    )
  )
}

function footer(): HTMLElement {
  return el('footer', { class: 'muted small' }, `Merge & Review ${VERSION} · Tasten: 1 Meins · 2 Eingehend · 3 Beide (erster offener Block) · n nächste Datei`)
}

// ------------------------------------------------------------------ keys

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (repo?.merge && conflict?.hunks.length) {
    const choice = ({ '1': 'ours', '2': 'theirs', '3': 'both' } as const)[e.key as '1' | '2' | '3']
    if (choice) {
      e.preventDefault()
      void resolve(conflict.hunks[0].index, choice)
      return
    }
  }
  if (e.key === 'n') {
    const files = repo?.merge ? repo.merge.conflicts : (cmp?.files.map((f) => f.path) ?? [])
    if (!files.length) return
    const i = selected ? files.indexOf(selected) : -1
    void select(files[(i + 1) % files.length])
  }
})

// ------------------------------------------------------------------ start

async function start(): Promise<void> {
  document.head.append(el('style', {}, STYLES))
  document.body.append(root)
  render()
  const doc = await orca.document!.session<ReviewTicket | null>({
    decode: (c) => {
      if (c.kind !== 'text') return null
      try {
        const t = JSON.parse(c.text) as ReviewTicket
        return t && t.v === 1 && typeof t.workspaceId === 'string' ? t : null
      } catch {
        return null
      }
    },
    encode: (t) => ({ kind: 'text', text: JSON.stringify(t, null, 2) + '\n' })
  })
  const apply = (t: ReviewTicket | null) => {
    ticket = t
    selected = t && t.view !== 'overview' ? t.path : null
    message = t ? null : { tone: 'err', text: 'Diese Datei ist kein gültiger Merge-&-Review-Verweis.' }
    void reload()
  }
  doc.onReplace(apply)
  apply(doc.value)
  orca.plugin.on('repo.changed', ({ workspaceId }) => {
    if (!workspaceId || workspaceId === ticket?.workspaceId) void reload()
  })
}

void start()
