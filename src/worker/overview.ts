// K10 "Was ist bereit?": every workspace of the project, seen from the base branch, with its
// agent's status, how far it is ahead or behind, and the merge prediction (git merge-tree).
// Results are cached per (repository, HEAD, workspace branch commit), so a reload only recomputes
// what moved; the panel stays cheap even with many agent workspaces.
import { byReadiness } from '../core/readiness.ts'
import type { Overview, OverviewRow } from '../types.ts'
import type { Resolved, Workspaces } from './workspaces.ts'

type Computed = Pick<OverviewRow, 'ahead' | 'behind' | 'preview'>

const cache = new Map<string, Computed>()
const CACHE_MAX = 500
/** Git processes at once while filling the overview. */
const PARALLEL = 4

export async function buildOverview(workspaces: Workspaces, ws: Resolved): Promise<Overview> {
  const [head, heads, rows, base] = await Promise.all([
    ws.repo.head(),
    ws.repo.branchHeads(),
    workspaces.list(),
    ws.repo.baseBranch()
  ])
  const siblings = rows.filter(
    (w) =>
      w.id !== ws.row.id &&
      w.kind === 'worktree' &&
      !!w.branch &&
      !!ws.row.projectId &&
      w.projectId === ws.row.projectId &&
      heads.has(w.branch)
  )
  const computed = await mapLimit(siblings, PARALLEL, async (w): Promise<OverviewRow> => {
    const sha = heads.get(w.branch!)!
    const key = `${ws.repo.root}|${head}|${sha}`
    let hit = cache.get(key)
    if (!hit) {
      const counts = await ws.repo.aheadBehind(head, sha)
      hit = { ...counts, preview: await ws.repo.preview(head, sha, counts) }
      remember(key, hit)
    }
    return { workspaceId: w.id, name: w.name, branch: w.branch!, agent: w.status?.state, ...hit }
  })
  return { base: base ?? ws.row.branch ?? 'HEAD', rows: computed.sort(byReadiness) }
}

function remember(key: string, value: Computed): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, value)
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
