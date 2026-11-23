// What the plugin remembers per workspace, in its own storage (storage:own). Plain JSON only.
import type { OrcaWorkerApi } from 'orca/worker'
import type { LastMerge } from '../types.ts'

/** A merge started from this plugin; `before` is HEAD at the start, for undo. */
export interface PendingMerge {
  source: string
  before: string
  commits: number
}

/** A source workspace someone compared against: its agent finishing makes the comparison stale. */
export interface Watched {
  targetWorkspaceId: string
  source: string
}

const key = {
  lastSource: (ws: string) => `lastSource:${ws}`,
  lastMerge: (ws: string) => `lastMerge:${ws}`,
  pending: (ws: string) => `pendingMerge:${ws}`,
  watched: 'watchedSources'
}

export class Memory {
  private readonly orca: OrcaWorkerApi

  constructor(orca: OrcaWorkerApi) {
    this.orca = orca
  }

  private async get<T>(k: string): Promise<T | null> {
    return ((await this.orca.storage.get(k)) as T | null) ?? null
  }

  private async put(k: string, value: unknown): Promise<void> {
    if (value === null) await this.orca.storage.delete(k)
    else await this.orca.storage.set(k, value as never)
  }

  lastSource = (ws: string) => this.get<string>(key.lastSource(ws))
  setLastSource = (ws: string, source: string) => this.put(key.lastSource(ws), source)

  lastMerge = (ws: string) => this.get<LastMerge>(key.lastMerge(ws))
  setLastMerge = (ws: string, m: LastMerge | null) => this.put(key.lastMerge(ws), m)

  pending = (ws: string) => this.get<PendingMerge>(key.pending(ws))
  setPending = (ws: string, p: PendingMerge | null) => this.put(key.pending(ws), p)

  async watched(): Promise<Record<string, Watched>> {
    return (await this.get<Record<string, Watched>>(key.watched)) ?? {}
  }

  async watch(sourceWorkspaceId: string, w: Watched): Promise<void> {
    const all = await this.watched()
    all[sourceWorkspaceId] = w
    await this.put(key.watched, all)
  }

  /** Drops everything about a workspace Orca removed. */
  async forget(ws: string): Promise<void> {
    for (const k of [key.lastSource(ws), key.lastMerge(ws), key.pending(ws)]) await this.put(k, null)
    const all = await this.watched()
    let changed = false
    for (const [src, w] of Object.entries(all)) {
      if (src === ws || w.targetWorkspaceId === ws) {
        delete all[src]
        changed = true
      }
    }
    if (changed) await this.put(key.watched, all)
  }
}
