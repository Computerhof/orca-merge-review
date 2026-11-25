// Keeps a cheap picture of which workspaces are mid-merge, for the status bar and the agent guard
// (a hook has 2 s and must not wait on Git). Refreshed on focus changes, after the plugin's own
// operations, after agents run git, after saves, and on a slow timer for the focused workspace.
import type { OrcaWorkerApi } from 'orca/worker'
import { mergeMarkersSync } from '../git/mergeMarkers.ts'
import type { JobState } from '../types.ts'
import { m } from './messages.ts'
import type { Workspaces } from './workspaces.ts'

export interface MergeSnapshot {
  merging: boolean
  open: number
  total: number
  source: string | null
}

const POLL_MS = 20_000
const DEBOUNCE_MS = 400

export class Monitor {
  private readonly snapshots = new Map<string, MergeSnapshot>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Per workspace: bumped by each refresh, so a slower older one never overwrites a newer answer. */
  private readonly runs = new Map<string, number>()
  private stopped = false
  /** The plugin's job in a workspace (tests, probe), shown in the status bar while no merge runs. */
  jobOf: (workspaceId: string) => JobState | null = () => null
  private focused: string | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private readonly orca: OrcaWorkerApi
  private readonly workspaces: Workspaces

  constructor(orca: OrcaWorkerApi, workspaces: Workspaces) {
    this.orca = orca
    this.workspaces = workspaces
  }

  start(): void {
    this.poll = setInterval(() => {
      if (this.focused) void this.refresh(this.focused, 'poll')
    }, POLL_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.poll) clearInterval(this.poll)
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  /**
   * Synchronous, for hooks. Asks the file system (Git's marker files) when the path is known, so a
   * workspace the plugin has never refreshed is covered too; else the last snapshot. Unknown
   * workspaces count as not merging.
   */
  isMerging(workspaceId: string | null | undefined): boolean {
    if (!workspaceId) return false
    const path = this.workspaces.pathOf(workspaceId)
    if (path) return mergeMarkersSync(path)
    return !!this.snapshots.get(workspaceId)?.merging
  }

  setFocused(workspaceId: string | null): void {
    this.focused = workspaceId
    if (workspaceId) void this.refresh(workspaceId, 'focus')
    else void this.paint(null)
  }

  /** Coalesces bursts (an agent running five git commands) into one refresh. */
  schedule(workspaceId: string | null | undefined, reason: string): void {
    const id = workspaceId ?? this.focused
    if (!id || this.stopped) return
    const t = this.timers.get(id)
    if (t) clearTimeout(t)
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id)
        void this.refresh(id, reason)
      }, DEBOUNCE_MS)
    )
  }

  async refresh(workspaceId: string, reason: string): Promise<MergeSnapshot | null> {
    const run = (this.runs.get(workspaceId) ?? 0) + 1
    this.runs.set(workspaceId, run)
    let snap: MergeSnapshot | null = null
    try {
      const ws = await this.workspaces.resolve(workspaceId)
      // Only the merge part: a poll must stay cheap (no status, no ref listing).
      const merge = await ws.repo.mergeSummary()
      snap = merge
        ? {
            merging: true,
            total: merge.conflicts.length,
            open: merge.conflicts.length - merge.markerFree.length,
            source: merge.source
          }
        : { merging: false, open: 0, total: 0, source: null }
    } catch {
      snap = null
    }
    if (this.stopped || this.runs.get(workspaceId) !== run) return snap
    const before = this.snapshots.get(workspaceId)
    if (snap) this.snapshots.set(workspaceId, snap)
    else this.snapshots.delete(workspaceId)
    if (workspaceId === this.focused) await this.paint(snap)
    const changed = JSON.stringify(before ?? null) !== JSON.stringify(snap)
    if (changed || reason !== 'poll') {
      this.orca.panels.post('repo.changed', { workspaceId, reason })
    }
    return snap
  }

  /** A job changed: repaint the status bar if it concerns the focused workspace. */
  repaint(workspaceId: string): void {
    if (workspaceId === this.focused) void this.paint(this.snapshots.get(workspaceId) ?? null)
  }

  /** No merge running: the status bar shows a running or failed test / probe job, else nothing. */
  private async paintJob(): Promise<void> {
    const job = this.focused ? this.jobOf(this.focused) : null
    const probe = job?.kind === 'probe'
    if (job?.status === 'running') {
      await this.orca.host.call('statusBar.update', {
        id: 'merge',
        visible: true,
        icon: 'activity',
        tone: 'accent',
        text: probe ? m.statusProbeRunning : m.statusTestsRunning,
        tooltip: job.message
      })
    } else if (job && (job.status === 'failed' || job.status === 'error' || job.status === 'conflicts')) {
      await this.orca.host.call('statusBar.update', {
        id: 'merge',
        visible: true,
        icon: 'error',
        tone: 'danger',
        text:
          job.status === 'conflicts'
            ? m.statusProbeConflicts
            : job.status === 'error'
              ? probe
                ? m.statusProbeError
                : m.statusTestsError
              : probe
                ? m.statusProbeRed
                : m.statusTestsRed,
        tooltip: m.statusJobTooltip(job.message)
      })
    } else {
      await this.orca.host.call('statusBar.update', { id: 'merge', visible: false })
    }
  }

  private async paint(snap: MergeSnapshot | null): Promise<void> {
    try {
      if (!snap?.merging) {
        await this.paintJob()
        return
      }
      const ready = snap.total === 0 || snap.open === 0
      await this.orca.host.call('statusBar.update', {
        id: 'merge',
        visible: true,
        icon: ready ? 'check' : 'warning',
        tone: ready ? 'accent' : 'warning',
        text: ready ? m.statusMergeReady : m.statusConflictsOpen(snap.open),
        tooltip: m.statusMergeTooltip(snap.source ?? '?')
      })
    } catch (error) {
      this.orca.log(`status bar: ${(error as Error).message}`)
    }
  }
}
