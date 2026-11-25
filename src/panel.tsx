// The sidebar: navigation and decisions. Content (diffs, conflict blocks) opens in the wide
// review tab. One mode at a time, chosen by the repository state (docs/UX-PLAN.md):
//   A Compare  – no merge running: pick a source, see what comes in, merge.
//   B Resolve  – merge running with open conflicts: work through the files.
//   C Finish   – merge running, nothing unresolved: commit or abort.
import {
  atom,
  Badge,
  Button,
  Callout,
  CodeView,
  Collapsible,
  EmptyState,
  env,
  Heading,
  IconButton,
  Input,
  List,
  ListItem,
  on,
  plugin,
  Progress,
  read,
  RelativeTime,
  Row,
  Select,
  Separator,
  set,
  settings,
  Spinner,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  type PanelContext
} from 'orca'
import './protocol.ts'
import { readiness, readinessLabel } from './core/readiness.ts'
import { defined } from './defined.ts'
import { VERSION } from './version.ts'
import { localeOf, setLocale } from './i18n/index.ts'
import { m } from './panel.messages.ts'
import type {
  AgentActivity,
  Comparison,
  MergeMode,
  MergeWatch,
  Overview,
  RepoState,
  ReviewView,
  SourceOption
} from './types.ts'


type Notice = { tone: 'success' | 'warning' | 'danger' | 'neutral'; text: string } | null
type Confirm = null | 'merge' | 'abort' | 'undo'

const state = atom<RepoState | null>(null)
const comparison = atom<Comparison | null>(null)
const source = atom('source', '', { persist: 'workspace' })
const mode = atom<MergeMode>('mode', 'no-ff', { persist: 'plugin' })
const message = atom('')
const busy = atom<string | null>(null)
const notice = atom<Notice>(null)
const confirm = atom<Confirm>(null)
const stale = atom(false)
const note = atom('')
const notePath = atom('')
const watch = atom<MergeWatch | null>(null)
const overview = atom<Overview | null>(null)
/** What the person types as the project's test command, before saving; null = not edited. */
const testDraft = atom<string | null>(null)
/** Rows shown per long table; scrolling to the end shows the next page (large repositories). */
const PAGE = 200
const fileRows = atom(PAGE)
const commitRows = atom(PAGE)
const overviewRows = atom(PAGE)

// ------------------------------------------------------------------ actions

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const running = new Map<number, string>()
let taskId = 0

/** Runs one task; `busy` shows the newest running label until every task is done. */
async function run<T>(label: string, fn: () => Promise<T>, quiet = false): Promise<T | undefined> {
  const id = ++taskId
  running.set(id, label)
  set(busy, label)
  if (!quiet) set(notice, null)
  try {
    return await fn()
  } catch (error) {
    set(notice, { tone: 'danger', text: errorText(error) })
    return undefined
  } finally {
    running.delete(id)
    set(busy, [...running.values()].at(-1) ?? null)
  }
}

let loadSeq = 0
/** Bumped when a panel run starts, so a load left over from an earlier run never lands here. */
let generation = 0
/** When the panel last started a load itself; the worker's echo right after an action is skipped. */
let lastLoadAt = 0
/** HEAD the shown comparison was made against: when the branch moves, compare again. */
let comparedHead: string | null = null

async function load(): Promise<void> {
  const gen = generation
  const seq = ++loadSeq
  lastLoadAt = Date.now()
  const st = await run(m.loading, () => plugin.request('repo.state', {}), true)
  if (!st || seq !== loadSeq || gen !== generation) return
  set(state, st)
  // K10: on the base workspace, show which workspaces of the project are ready to merge.
  if (!st.merge && st.base && st.branch === st.base) void loadOverview(gen)
  else set(overview, null)
  if (st.merge) return
  const wanted = read(source)
  const pick = st.sources.some((s) => s.ref === wanted) ? wanted : (st.suggestedSource ?? '')
  if (pick !== wanted) set(source, pick)
  if (pick && (read(comparison)?.source !== pick || comparedHead !== st.head)) await compare(pick)
  void plugin.request('watch.get', {}).then((r) => set(watch, r.watch)).catch(() => {})
}

async function loadOverview(gen: number): Promise<void> {
  const o = await plugin.request('overview.list', {}).catch(() => null)
  if (gen === generation) set(overview, o)
}

