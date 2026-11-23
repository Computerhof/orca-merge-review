// Keeps a cheap picture of which workspaces are mid-merge, for the status bar and the agent guard
// (a hook has 2 s and must not wait on Git). Refreshed on focus changes, after the plugin's own
// operations, after agents run git, after saves, and on a slow timer for the focused workspace.
import type { OrcaWorkerApi } from 'orca/worker'
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
    if (this.poll) clearInterval(this.poll)
    for (const t of this.timers.values()) clearTimeout(t)
  }

  /** Synchronous, for hooks. Unknown workspaces count as not merging. */
  isMerging(workspaceId: string | null | undefined): boolean {
    return !!workspaceId && !!this.snapshots.get(workspaceId)?.merging
  }

  setFocused(workspaceId: string | null): void {
    this.focused = workspaceId
    if (workspaceId) void this.refresh(workspaceId, 'focus')
    else void this.paint(null)
  }

  /** Coalesces bursts (an agent running five git commands) into one refresh. */
  schedule(workspaceId: string | null | undefined, reason: string): void {
    const id = workspaceId ?? this.focused
    if (!id) return
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
    let snap: MergeSnapshot | null = null
    try {
      const ws = await this.workspaces.resolve(workspaceId)
      const st = await ws.repo.state()
      snap = st.merge
        ? {
            merging: true,
            total: st.merge.conflicts.length,
            open: st.merge.conflicts.length - st.merge.markerFree.length,
            source: st.merge.source
          }
        : { merging: false, open: 0, total: 0, source: null }
    } catch {
      snap = null
    }
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

  private async paint(snap: MergeSnapshot | null): Promise<void> {
    try {
      if (!snap?.merging) {
        await this.orca.host.call('statusBar.update', { id: 'merge', visible: false })
        return
      }
      const ready = snap.total === 0 || snap.open === 0
      await this.orca.host.call('statusBar.update', {
        id: 'merge',
        visible: true,
        icon: ready ? 'check' : 'warning',
        tone: ready ? 'accent' : 'warning',
        text: ready
          ? 'Merge bereit zum Abschließen'
          : `Merge: ${snap.open} ${snap.open === 1 ? 'Konflikt' : 'Konflikte'} offen`,
        tooltip: `Merge von ${snap.source ?? '?'} läuft. Klicken öffnet Merge & Review.`
      })
    } catch (error) {
      this.orca.log(`status bar: ${(error as Error).message}`)
    }
  }
}
