// The wide review tab. A custom editor opens only for a file, so the worker keeps one small
// helper file per workspace (`review.mergereview`, holding a ReviewTicket as JSON) and opens it
// with editor.open. Rewriting the ticket retargets the open tab; the tab loads all content from
// the worker. The file lives inside .git when the worktree owns its git dir, else in
// `.merge-review/`, which is added to the repository's local exclude file (never committed).
import type { OrcaWorkerApi } from 'orca/worker'
import type { Resolved } from './workspaces.ts'
import type { ReviewTicket, ReviewView } from '../types.ts'

export const HELPER_NAME = 'review.mergereview'
export const FALLBACK_DIR = '.merge-review'

export async function openReviewTab(
  orca: OrcaWorkerApi,
  ws: Resolved,
  ticket: ReviewView
): Promise<void> {
  const full: ReviewTicket = { ...ticket, v: 1, workspaceId: ws.info.id }
  const gitDir = await ws.repo.gitDir()
  let relative: string
  if (gitDir.inside) {
    const dir = `${gitDir.path}/merge-review`
    await ws.repo.writeHelper(dir, HELPER_NAME, JSON.stringify(full, null, 2) + '\n')
    const rel = gitDir.path.split('\\').join('/').slice(ws.repo.root.split('\\').join('/').length + 1)
    relative = `${rel}/merge-review/${HELPER_NAME}`
  } else {
    await ws.repo.excludeLocally(`/${FALLBACK_DIR}/`)
    await ws.repo.writeHelper(`${ws.repo.root}/${FALLBACK_DIR}`, HELPER_NAME, JSON.stringify(full, null, 2) + '\n')
    relative = `${FALLBACK_DIR}/${HELPER_NAME}`
  }
  await orca.host.call('editor.open', { workspaceId: ws.info.id, path: relative })
}