async function compare(ref: string): Promise<void> {
  set(source, ref)
  set(fileRows, PAGE)
  set(commitRows, PAGE)
  set(confirm, null)
  set(stale, false)
  if (!ref) {
    set(comparison, null)
    return
  }
  const head = read(state)?.head ?? null
  const c = await run(m.comparing, () => plugin.request('repo.compare', { source: ref }))
  if (read(source) === ref) {
    set(comparison, c ?? null)
    comparedHead = c ? head : null
  }
}

async function doMerge(): Promise<void> {
  set(confirm, null)
  const park = (read(state)?.dirtyFiles.length ?? 0) > 0 || undefined
  const out = await run(park ? m.parkingAndMerging : m.merging, () =>
    plugin.request('merge.run', defined({ source: read(source), mode: read(mode), message: read(message) || undefined, park }))
  )
  if (out) set(notice, { tone: out.status === 'conflicts' ? 'warning' : 'success', text: out.message })
  set(message, '')
  set(comparison, null)
  await load()
}

async function act(label: string, fn: () => Promise<unknown>, done?: string): Promise<void> {
  set(confirm, null)
  const ok = await run(label, fn)
  if (ok !== undefined && done) set(notice, { tone: 'success', text: done })
  await load()
}

const openTab = (input: ReviewView) =>
  run(m.opening, () => plugin.request('review.open', defined(input)))

/** K15: to the agent of a source workspace (its terminal), else to that workspace. */
const focusAgent = (src: string) =>
  run(m.switching, () => plugin.request('agent.focus', { source: src }), true)

function AgentButton({ opt }: { opt: SourceOption }) {
  const live = !!opt.agent && opt.agent !== 'inactive'
  return (
    <Button size="xs" variant="ghost" icon={live ? 'agent' : 'open-external'} onPress={() => void focusAgent(opt.ref)}>
      {live ? m.goToAgent : m.openWorkspace}
    </Button>
  )
}

// ------------------------------------------------------------------ setup

/** The worker refreshes 400 ms after a request and then reports it; a load within this is ours. */
const ECHO_MS = 2500

export function setup(ctx: PanelContext): void {
  // Orca's UI language for this panel's texts; the worker learns it too (status bar, refusals).
  setLocale(localeOf(env.locale))
  void plugin.request('ui.locale', { locale: env.locale }).catch(() => {})
  generation++
  loadSeq = 0
  lastLoadAt = 0
  comparedHead = null
  running.clear()
  ctx.subscriptions.push(
    plugin.on('repo.changed', ({ workspaceId, reason }) => {
      // `workspace.changed` below already loads on focus; a request echo follows our own load.
      if (reason === 'focus' || (reason === 'request' && Date.now() - lastLoadAt < ECHO_MS)) return
      const mine = read(state)?.workspace?.id
      if (!workspaceId || !mine || workspaceId === mine) void load()
    }),
    plugin.on('job.changed', ({ workspaceId }) => {
      if (workspaceId === read(state)?.workspace?.id) void load()
    }),
    plugin.on('conflict.autoResolved', ({ workspaceId, path }) => {
      if (workspaceId === read(state)?.workspace?.id) {
        set(notice, { tone: 'success', text: m.autoResolved(path) })
      }
    }),
    plugin.on('source.updated', ({ workspaceId, source: src }) => {
      if (workspaceId === read(state)?.workspace?.id && src === read(source)) set(stale, true)
    }),
    on('workspace.changed', () => {
      set(testDraft, null)
      set(comparison, null)
      set(confirm, null)
      void load()
    })
  )
  void settings
    .get('defaultMode')
    .then((v) => {
      if (typeof v === 'string' && ['ff', 'no-ff', 'ff-only', 'squash'].includes(v)) set(mode, v as MergeMode)
    })
    .catch(() => {})
  void load()
}

// ------------------------------------------------------------------ pieces

/** Select values must not be empty: the "no file" choice gets a token instead. */
const GENERAL = '__general__'

/** The activity as a text; `short` leaves out the word "Agent" (table cell under an "Agent" column). */
function agentLabel(a: AgentActivity, short = false): string {
  switch (a) {
    case 'working':
      return short ? m.agentShortWorking : m.agentWorking
    case 'permission':
      return short ? m.agentShortPermission : m.agentPermission
    case 'done':
      return short ? m.agentShortDone : m.agentDone
    case 'active':
      return short ? m.agentShortActive : m.agentActive
    case 'inactive':
      return short ? m.agentShortInactive : m.agentInactive
  }
}

function sourceLabel(s: SourceOption): string {
  const tag = s.isBase ? m.tagBase : s.kind === 'workspace' ? m.tagWorkspace : s.kind === 'remote' ? m.tagRemote : ''
  return `${s.label}${tag}`
}

