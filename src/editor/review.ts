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
  MergeInProgress,
  RepoState,
  ReviewTicket,
  SourceOption
} from '../types.ts'
import { STYLES } from './styles.ts'
import { m } from './messages.ts'

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
  const mg = repo?.merge
  return mg ? (mg.conflicts.find((f) => !mg.markerFree.includes(f)) ?? null) : null
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
    if (r.markerFree) message = { tone: 'ok', text: m.noMarkersLeftAsk }
    render()
  })
}

async function markResolved(): Promise<void> {
  if (!selected || busy) return
  const ok = await call(() => orca.plugin.request('conflict.markResolved', { ...ws(), path: selected! }))
  if (!ok) return
  message = { tone: 'ok', text: m.fileResolved(selected) }
  selected = null
  await reload()
}

async function takeFile(side: 'ours' | 'theirs'): Promise<void> {
  if (!selected || busy) return
  const ok = await call(() => orca.plugin.request('conflict.takeFile', { ...ws(), path: selected!, side }))
  if (!ok) return
  const op = repo?.merge
  message = {
    tone: 'ok',
    text:
      op?.kind === 'rebase'
        ? side === 'ours' ? m.tookBase(selected, op.sides.ours) : m.tookCommit(selected)
        : side === 'ours' ? m.tookOurs(selected) : m.tookTheirs(selected)
  }
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
    text: r.how === 'sent' ? m.noteSent : r.how === 'resumed' ? m.noteResumed : m.noteStartedAgent
  }
  render()
  return true
}

// ------------------------------------------------------------------ rendering

function render(): void {
  root.replaceChildren(header(), body(), footer())
}

/** ` · Commit 2 von 5 (abc123 Betreff)` for a rebase or cherry-pick; empty when Git tells nothing. */
function stepLabel(op: MergeInProgress): string {
  const s = op.step
  if (!s) return op.kind === 'cherry-pick' && op.source ? m.stepCommit(op.source) : ''
  return m.stepOf(s.current, s.total, [s.commit, s.subject].filter(Boolean).join(' '))
}

function opTitle(op: MergeInProgress, branch: string): string {
  switch (op.kind) {
    case 'rebase':
      return m.rebaseTitle(op.branch ?? repo?.branch ?? null, op.source, stepLabel(op))
    case 'cherry-pick':
      return m.pickTitle(stepLabel(op))
    default:
      return `Merge ${op.source} → ${branch}`
  }
}

/**
 * Names for the two sides of a conflict, from the worker (already the right way round). During a
 * rebase Git's "ours" is the new base and "theirs" the branch's own commit being replayed, so they
 * are not "your side" / "incoming" there.
 */
function sideNames(op: MergeInProgress) {
  const { ours, theirs } = op.sides
  const rebase = op.kind === 'rebase'
  return {
    ours,
    theirs,
    oursLabel: rebase ? m.rebaseBaseSide(ours) : m.yourSide(ours),
    theirsLabel: rebase ? m.rebaseCommitSide(theirs) : m.incomingSide(theirs),
    oursButton: rebase ? m.rebaseMine : m.mine,
    theirsButton: rebase ? m.rebaseTheirs : m.incoming
  }
}

/** A commit subject can be long; buttons get a short form, the full text stays in the tooltip. */
const short = (s: string, max = 48) => (s.length > max ? s.slice(0, max - 1) + '…' : s)

function header(): HTMLElement {
  const branch = repo?.branch ?? '…'
  const title = repo?.merge
    ? opTitle(repo.merge, branch)
    : cmp
      ? `${cmp.source} → ${branch}`
      : `Merge & Review · ${branch}`
  return el(
    'header',
    { class: 'top' },
    el('div', { class: 'title' }, title),
    badge(),
    el('div', { class: 'spacer' }),
    loading ? el('span', { class: 'muted' }, m.loading) : null,
    cmp && !repo?.merge && orca.files ? button(m.exportMarkdown, exportReview, 'plain', m.exportMarkdownTip) : null,
    button(m.reload, () => void reload())
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
        message = { tone: 'ok', text: m.reviewSaved }
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
      ? el('span', { class: 'badge warn' }, m.openCount(open))
      : el('span', { class: 'badge ok' }, repo.merge.kind === 'merge' ? m.readyToFinish : m.readyToContinue)
  }
  if (!cmp) return null
  const p = cmp.preview
  if (p.upToDate) return el('span', { class: 'badge' }, m.alreadyIncluded)
  if (p.fastForward) return el('span', { class: 'badge ok' }, m.fastForward)
  if (p.clean === false) return el('span', { class: 'badge warn' }, m.conflictFilesExpected(p.conflicts.length))
  if (p.clean) return el('span', { class: 'badge ok' }, m.conflictFree)
  return null
}

