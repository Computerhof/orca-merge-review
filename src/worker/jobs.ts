// K11 tests after a merge and K12 probe merges run as one job per workspace, in the background:
// a panel request starts them and returns at once; the result arrives as `job.changed` and in
// `RepoState.job`, and the status bar shows it while no merge is running.
import type { OrcaWorkerApi } from 'orca/worker'
import { UserError } from '../core/repo.ts'
import { runCommand } from '../run/command.ts'
import { probeMerge } from '../run/probe.ts'
import type { GitRunner } from '../git/runner.ts'
import type { JobState } from '../types.ts'
import type { Resolved } from './workspaces.ts'

/** Tests and probes may take long; past this they are stopped. */
export const JOB_TIMEOUT_MS = 15 * 60_000

export class Jobs {
  private readonly jobs = new Map<string, JobState>()
  private readonly running = new Map<string, AbortController>()
  private readonly orca: OrcaWorkerApi
  private readonly runner: GitRunner
  /** Called after every change, e.g. to repaint the status bar. */
  onChange: (workspaceId: string) => void = () => {}

  constructor(orca: OrcaWorkerApi, runner: GitRunner) {
    this.orca = orca
    this.runner = runner
  }

  get(workspaceId: string): JobState | null {
    return this.jobs.get(workspaceId) ?? null
  }

  /** K11: runs the test command in the workspace itself (after a merge, or on request). */
  runTests(ws: Resolved, source: string | null, command: string | null): void {
    if (!command) throw new UserError('Für dieses Projekt ist kein Testbefehl festgelegt (Panel: „Tests für dieses Projekt“).')
    this.start(ws.info.id, { kind: 'tests', source, command, message: `Tests laufen: ${command}` }, async (signal) => {
      const r = await runCommand(command, ws.repo.root, { timeoutMs: JOB_TIMEOUT_MS, signal })
      const ok = r.exitCode === 0
      return {
        status: ok ? 'passed' : 'failed',
        exitCode: r.exitCode,
        tail: r.tail,
        message: ok
          ? 'Tests grün.'
          : r.timedOut
            ? 'Tests nach 15 Minuten abgebrochen.'
            : r.cancelled
              ? 'Tests abgebrochen.'
              : `Tests rot (Exit ${r.exitCode ?? '?'}).`
      }
    })
  }

  /** K12: merges `source` in a temporary worktree (and tests there); the workspace stays as it is. */
  probe(ws: Resolved, source: string, command: string | null): void {
    const what = command ? 'Probe-Merge mit Tests' : 'Probe-Merge'
    this.start(ws.info.id, { kind: 'probe', source, command, message: `${what} von ${source} läuft …` }, async (signal) => {
      const r = await probeMerge(this.runner, ws.repo.root, source, { testCommand: command, testTimeoutMs: JOB_TIMEOUT_MS, signal })
      return {
        status: r.status,
        exitCode: r.tests?.exitCode ?? null,
        tail: r.tests?.tail ?? [],
        conflicts: r.conflicts,
        message: `Probe-Merge von ${source}: ${r.message}`
      }
    })
  }

  cancel(workspaceId: string): void {
    this.running.get(workspaceId)?.abort()
  }

  dismiss(workspaceId: string): void {
    if (this.running.has(workspaceId)) throw new UserError('Läuft noch. Erst abbrechen.')
    this.jobs.delete(workspaceId)
    this.changed(workspaceId)
  }

  dispose(): void {
    for (const c of this.running.values()) c.abort()
  }

  private start(
    workspaceId: string,
    init: Pick<JobState, 'kind' | 'source' | 'command' | 'message'>,
    work: (signal: AbortSignal) => Promise<Partial<JobState> & Pick<JobState, 'status' | 'message'>>
  ): void {
    if (this.running.has(workspaceId)) throw new UserError('Hier läuft schon ein Test oder Probe-Merge.')
    const controller = new AbortController()
    this.running.set(workspaceId, controller)
    this.jobs.set(workspaceId, {
      ...init,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      exitCode: null,
      tail: [],
      conflicts: []
    })
    this.changed(workspaceId)
    void work(controller.signal)
      .catch((error: unknown) => ({ status: 'error' as const, message: (error as Error).message }))
      .then((result) => {
        this.running.delete(workspaceId)
        const before = this.jobs.get(workspaceId)
        if (!before) return
        this.jobs.set(workspaceId, { ...before, ...result, finishedAt: Date.now() })
        this.changed(workspaceId)
        this.orca.log(`${init.kind}: ${result.message}`)
        if (result.status === 'failed' || result.status === 'error' || init.kind === 'probe') {
          void this.orca.host.call('notifications.show', { title: 'Merge & Review', body: result.message }).catch(() => {})
        }
      })
  }

  private changed(workspaceId: string): void {
    this.orca.panels.post('job.changed', { workspaceId })
    this.onChange(workspaceId)
  }
}