function Header({ st }: { st: RepoState }) {
  const dirty = st.dirtyFiles.length
  return (
    <Row justify="between" align="center">
      <Stack gap="none">
        <Heading level={2}>{st.branch ?? m.detachedHead}</Heading>
        {st.workspace && st.workspace.name !== st.branch ? (
          <Text muted size="xs" truncate>
            {st.workspace.name}
          </Text>
        ) : null}
      </Stack>
      <Row gap="xs" align="center">
        {st.merge ? (
          <Badge tone="warning">{m.mergeRunning}</Badge>
        ) : dirty ? (
          <Badge tone="warning">{m.changedCount(dirty)}</Badge>
        ) : (
          <Badge tone="success">{m.clean}</Badge>
        )}
        <IconButton icon="refresh" label={m.reload} variant="ghost" size="sm" onPress={() => void load()} />
        <IconButton
          icon="open-external"
          label={m.openWideTab}
          variant="ghost"
          size="sm"
          onPress={() => void openTab({ view: 'overview', source: read(source) || undefined })}
        />
      </Row>
    </Row>
  )
}

function Prediction({ c }: { c: Comparison }) {
  const p = c.preview
  if (p.upToDate) return <Callout tone="neutral" icon="check" title={m.alreadyIncluded}>{m.nothingToMerge}</Callout>
  if (p.fastForward)
    return (
      <Callout tone="success" icon="check" title={m.fastForwardPossible}>
        {m.fastForwardBody}
      </Callout>
    )
  if (p.unrelated)
    return (
      <Callout tone="danger" icon="error" title={m.noCommonHistory}>
        {m.noCommonHistoryBody}
      </Callout>
    )
  if (p.clean === null)
    return <Callout tone="neutral" icon="info" title={m.noPrediction}>{m.noPredictionBody}</Callout>
  if (p.clean) return <Callout tone="success" icon="check" title={m.predictedClean} />
  return (
    <Callout tone="warning" icon="warning" title={m.conflictFilesExpected(p.conflicts.length)}>
      <Text size="xs">{p.conflicts.slice(0, 8).join(', ') + (p.conflicts.length > 8 ? ' …' : '')}</Text>
    </Callout>
  )
}

function ModeCompare({ st }: { st: RepoState }) {
  const c = read(comparison)
  const src = read(source)
  const opt = st.sources.find((s) => s.ref === src)
  const conf = read(confirm)
  const working = !!read(busy)
  const added = c?.files.reduce((n, f) => n + (f.added ?? 0), 0) ?? 0
  const deleted = c?.files.reduce((n, f) => n + (f.deleted ?? 0), 0) ?? 0

  return (
    <Stack gap="md">
      <DirtyCard st={st} />
      <ParkedCard st={st} />
      {st.lastMerge ? (
        <Callout tone="success" icon="check" title={m.lastMergeTitle(st.lastMerge.source)}>
          <Stack gap="xs">
            <Text size="xs">
              {m.commitsDot(st.lastMerge.commits)}
              <RelativeTime at={st.lastMerge.at} />
            </Text>
            {(() => {
              // K7: after merging an agent's work, its workspace is one click away (e.g. to remove it in Orca).
              const from = st.sources.find((s) => s.ref === st.lastMerge!.source && s.kind === 'workspace')
              return from ? <AgentButton opt={from} /> : null
            })()}
            {conf === 'undo' ? (
              <Row gap="xs" wrap>
                <Text size="xs" tone="danger">{m.undoHeadBack(st.lastMerge.before.slice(0, 8))}</Text>
                <Button size="xs" tone="danger" onPress={() => act(m.undoing, () => plugin.request('merge.undo', {}), m.mergeUndone)}>
                  {m.undoYes}
                </Button>
                <Button size="xs" variant="ghost" onPress={() => set(confirm, null)}>
                  {m.undoNo}
                </Button>
              </Row>
            ) : (
              <Button size="xs" variant="outline" icon="remove" onPress={() => set(confirm, 'undo')}>
                {m.undoMerge}
              </Button>
            )}
          </Stack>
        </Callout>
      ) : null}

      <OverviewSection />

      <Select
        label={m.source}
        value={src}
        placeholder={m.sourcePlaceholder}
        options={st.sources.slice(0, 400).map((s) => ({ value: s.ref, label: sourceLabel(s) }))}
        onChange={(v) => void compare(v)}
      />
      {opt?.kind === 'workspace' ? (
        <Row gap="xs" align="center">
          {opt.agent && opt.agent !== 'inactive' ? (
            <Badge tone={opt.agent === 'working' || opt.agent === 'permission' ? 'warning' : 'neutral'}>
              {agentLabel(opt.agent)}
            </Badge>
          ) : null}
          <AgentButton opt={opt} />
        </Row>
      ) : null}
      {read(stale) ? (
        <Callout tone="accent" icon="agent" title={m.sourceAgentDone}>
          <Button size="xs" icon="refresh" onPress={() => void compare(src)}>
            {m.compareAgain}
          </Button>
        </Callout>
      ) : null}

      {c && c.source === src ? (
        <Stack gap="sm">
          {c.preview.upToDate ? null : (
            <Text weight="medium">
              {m.incomingSummary(c.ahead, c.files.length, added, deleted)}
            </Text>
          )}
          {c.behind ? <Text muted size="xs">{m.branchAhead(st.branch, c.behind, src)}</Text> : null}
          <Prediction c={c} />
          {c.preview.upToDate ? null : <Details st={st} c={c} src={src} opt={opt} />}
        </Stack>
      ) : src && read(busy) ? (
        <Spinner label={m.comparing} />
      ) : null}

      <TestSection st={st} />
      <WatchSection st={st} />
    </Stack>
  )
}