function body(): HTMLElement {
  if (repo?.problem) return el('main', { class: 'empty' }, repo.problem)
  // A first load that failed shows why (the header keeps "Reload").
  if (!repo) return el('main', { class: 'empty' }, loading ? m.loadingBody : (message?.text ?? m.noData))
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
  const showMore = (total: number, label: (next: number, rest: number) => string) => {
    if (total > listLimit) {
      list.append(more(label(Math.min(LIST_PAGE, total - listLimit), total - listLimit), () => {
        listLimit += LIST_PAGE
        render()
      }))
    }
  }
  if (repo?.merge) {
    const mg = repo.merge
    const ready = new Set(mg.markerFree)
    list.append(el('div', { class: 'group' }, m.conflictsGroup(mg.conflicts.length)))
    for (const f of mg.conflicts.slice(0, listLimit)) {
      list.append(fileItem(items, f, ready.has(f) ? '✓' : '⚠', ready.has(f) ? 'ok' : 'warn'))
    }
    showMore(mg.conflicts.length, m.showMoreConflicts)
    if (!mg.conflicts.length) list.append(el('div', { class: 'muted pad' }, mg.kind === 'merge' ? m.allResolved : m.allResolvedStep))
    return list
  }
  if (!cmp) {
    list.append(el('div', { class: 'muted pad' }, m.pickSource))
    return list
  }
  const expected = new Set(cmp.preview.conflicts)
  list.append(el('div', { class: 'group' }, m.filesGroup(cmp.files.length)))
  for (const f of cmp.files.slice(0, listLimit)) {
    const delta = f.added === null ? m.binaryDelta : `+${f.added} −${f.deleted}`
    list.append(fileItem(items, f.path, f.status, expected.has(f.path) ? 'warn' : '', delta))
  }
  showMore(cmp.files.length, m.showMoreFiles)
  list.append(el('div', { class: 'group' }, m.commitsGroup(cmp.ahead)))
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
  if (repo?.merge) return conflict ? conflictView(conflict, repo.merge) : el('div', { class: 'empty' }, m.pickFile)
  if (!cmp) return el('div', { class: 'empty' }, m.pickSourceInPanel)
  if (!selected) return el('div', { class: 'empty' }, m.noChanges)
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
  box.append(el('div', { class: 'filehead' }, el('strong', {}, selected!), patchTruncated ? el('span', { class: 'muted' }, m.truncated) : null))
  if (!patchRows) {
    box.append(el('div', { class: 'muted pad' }, m.loading))
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
        title: n ? m.lineNoTip : '',
        onclick: () => {
          if (noteField && n) noteField.prefill(m.linePrefix(n))
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
    box.append(more(m.showMoreRows(Math.min(ROWS_PAGE, shown - rowLimit), shown - rowLimit), () => {
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
      ? m.notePlaceholderAgent
      : m.notePlaceholderReview,
    oninput: () => drafts.set(path, area.value)
  })
  area.value = drafts.get(path) ?? '' // the draft survives switching files and re-renders
  const node = el(
    'div',
    { class: 'note' },
    area,
    toAgent
      ? el('div', { class: 'row' }, button(m.sendToAgent, async () => {
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

function conflictView(file: ConflictFile, op: MergeInProgress): HTMLElement {
  const box = el('div', { class: 'conflict' })
  const sides = sideNames(op)
  const { ours, theirs } = sides
  box.append(
    el(
      'div',
      { class: 'filehead' },
      el('strong', {}, file.path),
      el('div', { class: 'spacer' }),
      button(m.editInEditor, () => void call(() => orca.plugin.request('conflict.openInEditor', { ...ws(), path: file.path }))),
      button(m.wholeFile(short(ours)), () => void takeFile('ours'), 'plain', sides.oursLabel),
      button(m.wholeFile(short(theirs)), () => void takeFile('theirs'), 'plain', sides.theirsLabel),
      button(m.markResolved, () => void markResolved(), file.markerFree ? 'primary' : 'plain', file.markerFree ? '' : m.markResolvedTip)
    )
  )
  if (file.wholeFileOnly) {
    box.append(
      el('div', { class: 'notice warn' },
        !file.stage.ours ? m.deletedOnChangedOn(ours, theirs) : !file.stage.theirs ? m.deletedOnChangedOn(theirs, ours) : m.binaryWholeSide
      )
    )
    return box
  }
  if (!file.hunks.length) {
    box.append(el('div', { class: 'notice ok' }, m.noMarkersLeftReview))
    return box
  }
  file.hunks.forEach((h) => box.append(hunkCard(h, file.hunks.length, sides)))
  return box
}

function hunkCard(h: ConflictHunk, total: number, sides: ReturnType<typeof sideNames>): HTMLElement {
  const side = (label: string, body: string, cls: string) =>
    el('div', { class: `side ${cls}` }, el('div', { class: 'label' }, label), el('pre', {}, body || m.emptySide))
  return el(
    'div',
    { class: 'hunk-card' },
    el('div', { class: 'hunk-title' }, m.conflictOf(h.index + 1, total)),
    el(
      'div',
      { class: `sides ${h.base !== null ? 'three' : ''}` },
      side(sides.oursLabel, h.ours, 'ours'),
      h.base !== null ? side(m.commonBase, h.base, 'base') : null,
      side(sides.theirsLabel, h.theirs, 'theirs')
    ),
    el(
      'div',
      { class: 'row' },
      button(sides.oursButton, () => void resolve(h, 'ours')),
      button(sides.theirsButton, () => void resolve(h, 'theirs')),
      button(m.both, () => void resolve(h, 'both')),
      h.base !== null ? button(m.base, () => void resolve(h, 'base')) : null
    )
  )
}

function footer(): HTMLElement {
  return el('footer', { class: 'muted small' }, m.keysHelp(VERSION))
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
    message = t ? null : { tone: 'err', text: m.invalidTicket }
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
