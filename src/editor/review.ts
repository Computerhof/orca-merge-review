// The wide review tab (custom editor for `*.mergereview`). The helper file holds a ReviewTicket;
// everything shown is loaded from the worker. File contents, commit messages and branch names
// are untrusted: they only ever reach the DOM through textContent, never as HTML.
import '../protocol.ts'
import { sideBySide } from '../core/diffview.ts'
import { reviewMarkdown, type ReviewNote } from '../core/reviewExport.ts'
import { defined } from '../defined.ts'
import { VERSION } from '../version.ts'
import { localeOf, setLocale } from '../i18n/index.ts'
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
/** Bumped by every reload and selection; an answer for an older one is dropped. */
let seq = 0
/** A conflict action is in flight: keys and buttons wait instead of acting on a stale view. */
let busy = false

/** Notes written in this tab: drafts per file (kept while switching files) and those already sent. */
const drafts = new Map<string, string>()
const sentNotes: ReviewNote[] = []

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

/** When the tab last reloaded on its own; the worker's echo of its action right after is skipped. */
let lastReloadAt = 0

async function reload(): Promise<void> {
  if (!ticket) return
  lastReloadAt = Date.now()
  const my = ++seq
  const t = ticket
  loading = true
  render()
  const nextRepo = (await call(() => orca.plugin.request('repo.state', ws(), { timeoutMs: 20_000 }))) ?? null
  if (my !== seq) return
  repo = nextRepo
  if (repo?.merge) {
    cmp = null
    const files = repo.merge.conflicts
    if (!selected || !files.includes(selected)) {
      selected = t.view === 'conflict' && files.includes(t.path) ? t.path : (firstOpen() ?? files[0] ?? null)
    }
    const path = selected
    const next = path ? ((await call(() => orca.plugin.request('conflict.get', { ...ws(), path }))) ?? null) : null
    if (my !== seq) return
    conflict = next
  } else {
    conflict = null
    const src = t.view === 'conflict' ? null : (t.source ?? repo?.suggestedSource ?? null)
    const next = src ? ((await call(() => orca.plugin.request('repo.compare', { ...ws(), source: src }))) ?? null) : null
    if (my !== seq) return
    cmp = next
    if (t.view === 'diff' && !selected) selected = t.path
    if (cmp && (!selected || !cmp.files.some((f) => f.path === selected))) selected = cmp.files[0]?.path ?? null
    patchRows = null
    if (cmp && selected && !(await loadPatch(my))) return
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
/** Loads the selected file's patch; false when a newer reload or selection took over meanwhile. */
async function loadPatch(my: number): Promise<boolean> {
  if (!cmp || !selected) return true
  const file = cmp.files.find((f) => f.path === selected)
  const r = await call(() =>
    orca.plugin.request('repo.fileDiff', defined({ ...ws(), source: cmp!.source, path: selected!, from: file?.from }))
  )
  if (my !== seq) return false
  patchRows = r ? sideBySide(r.patch) : null
  patchTruncated = !!r?.truncated
  rowLimit = ROWS_PAGE
  return true
}

async function select(path: string): Promise<void> {
  if (busy) return
  const my = ++seq
  selected = path
  message = null
  if (repo?.merge) {
    conflict = null
    render()
    const next = (await call(() => orca.plugin.request('conflict.get', { ...ws(), path }))) ?? null
    if (my !== seq) return
    conflict = next
  } else {
    patchRows = null
    render()
    if (!(await loadPatch(my))) return
  }
  render()
}

/** Runs one conflict action at a time, against the file that is on screen. */
async function exclusive(fn: () => Promise<void>): Promise<void> {
  if (busy) return
  busy = true
  try {
    await fn()
  } finally {
    busy = false
  }
}

// ------------------------------------------------------------------ actions

async function resolve(h: ConflictHunk, choice: ConflictChoice): Promise<void> {
  const shown = conflict
  if (!shown || shown.path !== selected) return
  await exclusive(async () => {
    // `expect` lets the worker refuse if the block changed meanwhile (an agent editing the file).
    const r = await call(() =>
      orca.plugin.request('conflict.resolveHunk', {
        ...ws(),
        path: shown.path,
        index: h.index,
        choice,
        expect: { ours: h.ours, theirs: h.theirs }
      })
    )
    if (!r) {
      await reload() // e.g. the block changed under us: show the file as it is now
      return
    }
    if (selected !== shown.path) return
    conflict = r
    if (r.markerFree) message = { tone: 'ok', text: 'Keine Marker mehr in dieser Datei. Als gelöst markieren?' }
    render()
  })
}

async function markResolved(): Promise<void> {
  if (!selected || busy) return
  const ok = await call(() => orca.plugin.request('conflict.markResolved', { ...ws(), path: selected! }))
  if (!ok) return
  message = { tone: 'ok', text: `${selected} ist gelöst.` }
  selected = null
  await reload()
}

async function takeFile(side: 'ours' | 'theirs'): Promise<void> {
  if (!selected || busy) return
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
  sentNotes.push({ path: path ?? null, text: note, sent: true })
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
    cmp && !repo?.merge && orca.files ? button('Als Markdown speichern', exportReview, 'plain', 'Vergleich, Commits, Dateien und Anmerkungen, z. B. für einen PR-Text') : null,
    button('Neu laden', () => void reload())
  )
}

/** Runs inside the click: Orca's save dialog needs the person's gesture. */
function exportReview(): void {
  if (!cmp || !orca.files) return
  const notes: ReviewNote[] = [
    ...sentNotes,
    ...[...drafts].filter(([, text]) => text.trim()).map(([path, text]) => ({ path, text, sent: false }))
  ]
  const md = reviewMarkdown({ target: repo?.branch ?? 'HEAD', comparison: cmp, notes, at: Date.now(), version: VERSION })
  const name = `review-${cmp.source.replace(/[^A-Za-z0-9._-]+/g, '-')}.md`
  orca.files
    .saveAs({ suggestedName: name, mimeType: 'text/markdown', data: md })
    .then((r) => {
      if (r.status === 'saved') {
        message = { tone: 'ok', text: 'Review als Markdown gespeichert.' }
        render()
      }
    })
    .catch((error: unknown) => {
      message = { tone: 'err', text: error instanceof Error ? error.message : String(error) }
      render()
    })
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
  // A first load that failed shows why (the header keeps "Neu laden").
  if (!repo) return el('main', { class: 'empty' }, loading ? 'Lade …' : (message?.text ?? 'Keine Daten.'))
  return el('main', { class: 'split' }, sidebar(), el('section', { class: 'content' }, notice(), content()))
}

// ---- large repositories: long lists are cut into pages, and unchanged parts are not rebuilt

/** Files listed per page in the sidebar, and diff rows drawn per page. */
const LIST_PAGE = 500
const ROWS_PAGE = 3000
let listLimit = LIST_PAGE
let rowLimit = ROWS_PAGE

const sameKey = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** The sidebar is rebuilt only when its data changes; choosing a file just moves the highlight. */
let sidebarCache: { key: unknown[]; node: HTMLElement; items: Map<string, HTMLElement> } | null = null

function more(label: string, onClick: () => void): HTMLElement {
  return el('div', { class: 'pad' }, button(label, onClick))
}

function notice(): HTMLElement | null {
  return message ? el('div', { class: `notice ${message.tone}` }, message.text) : null
}

function sidebar(): HTMLElement {
  const key = [repo?.merge, cmp, listLimit]
  if (!sidebarCache || !sameKey(sidebarCache.key, key)) {
    const items = new Map<string, HTMLElement>()
    sidebarCache = { key, node: buildSidebar(items), items }
  }
  for (const [path, item] of sidebarCache.items) item.classList.toggle('current', path === selected)
  return sidebarCache.node
}

function buildSidebar(items: Map<string, HTMLElement>): HTMLElement {
  const list = el('nav', { class: 'files' })
  const showMore = (total: number, what: string) => {
    if (total > listLimit) {
      list.append(more(`Weitere ${Math.min(LIST_PAGE, total - listLimit)} von ${total - listLimit} ${what} zeigen`, () => {
        listLimit += LIST_PAGE
        render()
      }))
    }
  }
  if (repo?.merge) {
    const m = repo.merge
    const ready = new Set(m.markerFree)
    list.append(el('div', { class: 'group' }, `Konflikte (${m.conflicts.length})`))
    for (const f of m.conflicts.slice(0, listLimit)) {
      list.append(fileItem(items, f, ready.has(f) ? '✓' : '⚠', ready.has(f) ? 'ok' : 'warn'))
    }
    showMore(m.conflicts.length, 'Konflikten')
    if (!m.conflicts.length) list.append(el('div', { class: 'muted pad' }, 'Alle gelöst. Abschließen im Panel oder mit „Merge & Review: Merge abschließen“.'))
    return list
  }
  if (!cmp) {
    list.append(el('div', { class: 'muted pad' }, 'Quelle im Panel wählen.'))
    return list
  }
  const expected = new Set(cmp.preview.conflicts)
  list.append(el('div', { class: 'group' }, `Dateien (${cmp.files.length})`))
  for (const f of cmp.files.slice(0, listLimit)) {
    const delta = f.added === null ? 'bin' : `+${f.added} −${f.deleted}`
    list.append(fileItem(items, f.path, f.status, expected.has(f.path) ? 'warn' : '', delta))
  }
  showMore(cmp.files.length, 'Dateien')
  list.append(el('div', { class: 'group' }, `Commits (${cmp.ahead})`))
  for (const c of cmp.incoming.slice(0, 100)) {
    list.append(el('div', { class: 'commit', title: `${c.author} · ${new Date(c.at).toLocaleString()}` }, el('code', {}, c.short), text(' ' + c.subject)))
  }
  return list
}

function fileItem(items: Map<string, HTMLElement>, path: string, mark: string, tone: string, extra = ''): HTMLElement {
  const item = el(
    'button',
    { class: 'file', title: path, onclick: () => void select(path) },
    el('span', { class: `mark ${tone}` }, mark),
    el('span', { class: 'path' }, path),
    extra ? el('span', { class: 'muted small' }, extra) : null
  )
  items.set(path, item)
  return item
}

function content(): HTMLElement | null {
  if (repo?.merge) return conflict ? conflictView(conflict) : el('div', { class: 'empty' }, 'Datei links wählen.')
  if (!cmp) return el('div', { class: 'empty' }, 'Im Panel eine Quelle wählen; der Tab folgt.')
  if (!selected) return el('div', { class: 'empty' }, 'Keine Änderungen.')
  return diffView()
}

// ---- diff (side by side)

/** The diff of the shown file is built once; a message or a re-render reuses it. */
let diffCache: { key: unknown[]; node: HTMLElement } | null = null

function diffView(): HTMLElement {
  const src = cmp!.source
  const isWorkspace = !!repo?.sources.some((s: SourceOption) => s.ref === src && s.kind === 'workspace')
  const key = [patchRows, selected, rowLimit, isWorkspace, patchTruncated]
  if (patchRows && diffCache && sameKey(diffCache.key, key)) return diffCache.node
  const box = el('div', { class: 'diff' })
  box.append(el('div', { class: 'filehead' }, el('strong', {}, selected!), patchTruncated ? el('span', { class: 'muted' }, ' (gekürzt)') : null))
  if (!patchRows) {
    box.append(el('div', { class: 'muted pad' }, 'lädt …'))
    return box
  }
  const table = el('table', { class: 'sbs' })
  const noteField = noteBox(selected!, isWorkspace)
  let drawn = 0
  const shown = patchRows.filter((r) => r.kind !== 'meta').length
  for (const r of patchRows) {
    if (r.kind === 'meta') continue
    if (++drawn > rowLimit) break
    if (r.kind === 'hunk') {
      table.append(el('tr', { class: 'hunk' }, el('td', { colspan: '4' }, r.left ?? '')))
      continue
    }
    const lineNo = (n: number | null) =>
      el('td', {
        class: 'no',
        title: n ? 'Klicken: Anmerkung zu dieser Zeile' : '',
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
  if (shown > rowLimit) {
    box.append(more(`Weitere ${Math.min(ROWS_PAGE, shown - rowLimit)} von ${shown - rowLimit} Zeilen zeigen`, () => {
      rowLimit += ROWS_PAGE
      render()
    }))
  }
  box.append(noteField.node)
  diffCache = { key, node: box }
  return box
}

function noteBox(path: string, toAgent: boolean): { node: HTMLElement; prefill: (s: string) => void } {
  const area = el('textarea', {
    rows: '3',
    placeholder: toAgent
      ? 'Anmerkung an den Agenten der Quelle … (Klick auf eine Zeilennummer fügt sie ein)'
      : 'Review-Notiz zu dieser Datei … (Klick auf eine Zeilennummer fügt sie ein; „Als Markdown speichern“ nimmt sie mit)',
    oninput: () => drafts.set(path, area.value)
  })
  area.value = drafts.get(path) ?? '' // the draft survives switching files and re-renders
  const node = el(
    'div',
    { class: 'note' },
    area,
    toAgent
      ? el('div', { class: 'row' }, button('An Agent senden', async () => {
          if (area.value.trim() && (await sendNote(area.value, path))) {
            area.value = ''
            drafts.delete(path)
          }
        }, 'primary'))
      : null
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
      button('Meins (1)', () => void resolve(h, 'ours')),
      button('Eingehend (2)', () => void resolve(h, 'theirs')),
      button('Beide (3)', () => void resolve(h, 'both')),
      h.base !== null ? button('Basis', () => void resolve(h, 'base')) : null
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
      void resolve(conflict.hunks[0], choice)
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

type Typography = { cssFontFamily: string; fontSize: number; lineHeight: number }

/** Code in the tab looks like code in Orca's editor (font, size, line height, zoom included). */
function applyTypography(t: Typography): void {
  const s = document.documentElement.style
  s.setProperty('--mr-code-font', t.cssFontFamily)
  s.setProperty('--mr-code-size', `${t.fontSize}px`)
  // Monaco's convention: 0 = automatic, below 8 a multiple of the font size, else pixels.
  s.setProperty('--mr-code-line', t.lineHeight <= 0 ? 'normal' : t.lineHeight < 8 ? String(t.lineHeight) : `${t.lineHeight}px`)
}

async function start(): Promise<void> {
  setLocale(localeOf(orca.locale))
  document.head.append(el('style', {}, STYLES))
  if (orca.host.has('editor.readTypography')) {
    orca.host.call('editor.readTypography').then(applyTypography).catch(() => {})
    orca.on('editor.typography.changed', applyTypography)
  }
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
  orca.plugin.on('repo.changed', ({ workspaceId, reason }) => {
    if (reason === 'request' && Date.now() - lastReloadAt < 2500) return
    if (!workspaceId || workspaceId === ticket?.workspaceId) void reload()
  })
}

void start()