/** Uncommitted tracked changes: say plainly that they block a plain merge, and what to do. */
function DirtyCard({ st }: { st: RepoState }) {
  const n = st.dirtyFiles.length
  if (!n || st.merge) return null
  return (
    <Callout tone="warning" icon="warning" title={m.dirtyTitle(n)}>
      <Stack gap="xs">
        <Text size="xs">{st.dirtyFiles.slice(0, 6).join(', ') + (n > 6 ? ` … (+${n - 6})` : '')}</Text>
        <Text size="xs">
          {m.dirtyBody}
        </Text>
        <Button size="xs" variant="outline" icon="branch" onPress={() => void run(m.opening, () => plugin.request('ui.sourceControl', {}), true)}>
          {m.showSourceControl}
        </Button>
      </Stack>
    </Callout>
  )
}

/** Changes parked for an earlier merge that did not come back by themselves. */
function ParkedCard({ st }: { st: RepoState }) {
  const p = st.parked
  if (!p || st.merge) return null
  return (
    <Callout tone="accent" icon="info" title={m.parkedTitle(p.files.length)}>
      <Stack gap="xs">
        <Text size="xs">{p.files.slice(0, 6).join(', ') + (p.files.length > 6 ? ' …' : '')}</Text>
        <Text size="xs" muted>
          {m.parkedBody(p.source)}
        </Text>
        <Button
          size="xs"
          tone="accent"
          onPress={async () => {
            const r = await run(m.restoring, () => plugin.request('stash.restore', {}))
            if (r) {
              set(notice, r.result === 'conflict'
                ? { tone: 'warning', text: m.restoredWithConflicts }
                : { tone: 'success', text: m.restoredClean })
            }
            await load()
          }}
        >
          {m.restoreParked}
        </Button>
      </Stack>
    </Callout>
  )
}

/** K11/K12: the running or last test run / probe merge here, with the next sensible step. */
/** An agent this panel started that never began: Orca did not send its prompt. */
function StalledAgentCard({ st }: { st: RepoState }) {
  if (!st.stalledAgent) return null
  return (
    <Callout tone="warning" title={m.stalledTitle}>
      <Stack gap="sm">
        <Text size="sm">
          {m.stalledBody}
        </Text>
        <Row gap="sm">
          <Button size="sm" icon="agent" onPress={() => void act(m.typingTask, () => plugin.request('agent.retryPrompt', {}), m.taskSent)}>
            {m.typeTask}
          </Button>
          <Button size="sm" variant="ghost" onPress={() => void act('…', () => plugin.request('agent.dismissStalled', {}))}>
            {m.dismiss}
          </Button>
        </Row>
      </Stack>
    </Callout>
  )
}

