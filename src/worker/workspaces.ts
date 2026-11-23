// Resolves an Orca workspace to a Git repository on this machine, and lists merge sources.
import type { OrcaWorkerApi } from 'orca/worker'
import { Repo, UserError } from '../core/repo.ts'
import { localFiles } from '../git/files.ts'
import type { GitRunner } from '../git/runner.ts'
import type { AgentActivity, SourceOption, WorkspaceInfo } from '../types.ts'

type Row = {
  id: string
  kind: 'worktree' | 'folder'
  name: string
  projectId?: string | null
  path: string
  branch: string | null
  hostId: string | null
  status?: { state: AgentActivity }
}

export interface Resolved {
  info: WorkspaceInfo
  row: Row
  repo: Repo
}

const LIST_TTL_MS = 3000

export class Workspaces {
  private cache: { at: number; rows: Row[] } | null = null
  private readonly orca: OrcaWorkerApi
  private readonly runner: GitRunner

  constructor(orca: OrcaWorkerApi, runner: GitRunner) {
    this.orca = orca
    this.runner = runner
  }

  async list(fresh = false): Promise<Row[]> {
    if (!fresh && this.cache && Date.now() - this.cache.at < LIST_TTL_MS) return this.cache.rows
    const answer = await this.orca.host.call('workspace.list', { includeStatus: true })
    const rows = answer.workspaces as Row[]
    this.cache = { at: Date.now(), rows }
    return rows
  }

  async focusedId(): Promise<string | null> {
    const ctx = await this.orca.host.call('workspace.readContext')
    return ctx?.workspaceId ?? null
  }

  /** The named workspace, else the focused one. Throws a UserError the panel can show. */
  async resolve(workspaceId?: string): Promise<Resolved> {
    const id = workspaceId ?? (await this.focusedId())
    if (!id) throw new UserError('Kein Workspace geöffnet.')
    let row = (await this.list()).find((w) => w.id === id)
    if (!row) row = (await this.list(true)).find((w) => w.id === id)
    if (!row) throw new UserError('Dieser Workspace ist Orca nicht (mehr) bekannt.')
    const supported = row.hostId === 'local' || row.hostId === null
    const info: WorkspaceInfo = { id: row.id, name: row.name, path: row.path, supported, hostId: row.hostId }
    if (!supported) {
      throw new UserError('Dieser Workspace liegt auf einem entfernten Host. Merge & Review arbeitet in v0.1 nur lokal.')
    }
    const repo = await Repo.open(this.runner, localFiles, row.path)
    if (!repo) throw new UserError(`„${row.name}“ ist kein Git-Repository.`)
    return { info, row, repo }
  }

  /** Workspaces of the same project first (with agent status), then other local and remote branches. */
  async sources(current: Resolved, base: string | null): Promise<SourceOption[]> {
    const rows = await this.list()
    const branch = current.row.branch
    const seen = new Set<string>(branch ? [branch] : [])
    const out: SourceOption[] = []

    const siblings = rows.filter(
      (w) =>
        w.id !== current.row.id &&
        w.kind === 'worktree' &&
        w.branch &&
        (current.row.projectId ? w.projectId === current.row.projectId : false)
    )
    for (const w of siblings) {
      if (seen.has(w.branch!)) continue
      seen.add(w.branch!)
      out.push({
        ref: w.branch!,
        label: w.name === w.branch ? w.name : `${w.name} · ${w.branch}`,
        kind: 'workspace',
        workspaceId: w.id,
        agent: w.status?.state,
        isBase: w.branch === base
      })
    }
    const { local, remote } = await current.repo.refs()
    for (const ref of local) {
      if (seen.has(ref)) continue
      seen.add(ref)
      out.push({ ref, label: ref, kind: 'branch', isBase: ref === base })
    }
    for (const ref of remote) {
      if (seen.has(ref)) continue
      seen.add(ref)
      out.push({ ref, label: ref, kind: 'remote', isBase: ref === base })
    }
    // The base first: it is the most common thing to merge in (bring a branch up to date).
    return out.sort((a, b) => Number(!!b.isBase) - Number(!!a.isBase))
  }

  /** The workspace whose branch is `ref` in the same project, if any. */
  async workspaceOfBranch(current: Resolved, ref: string): Promise<Row | undefined> {
    return (await this.list()).find(
      (w) => w.branch === ref && w.kind === 'worktree' && w.projectId === current.row.projectId && w.id !== current.row.id
    )
  }
}
