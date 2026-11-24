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
  Collapsible,
  EmptyState,
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
  const st = await run('Lade …', () => plugin.request('repo.state', {}), true)
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
  set(confirm, null)
  set(stale, false)
  if (!ref) {
    set(comparison, null)
    return
  }
  const head = read(state)?.head ?? null
  const c = await run('Vergleiche …', () => plugin.request('repo.compare', { source: ref }))
  if (read(source) === ref) {
    set(comparison, c ?? null)
    comparedHead = c ? head : null
  }
}

async function doMerge(): Promise<void> {
  set(confirm, null)
  const out = await run('Merge läuft …', () =>
    plugin.request('merge.run', defined({ source: read(source), mode: read(mode), message: read(message) || undefined }))
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
  run('Öffne …', () => plugin.request('review.open', defined(input)))

/** K15: to the agent of a source workspace (its terminal), else to that workspace. */
const focusAgent = (src: string) =>
  run('Wechsle …', () => plugin.request('agent.focus', { source: src }), true)

function AgentButton({ opt }: { opt: SourceOption }) {
  const live = !!opt.agent && opt.agent !== 'inactive'
  return (
    <Button size="xs" variant="ghost" icon={live ? 'agent' : 'open-external'} onPress={() => void focusAgent(opt.ref)}>
      {live ? 'Zum Agenten' : 'Workspace öffnen'}
    </Button>
  )
}

// ------------------------------------------------------------------ setup

/** The worker refreshes 400 ms after a request and then reports it; a load within this is ours. */
const ECHO_MS = 2500

export function setup(ctx: PanelContext): void {
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
    plugin.on('conflict.autoResolved', ({ workspaceId, path }) => {
      if (workspaceId === read(state)?.workspace?.id) {
        set(notice, { tone: 'success', text: `${path} ohne Konfliktmarker gespeichert und als gelöst markiert.` })
      }
    }),
    plugin.on('source.updated', ({ workspaceId, source: src }) => {
      if (workspaceId === read(state)?.workspace?.id && src === read(source)) set(stale, true)
    }),
    on('workspace.changed', () => {
      set(comparison, null)
      set(confirm, null)
      void load()
    })
  )
  void settings
    .get('defaultMode')
    .then((m) => {
      if (typeof m === 'string' && ['ff', 'no-ff', 'ff-only', 'squash'].includes(m)) set(mode, m as MergeMode)
    })
    .catch(() => {})
  void load()
}

// ------------------------------------------------------------------ pieces

/** Select values must not be empty: the "no file" choice gets a token instead. */
const GENERAL = '__general__'

const AGENT_LABEL: Record<AgentActivity, string> = {
  working: 'Agent arbeitet',
  permission: 'Agent wartet auf Freigabe',
  done: 'Agent fertig',
  active: 'Agent aktiv',
  inactive: 'Agent ruht'
}

function sourceLabel(s: SourceOption): string {
  const tag = s.isBase ? ' (Base)' : s.kind === 'workspace' ? ' (Workspace)' : s.kind === 'remote' ? ' (Remote)' : ''
  return `${s.label}${tag}`
}

function Header({ st }: { st: RepoState }) {
  const dirty = st.dirtyFiles.length
  return (
    <Row justify="between" align="center">
      <Stack gap="none">
        <Heading level={2}>{st.branch ?? 'HEAD (losgelöst)'}</Heading>
        {st.workspace && st.workspace.name !== st.branch ? (
          <Text muted size="xs" truncate>
            {st.workspace.name}
          </Text>
        ) : null}
      </Stack>
      <Row gap="xs" align="center">
        {st.merge ? (
          <Badge tone="warning">Merge läuft</Badge>
        ) : dirty ? (
          <Badge tone="warning">{`${dirty} geändert`}</Badge>
        ) : (
          <Badge tone="success">sauber</Badge>
        )}
        <IconButton icon="refresh" label="Neu laden" variant="ghost" size="sm" onPress={() => void load()} />
        <IconButton
          icon="open-external"
          label="Breiten Tab öffnen"
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
  if (p.upToDate) return <Callout tone="neutral" icon="check" title="Schon enthalten">Nichts zu mergen.</Callout>
  if (p.fastForward)
    return (
      <Callout tone="success" icon="check" title="Fast-forward möglich">
        Kein Merge-Commit nötig, keine Konflikte.
      </Callout>
    )
  if (p.unrelated)
    return (
      <Callout tone="danger" icon="error" title="Keine gemeinsame Historie">
        Die beiden Branches haben keinen gemeinsamen Vorfahren. Git verweigert diesen Merge.
      </Callout>
    )
  if (p.clean === null)
    return <Callout tone="neutral" icon="info" title="Keine Vorhersage">Git ist zu alt für merge-tree (ab 2.38).</Callout>
  if (p.clean) return <Callout tone="success" icon="check" title="Konfliktfrei vorhergesagt" />
  return (
    <Callout tone="warning" icon="warning" title={`${p.conflicts.length} Konflikt-Datei(en) erwartet`}>
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
      {st.lastMerge ? (
        <Callout tone="success" icon="check" title={`${st.lastMerge.source} übernommen`}>
          <Stack gap="xs">
            <Text size="xs">
              {`${st.lastMerge.commits} Commit(s) · `}
              <RelativeTime at={st.lastMerge.at} />
            </Text>
            {(() => {
              // K7: after merging an agent's work, its workspace is one click away (e.g. to remove it in Orca).
              const from = st.sources.find((s) => s.ref === st.lastMerge!.source && s.kind === 'workspace')
              return from ? <AgentButton opt={from} /> : null
            })()}
            {conf === 'undo' ? (
              <Row gap="xs" wrap>
                <Text size="xs" tone="danger">{`HEAD zurück auf ${st.lastMerge.before.slice(0, 8)}?`}</Text>
                <Button size="xs" tone="danger" onPress={() => act('Mache rückgängig …', () => plugin.request('merge.undo', {}), 'Merge rückgängig gemacht.')}>
                  Ja, rückgängig
                </Button>
                <Button size="xs" variant="ghost" onPress={() => set(confirm, null)}>
                  Nein
                </Button>
              </Row>
            ) : (
              <Button size="xs" variant="outline" icon="remove" onPress={() => set(confirm, 'undo')}>
                Merge rückgängig
              </Button>
            )}
          </Stack>
        </Callout>
      ) : null}

      <OverviewSection />

      <Select
        label="Quelle"
        value={src}
        placeholder="Branch oder Workspace wählen"
        options={st.sources.slice(0, 400).map((s) => ({ value: s.ref, label: sourceLabel(s) }))}
        onChange={(v) => void compare(v)}
      />
      {opt?.kind === 'workspace' ? (
        <Row gap="xs" align="center">
          {opt.agent && opt.agent !== 'inactive' ? (
            <Badge tone={opt.agent === 'working' || opt.agent === 'permission' ? 'warning' : 'neutral'}>
              {AGENT_LABEL[opt.agent]}
            </Badge>
          ) : null}
          <AgentButton opt={opt} />
        </Row>
      ) : null}
      {read(stale) ? (
        <Callout tone="accent" icon="agent" title="Agent der Quelle ist fertig">
          <Button size="xs" icon="refresh" onPress={() => void compare(src)}>
            Neu vergleichen
          </Button>
        </Callout>
      ) : null}

      {c && c.source === src ? (
        <Stack gap="sm">
          {c.preview.upToDate ? null : (
            <Text weight="medium">
              {`${c.ahead} Commit(s) kommen rein · ${c.files.length} Datei(en) · +${added} −${deleted}`}
            </Text>
          )}
          {c.behind ? <Text muted size="xs">{`${st.branch} ist ${c.behind} Commit(s) weiter als ${src}.`}</Text> : null}
          <Prediction c={c} />
          {c.preview.upToDate ? null : <Details st={st} c={c} src={src} opt={opt} />}
        </Stack>
      ) : src && read(busy) ? (
        <Spinner label="Vergleiche …" />
      ) : null}

      <WatchSection st={st} />
    </Stack>
  )
}

/** K10: every workspace of the project as seen from the base; Enter or a double click compares it. */
function OverviewSection() {
  const o = read(overview)
  if (!o?.rows.length) return null
  const ready = o.rows.filter((r) => readiness(r) === 0).length
  const conflicts = o.rows.filter((r) => readiness(r) === 1).length
  const title = `Workspaces des Projekts · ${ready} bereit` + (conflicts ? ` · ${conflicts} mit Konflikten` : '')
  return (
    <Collapsible title={title} description={`Gegen ${o.base} geprüft (merge-tree, ändert nichts).`} defaultOpen>
      <Table
        label="Workspaces des Projekts (Enter oder Doppelklick vergleicht)"
        maxHeight="md"
        columns={[
          { key: 'name', label: 'Workspace' },
          { key: 'agent', label: 'Agent', width: 'sm', hideBelow: 'sm' },
          { key: 'delta', label: 'vor/hinter', width: 'sm', align: 'end' },
          { key: 'state', label: 'Vorhersage', width: 'md' }
        ]}
        rows={o.rows.map((r) => ({
          key: r.branch,
          disabled: readiness(r) === 3,
          cells: {
            name: r.name === r.branch ? r.name : `${r.name} · ${r.branch}`,
            agent: r.agent && r.agent !== 'inactive' ? AGENT_LABEL[r.agent].replace(/^Agent /, '') : '–',
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
  const blockedBy = st.dirtyFiles.length
    ? 'Erst committen oder stashen: der Arbeitsbaum hat Änderungen.'
    : !st.branch
      ? 'HEAD ist losgelöst: erst einen Branch auschecken.'
      : null
  return (
    <Stack gap="sm">
      <Button icon="open-external" variant="outline" onPress={() => void openTab({ view: 'overview', source: src })}>
        Im breiten Tab prüfen
      </Button>

      <Collapsible title={c.ahead > c.incoming.length ? `Commits (neueste ${c.incoming.length} von ${c.ahead})` : `Commits (${c.ahead})`}>
        <Table
          label="Eingehende Commits"
          maxHeight="md"
          emptyText="Keine"
          columns={[
            { key: 'short', label: 'Commit', width: 'xs' },
            { key: 'subject', label: 'Nachricht' },
            { key: 'at', label: 'Wann', width: 'sm', hideBelow: 'sm' }
          ]}
          rows={c.incoming.map((x) => ({
            key: x.hash,
            cells: { short: x.short, subject: x.subject, at: { type: 'relative', at: x.at, format: 'short' } }
          }))}
        />
      </Collapsible>

      <Collapsible title={`Dateien (${c.files.length})`} defaultOpen>
        <Table
          label="Geänderte Dateien (Enter oder Doppelklick öffnet den Diff)"
          maxHeight="md"
          emptyText="Keine"
          columns={[
            { key: 'st', label: 'Art', width: 'xs' },
            { key: 'path', label: 'Datei' },
            { key: 'delta', label: '±', width: 'sm', align: 'end' }
          ]}
          rows={c.files.map((f) => ({
            key: f.path,
            cells: {
              st: (c.preview.conflicts.includes(f.path) ? '⚠ ' : '') + f.status,
              path: f.from ? `${f.from} → ${f.path}` : f.path,
              delta: f.added === null ? 'binär' : `+${f.added} −${f.deleted}`
            }
          }))}
          onRowAction={({ key }) => void openTab({ view: 'diff', source: src, path: key })}
        />
      </Collapsible>

      {opt?.kind === 'workspace' ? (
        <Collapsible title="Anmerkung an den Agenten der Quelle">
          <Stack gap="sm">
            <Select
              label="Datei (optional)"
              value={read(notePath) || GENERAL}
              options={[{ value: GENERAL, label: 'Allgemein' }, ...c.files.slice(0, 300).map((f) => ({ value: f.path, label: f.path }))]}
              onChange={(v) => set(notePath, v === GENERAL ? '' : v)}
            />
            <Textarea
              label="Anmerkung"
              rows={3}
              value={read(note)}
              placeholder="Was soll der Agent ändern?"
              onChange={(v) => set(note, v)}
            />
            <Button
              icon="agent"
              disabled={!read(note).trim() || working}
              onPress={async () => {
                const r = await run('Sende …', () =>
                  plugin.request('agent.feedback', defined({ source: src, path: read(notePath) || undefined, note: read(note) }))
                )
                if (r) {
                  set(note, '')
                  const how = r.how === 'sent' ? 'an den laufenden Agenten geschickt' : r.how === 'resumed' ? 'an die fortgesetzte Session übergeben' : 'an einen neuen Agenten übergeben'
                  set(notice, { tone: 'success', text: `Anmerkung ${how}. Sobald er fertig ist, meldet sich das Panel.` })
                }
              }}
            >
              An Agent senden
            </Button>
          </Stack>
        </Collapsible>
      ) : null}

      <Separator />
      <Select
        label="Art"
        value={read(mode)}
        options={[
          { value: 'no-ff', label: 'Merge-Commit (Historie bleibt sichtbar)' },
          { value: 'ff', label: 'Fast-forward, wenn möglich' },
          { value: 'ff-only', label: 'Nur Fast-forward' },
          { value: 'squash', label: 'Squash (ein Commit)' }
        ]}
        onChange={(v) => set(mode, v as MergeMode)}
      />
      {read(mode) !== 'ff-only' ? (
        <Input label="Commit-Nachricht (optional)" value={read(message)} placeholder="Standard von Git" onChange={(v) => set(message, v)} />
      ) : null}
      {blockedBy ? <Text size="xs" tone="warning">{blockedBy}</Text> : null}
      {conf === 'merge' ? (
        <Callout tone="accent" title={`${src} → ${st.branch} mergen?`}>
          <Stack gap="xs">
            <Text size="xs">
              {`${c.ahead} Commit(s), ${c.files.length} Datei(en)` +
                (c.preview.clean === false ? `, ${c.preview.conflicts.length} Konflikt-Datei(en) erwartet` : '') +
                (opt?.agent === 'working' ? '. Achtung: der Agent der Quelle arbeitet noch.' : '.')}
            </Text>
            <Row gap="xs">
              <Button tone="accent" onPress={() => void doMerge()}>
                Ja, mergen
              </Button>
              <Button variant="ghost" onPress={() => set(confirm, null)}>
                Abbrechen
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
          {`${src} → ${st.branch} mergen`}
        </Button>
      )}
    </Stack>
  )
}

function WatchSection({ st }: { st: RepoState }) {
  const w = read(watch)
  const base = st.sources.find((s) => s.isBase)
  if (!base && !w) return null
  return (
    <Collapsible title="Merge-Wächter (Orca-Automation)" description="Prüft regelmäßig per Agent, ob die Base noch sauber hereinpasst.">
      <Stack gap="sm">
        <Switch
          label={w ? `Aktiv (${w.schedule})` : 'Einrichten'}
          checked={!!w?.enabled}
          disabled={!!read(busy)}
          onChange={async (on) => {
            const r = await run('Speichere …', () => plugin.request('watch.set', { enabled: on }))
            if (r) set(watch, r.watch)
          }}
        />
        {w?.nextRunAt ? (
          <Text muted size="xs">
            {'Nächster Lauf '}
            <RelativeTime at={w.nextRunAt} />
          </Text>
        ) : null}
        {w ? (
          <Button
            size="xs"
            variant="ghost"
            tone="danger"
            onPress={async () => {
              const r = await run('Entferne …', () => plugin.request('watch.set', { enabled: false, remove: true }))
              if (r) set(watch, r.watch)
            }}
          >
            Entfernen
          </Button>
        ) : null}
      </Stack>
    </Collapsible>
  )
}

function ModeResolve({ st }: { st: RepoState }) {
  const m = st.merge!
  const open = m.conflicts.filter((f) => !m.markerFree.includes(f))
  const total = m.conflicts.length
  const conf = read(confirm)
  const finished = total === 0

  return (
    <Stack gap="md">
      <Callout
        tone={finished ? 'success' : 'warning'}
        icon={finished ? 'check' : 'warning'}
        title={finished ? 'Alle Konflikte gelöst' : `Merge ${m.source} → ${st.branch} läuft`}
      >
        {finished ? 'Prüfen und abschließen.' : `${open.length} von ${total} Datei(en) noch mit Konfliktmarkern.`}
      </Callout>

      {!finished ? (
        <Stack gap="sm">
          <Progress label="Fortschritt" value={total ? Math.round(((total - open.length) / total) * 100) : 100} />
          <List label="Konflikt-Dateien">
            {m.conflicts.map((path) => {
              const ready = m.markerFree.includes(path)
              return (
                ready ? (
                  // A pressable ListItem cannot hold buttons, so a ready file offers both as buttons.
                  <ListItem key={path} title={path} icon="check" description="keine Marker mehr">
                    <Row gap="xs">
                      <Button size="xs" variant="ghost" onPress={() => void openTab({ view: 'conflict', path })}>
                        Ansehen
                      </Button>
                      <Button size="xs" onPress={() => act('Markiere …', () => plugin.request('conflict.markResolved', { path }))}>
                        Als gelöst markieren
                      </Button>
                    </Row>
                  </ListItem>
                ) : (
                  <ListItem
                    key={path}
                    title={path}
                    icon="warning"
                    description="offen: klicken öffnet den Konflikt"
                    onPress={() => void openTab({ view: 'conflict', path })}
                  />
                )
              )
            })}
          </List>
          <Row gap="xs" wrap>
            {open[0] ? (
              <Button tone="accent" icon="next" onPress={() => void openTab({ view: 'conflict', path: open[0] })}>
                Nächsten Konflikt öffnen
              </Button>
            ) : null}
            <Button
              variant="outline"
              icon="agent"
              disabled={!open.length}
              tooltip="Startet einen Agenten mit fertigem Auftrag. Er committet nicht, du prüfst und schließt ab."
              onPress={async () => {
                const r = await run('Starte Agent …', () => plugin.request('agent.resolveConflicts', {}))
                if (r) set(notice, { tone: 'success', text: 'Agent gestartet. Das Panel aktualisiert sich, während er arbeitet.' })
              }}
            >
              Agent löst Konflikte
            </Button>
          </Row>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Input label="Commit-Nachricht (optional)" value={read(message)} placeholder="Von Git vorbereitet" onChange={(v) => set(message, v)} />
          <Button
            tone="accent"
            icon="check"
            onPress={() =>
              act('Schließe ab …', () => plugin.request('merge.commit', defined({ message: read(message) || undefined })), 'Merge abgeschlossen.')
            }
          >
            Merge abschließen
          </Button>
        </Stack>
      )}

      <Separator />
      {conf === 'abort' ? (
        <Callout tone="danger" title="Merge wirklich abbrechen?">
          <Stack gap="xs">
            <Text size="xs">Alle Auflösungen gehen verloren; der Branch steht wieder wie vor dem Merge.</Text>
            <Row gap="xs">
              <Button tone="danger" onPress={() => act('Breche ab …', () => plugin.request('merge.abort', {}), 'Merge abgebrochen.')}>
                Ja, abbrechen
              </Button>
              <Button variant="ghost" onPress={() => set(confirm, null)}>
                Weiter auflösen
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : (
        <Button variant="ghost" tone="danger" icon="close" onPress={() => set(confirm, 'abort')}>
          Merge abbrechen
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
  if (!st) return <Spinner label="Lade Repository …" />
  if (st.problem || !st.workspace) {
    return <EmptyState icon="branch" title="Merge & Review" description={st.problem ?? 'Kein Workspace geöffnet.'} />
  }
  return (
    <Stack gap="md">
      <Header st={st} />
      {n ? <Callout tone={n.tone}>{n.text}</Callout> : null}
      {b ? <Text muted size="xs">{b}</Text> : null}
      {st.merge ? <ModeResolve st={st} /> : <ModeCompare st={st} />}
      <Text muted size="xs">{`Merge & Review ${VERSION}`}</Text>
    </Stack>
  )
}