function JobCard({ st }: { st: RepoState }) {
  const job = st.job
  if (!job) return null
  const dismiss = (
    <Button size="xs" variant="ghost" icon="close" onPress={() => act('…', () => plugin.request('job.dismiss', {}))}>
      {m.dismiss}
    </Button>
  )
  if (job.status === 'running') {
    return (
      <Callout tone="accent" icon="activity" title={job.message}>
        <Row gap="xs" align="center" wrap>
          <Text size="xs" muted>
            {m.startedAgo}
            <RelativeTime at={job.startedAt} />
          </Text>
          <Button size="xs" variant="ghost" tone="danger" onPress={() => act(m.cancelling, () => plugin.request('job.cancel', {}))}>
            {m.cancel}
          </Button>
        </Row>
      </Callout>
    )
  }
  if (job.status === 'conflicts') {
    return (
      <Callout tone="warning" icon="warning" title={job.message}>
        <Stack gap="xs">
          <Text size="xs">{job.conflicts.slice(0, 10).join(', ') + (job.conflicts.length > 10 ? ' …' : '')}</Text>
          <Text size="xs" muted>{m.jobConflictsBody}</Text>
          {dismiss}
        </Stack>
      </Callout>
    )
  }
  if (job.status === 'passed' || job.status === 'clean') {
    const probeReady = job.kind === 'probe' && job.source && !st.merge
    return (
      <Callout tone="success" icon="check" title={job.message}>
        <Row gap="xs" wrap>
          {probeReady ? (
            <Button
              size="xs"
              tone="accent"
              icon="branch"
              onPress={async () => {
                await compare(job.source!)
                set(confirm, 'merge')
              }}
            >
              {m.mergeForReal}
            </Button>
          ) : null}
          {dismiss}
        </Row>
      </Callout>
    )
  }
  // failed or error
  const red = job.status === 'failed'
  return (
    <Callout tone="danger" icon="error" title={job.message}>
      <Stack gap="xs">
        {job.tail.length ? <CodeView label={m.lastOutput} code={job.tail.join('\n')} maxHeight="sm" wrap /> : null}
        <Row gap="xs" wrap>
          {red && job.kind === 'tests' ? (
            <Button
              size="xs"
              icon="agent"
              onPress={async () => {
                const r = await run(m.startingAgent, () => plugin.request('tests.fix', {}))
                if (r) set(notice, { tone: 'success', text: m.agentStartedFix })
              }}
            >
              {m.agentFixes}
            </Button>
          ) : null}
          {job.command ? (
            <Button size="xs" variant="outline" icon="terminal" onPress={() => void run(m.openingTerminal, () => plugin.request('tests.terminal', {}))}>
              {m.showInTerminal}
            </Button>
          ) : null}
          {job.kind === 'tests' ? (
            <Button size="xs" variant="ghost" icon="refresh" onPress={() => act(m.startingTests, () => plugin.request('tests.run', {}))}>
              {m.retry}
            </Button>
          ) : null}
          {dismiss}
        </Row>
        {red && job.kind === 'tests' && st.lastMerge ? (
          <Text size="xs" muted>{m.orUndoAbove}</Text>
        ) : null}
      </Stack>
    </Callout>
  )
}

/** K10: every workspace of the project as seen from the base; Enter or a double click compares it. */
function OverviewSection() {
  const o = read(overview)
  if (!o?.rows.length) return null
  const ready = o.rows.filter((r) => readiness(r) === 0).length
  const conflicts = o.rows.filter((r) => readiness(r) === 1).length
  const title = m.overviewTitle(ready, conflicts)
  return (
    <Collapsible title={title} description={m.overviewDescription(o.base)} defaultOpen>
      <Table
        label={m.overviewLabel}
        maxHeight="md"
        columns={[
          { key: 'name', label: m.colWorkspace },
          { key: 'agent', label: m.colAgent, width: 'sm', hideBelow: 'sm' },
          { key: 'delta', label: m.colAheadBehind, width: 'sm', align: 'end' },
          { key: 'state', label: m.colPrediction, width: 'md' }
        ]}
        hasMore={o.rows.length > read(overviewRows)}
        onLoadMore={() => set(overviewRows, read(overviewRows) + PAGE)}
        rows={o.rows.slice(0, read(overviewRows)).map((r) => ({
          key: r.branch,
          disabled: readiness(r) === 3,
          cells: {
            name: r.name === r.branch ? r.name : `${r.name} · ${r.branch}`,
            agent: r.agent && r.agent !== 'inactive' ? agentLabel(r.agent, true) : '–',
            delta: `+${r.ahead} / −${r.behind}`,
            state: readinessLabel(r)
          }
        }))}
        onRowAction={({ key }) => void compare(key)}
      />
    </Collapsible>
  )
}

/** Everything below the prediction: what comes in, notes to the agent, and the merge itself. */
function Details({ st, c, src, opt }: { st: RepoState; c: Comparison; src: string; opt: SourceOption | undefined }) {
  const conf = read(confirm)
  const working = !!read(busy)
  const expected = new Set(c.preview.conflicts)
  const dirty = st.dirtyFiles.length
  const blockedBy = !st.branch
    ? m.blockedDetached
    : st.parked
      ? m.blockedParked
      : null
  return (
    <Stack gap="sm">
      <Button icon="open-external" variant="outline" onPress={() => void openTab({ view: 'overview', source: src })}>
        {m.reviewInWideTab}
      </Button>

      <Collapsible title={c.ahead > c.incoming.length ? m.commitsTitleLatest(c.incoming.length, c.ahead) : m.commitsTitle(c.ahead)}>
        <Table
          label={m.incomingCommits}
          maxHeight="md"
          emptyText={m.none}
          columns={[
            { key: 'short', label: m.colCommit, width: 'xs' },
            { key: 'subject', label: m.colMessage },
            { key: 'at', label: m.colWhen, width: 'sm', hideBelow: 'sm' }
          ]}
          hasMore={c.incoming.length > read(commitRows)}
          onLoadMore={() => set(commitRows, read(commitRows) + PAGE)}
          rows={c.incoming.slice(0, read(commitRows)).map((x) => ({
            key: x.hash,
            cells: { short: x.short, subject: x.subject, at: { type: 'relative', at: x.at, format: 'short' } }
          }))}
        />
      </Collapsible>

      <Collapsible title={m.filesTitle(c.files.length)} defaultOpen>
        <Table
          label={m.changedFiles}
          maxHeight="md"
          emptyText={m.none}
          columns={[
            { key: 'st', label: m.colKind, width: 'xs' },
            { key: 'path', label: m.colFile },
            { key: 'delta', label: '±', width: 'sm', align: 'end' }
          ]}
          hasMore={c.files.length > read(fileRows)}
          onLoadMore={() => set(fileRows, read(fileRows) + PAGE)}
          rows={c.files.slice(0, read(fileRows)).map((f) => ({
            key: f.path,
            cells: {
              st: (expected.has(f.path) ? '⚠ ' : '') + f.status,
              path: f.from ? `${f.from} → ${f.path}` : f.path,
              delta: f.added === null ? m.binary : `+${f.added} −${f.deleted}`
            }
          }))}
          onRowAction={({ key }) => void openTab({ view: 'diff', source: src, path: key })}
        />
      </Collapsible>

      {opt?.kind === 'workspace' ? (
        <Collapsible title={m.noteTitle}>
          <Stack gap="sm">
            <Select
              label={m.noteFile}
              value={read(notePath) || GENERAL}
              options={[{ value: GENERAL, label: m.noteGeneral }, ...c.files.slice(0, 300).map((f) => ({ value: f.path, label: f.path }))]}
              onChange={(v) => set(notePath, v === GENERAL ? '' : v)}
            />
            <Textarea
              label={m.noteLabel}
              rows={3}
              value={read(note)}
              placeholder={m.notePlaceholder}
              onChange={(v) => set(note, v)}
            />
            <Button
              icon="agent"
              disabled={!read(note).trim() || working}
              onPress={async () => {
                const r = await run(m.sending, () =>
                  plugin.request('agent.feedback', defined({ source: src, path: read(notePath) || undefined, note: read(note) }))
                )
                if (r) {
                  set(note, '')
                  set(notice, { tone: 'success', text: m.noteSent(r.how) })
                }
              }}
            >
              {m.sendToAgent}
            </Button>
          </Stack>
        </Collapsible>
      ) : null}

      <Separator />
      <Select
        label={m.modeLabel}
        value={read(mode)}
        options={[
          { value: 'no-ff', label: m.modeNoFf },
          { value: 'ff', label: m.modeFf },
          { value: 'ff-only', label: m.modeFfOnly },
          { value: 'squash', label: m.modeSquash }
        ]}
        onChange={(v) => set(mode, v as MergeMode)}
      />
      {read(mode) !== 'ff-only' ? (
        <Input label={m.commitMessage} value={read(message)} placeholder={m.commitMessageDefault} onChange={(v) => set(message, v)} />
      ) : null}
      {blockedBy ? <Text size="xs" tone="warning">{blockedBy}</Text> : null}
      <Button
        variant="outline"
        icon="play"
        disabled={working || st.job?.status === 'running'}
        tooltip={m.probeTooltip(src, st.testCommand)}
        onPress={async () => {
          const r = await run(m.probing, () => plugin.request('merge.probe', { source: src }))
          if (r) void load()
        }}
      >
        {st.testCommand ? m.probeWithTests : m.probe}
      </Button>
      {conf === 'merge' ? (
        <Callout tone="accent" title={m.confirmMergeTitle(src, st.branch)}>
          <Stack gap="xs">
            <Text size="xs">
              {m.confirmSummary(c.ahead, c.files.length, c.preview.clean === false ? c.preview.conflicts.length : null, opt?.agent === 'working')}
            </Text>
            {dirty ? (
              <Text size="xs" tone="warning">
                {m.confirmParkNote(dirty)}
              </Text>
            ) : null}
            <Row gap="xs">
              <Button tone="accent" onPress={() => void doMerge()}>
                {dirty ? m.yesParkAndMerge : m.yesMerge}
              </Button>
              <Button variant="ghost" onPress={() => set(confirm, null)}>
                {m.cancel}
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : (
        <Button
          tone="accent"
          icon="branch"
          disabled={!!blockedBy || working}
          tooltip={blockedBy ?? undefined}
          onPress={() => set(confirm, 'merge')}
        >
          {dirty ? m.parkAndMerge(src) : m.mergeInto(src, st.branch)}
        </Button>
      )}
    </Stack>
  )
}

/** K11: the project's test command; runs after every merge here and in the probe merge. */
function TestSection({ st }: { st: RepoState }) {
  const draft = read(testDraft)
  const value = draft ?? st.testCommand ?? ''
  const changed = draft !== null && draft.trim() !== (st.testCommand ?? '')
  const project = st.projectName ?? st.workspace?.name ?? m.thisProject
  const save = async (command: string) => {
    const r = await run(m.saving, () => plugin.request('project.setTestCommand', { command }))
    if (r) {
      set(testDraft, null)
      set(notice, { tone: 'success', text: r.testCommand ? m.testCommandSaved(project, r.testCommand) : m.testCommandRemoved(project) })
      await load()
    }
  }
  const suggestion = st.suggestedTest && st.suggestedTest.command !== st.testCommand ? st.suggestedTest : null
  return (
    <Collapsible
      title={st.testCommand ? m.testsTitle(project, st.testCommand) : m.testsTitleNone(project)}
      description={m.testsDescription}
      defaultOpen={!st.testCommand && !!suggestion}
    >
      <Stack gap="sm">
        <Input
          label={m.testCommand}
          value={value}
          placeholder={st.suggestedTest?.command ?? m.testCommandPlaceholder}
          onChange={(v) => set(testDraft, v)}
          onSubmit={(v) => void save(v)}
        />
        <Row gap="xs" wrap>
          <Button size="xs" disabled={!changed} onPress={() => void save(value)}>
            {m.save}
          </Button>
          {suggestion ? (
            <Button size="xs" variant="outline" tooltip={suggestion.because} onPress={() => void save(suggestion.command)}>
              {m.useSuggestion(suggestion.command)}
            </Button>
          ) : null}
          {st.testCommand ? (
            <Button size="xs" variant="ghost" icon="play" disabled={st.job?.status === 'running'} onPress={() => act(m.startingTests, () => plugin.request('tests.run', {}))}>
              {m.runNow}
            </Button>
          ) : null}
          {st.testCommand ? (
            <Button size="xs" variant="ghost" tone="danger" onPress={() => void save('')}>
              {m.remove}
            </Button>
          ) : null}
        </Row>
      </Stack>
    </Collapsible>
  )
}

function WatchSection({ st }: { st: RepoState }) {
  const w = read(watch)
  const base = st.sources.find((s) => s.isBase)
  if (!base && !w) return null
  return (
    <Collapsible title={m.watchTitle} description={m.watchDescription}>
      <Stack gap="sm">
        <Switch
          label={w ? m.watchActive(w.schedule) : m.watchSetUp}
          checked={!!w?.enabled}
          disabled={!!read(busy)}
          onChange={async (on) => {
            const r = await run(m.saving, () => plugin.request('watch.set', { enabled: on }))
            if (r) set(watch, r.watch)
          }}
        />
        {w?.nextRunAt ? (
          <Text muted size="xs">
            {m.nextRun}
            <RelativeTime at={w.nextRunAt} />
          </Text>
        ) : null}
        {w ? (
          <Button
            size="xs"
            variant="ghost"
            tone="danger"
            onPress={async () => {
              const r = await run(m.removing, () => plugin.request('watch.set', { enabled: false, remove: true }))
              if (r) set(watch, r.watch)
            }}
          >
            {m.remove}
          </Button>
        ) : null}
      </Stack>
    </Collapsible>
  )
}

function ModeResolve({ st }: { st: RepoState }) {
  const mg = st.merge!
  const open = mg.conflicts.filter((f) => !mg.markerFree.includes(f))
  const total = mg.conflicts.length
  const conf = read(confirm)
  const finished = total === 0

  return (
    <Stack gap="md">
      <Callout
        tone={finished ? 'success' : 'warning'}
        icon={finished ? 'check' : 'warning'}
        title={finished ? m.allResolved : m.mergeInProgress(mg.source, st.branch)}
      >
        {finished ? m.reviewAndFinish : m.stillWithMarkers(open.length, total)}
      </Callout>

      {!finished ? (
        <Stack gap="sm">
          <Progress label={m.progress} value={total ? Math.round(((total - open.length) / total) * 100) : 100} />
          <List label={m.conflictFiles}>
            {mg.conflicts.map((path) => {
              const ready = mg.markerFree.includes(path)
              return (
                ready ? (
                  // A pressable ListItem cannot hold buttons, so a ready file offers both as buttons.
                  <ListItem key={path} title={path} icon="check" description={m.noMarkersLeft}>
                    <Row gap="xs">
                      <Button size="xs" variant="ghost" onPress={() => void openTab({ view: 'conflict', path })}>
                        {m.view}
                      </Button>
                      <Button size="xs" onPress={() => act(m.marking, () => plugin.request('conflict.markResolved', { path }))}>
                        {m.markResolved}
                      </Button>
                    </Row>
                  </ListItem>
                ) : (
                  <ListItem
                    key={path}
                    title={path}
                    icon="warning"
                    description={m.openClickToOpen}
                    onPress={() => void openTab({ view: 'conflict', path })}
                  />
                )
              )
            })}
          </List>
          <Row gap="xs" wrap>
            {open[0] ? (
              <Button tone="accent" icon="next" onPress={() => void openTab({ view: 'conflict', path: open[0] })}>
                {m.openNextConflict}
              </Button>
            ) : null}
            <Button
              variant="outline"
              icon="agent"
              disabled={!open.length}
              tooltip={m.resolveTooltip}
              onPress={async () => {
                const r = await run(m.startingAgent, () => plugin.request('agent.resolveConflicts', {}))
                if (r) set(notice, { tone: 'success', text: m.agentStartedResolve })
              }}
            >
              {m.agentResolves}
            </Button>
          </Row>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Input label={m.commitMessage} value={read(message)} placeholder={m.commitMessagePrepared} onChange={(v) => set(message, v)} />
          <Button
            tone="accent"
            icon="check"
            onPress={() =>
              act(m.finishing, () => plugin.request('merge.commit', defined({ message: read(message) || undefined })), m.mergeCompleted)
            }
          >
            {m.completeMerge}
          </Button>
        </Stack>
      )}

      <Separator />
      {conf === 'abort' ? (
        <Callout tone="danger" title={m.abortTitle}>
          <Stack gap="xs">
            <Text size="xs">{m.abortBody}</Text>
            <Row gap="xs">
              <Button tone="danger" onPress={() => act(m.aborting, () => plugin.request('merge.abort', {}), m.mergeAborted)}>
                {m.yesAbort}
              </Button>
              <Button variant="ghost" onPress={() => set(confirm, null)}>
                {m.keepResolving}
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : (
        <Button variant="ghost" tone="danger" icon="close" onPress={() => set(confirm, 'abort')}>
          {m.abortMerge}
        </Button>
      )}
    </Stack>
  )
}

// ------------------------------------------------------------------ root

export default function Panel() {
  const st = read(state)
  const n = read(notice)
  const b = read(busy)
  if (!st) {
    // A first load that failed would otherwise spin forever: show why, with a way to try again.
    if (n?.tone === 'danger' && !b) {
      return (
        <Stack gap="sm">
          <Callout tone="danger">{n.text}</Callout>
          <Button icon="refresh" onPress={() => void load()}>
            {m.loadAgain}
          </Button>
        </Stack>
      )
    }
    return <Spinner label={m.loadingRepository} />
  }
  if (st.problem || !st.workspace) {
    return <EmptyState icon="branch" title="Merge & Review" description={st.problem ?? m.noWorkspace} />
  }
  return (
    <Stack gap="md">
      <Header st={st} />
      {n ? <Callout tone={n.tone}>{n.text}</Callout> : null}
      {b ? <Text muted size="xs">{b}</Text> : null}
      <StalledAgentCard st={st} />
      <JobCard st={st} />
      {st.merge ? <ModeResolve st={st} /> : <ModeCompare st={st} />}
      <Text muted size="xs">{`Merge & Review ${VERSION}`}</Text>
    </Stack>
  )
}
