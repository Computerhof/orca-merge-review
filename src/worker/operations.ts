// Merge, rebase and cherry-pick as the panel starts them (E7, E9–E11): parking uncommitted changes
// first, what happens when one stops on conflicts, and what follows when one finishes (the undo
// record, parked changes back, a notification, the tests of K11). Git work lives in core/repo.ts.
import type { OrcaWorkerApi } from 'orca/worker'
import { m as core } from '../core/messages.ts'
import { UserError } from '../core/repo.ts'
import type { MergeOutcome } from '../types.ts'
import type { Jobs } from './jobs.ts'
import type { Memory, PendingMerge } from './memory.ts'
import { m } from './messages.ts'
import { projectTestCommand } from './projectTests.ts'
import { openReviewTab } from './reviewTab.ts'
import type { Resolved } from './workspaces.ts'

export interface OperationDeps {
  orca: OrcaWorkerApi
  memory: Memory
  jobs: Jobs
}

/**
 * Brings changes parked for an operation back. `careful`: not when the operation changed the same
 * files (then they stay parked and the panel offers to restore them).
 */
export async function restoreParked(deps: OperationDeps, ws: Resolved, careful: boolean): Promise<string> {
  const p = await deps.memory.parked(ws.info.id)
  if (!p) return ''
  const r = await ws.repo.unpark(p.sha, p.files, careful ? p.before : undefined)
  if (r === 'restored' || r === 'missing') await deps.memory.setParked(ws.info.id, null)
  deps.orca.log(`parked changes: ${r}`)
  return r === 'restored' ? m.parkedBack : r === 'overlap' ? m.parkedOverlap : r === 'conflict' ? m.parkedConflict : ''
}

/** K11: after a finished merge, rebase or cherry-pick the tests run by themselves when a command is set. */
export async function testAfterMerge(deps: OperationDeps, ws: Resolved, source: string | null): Promise<void> {
  const command = await projectTestCommand(deps.memory, ws)
  if (!command) return
  try {
    deps.jobs.runTests(ws, source, command)
  } catch (error) {
    deps.orca.log(`tests after merge: ${(error as Error).message}`)
  }
}

/** How the commits of a cherry-pick are named in the undo record and the stash: their short ids. */
export function pickLabel(ids: readonly string[]): string {
  const short = ids.map((id) => id.slice(0, 7))
  return short.length > 3 ? `${short.slice(0, 3).join(', ')}, …` : short.join(', ')
}

export interface OperationStart {
  /** What the undo record and the tests name: the merged branch, the rebase base, the picked commits. */
  source: string
  /** Commits it brings in (merge, cherry-pick) or rewrites (rebase), for the undo record. */
  commits: number
  /** Park uncommitted tracked changes first (E7). */
  park?: boolean
  /** The stash entry's message when parking. */
  stashMessage: string
  /** The source the review tab compares with when the operation stops on conflicts. */
  reviewSource?: string
}

/**
 * Runs an operation the panel started: parks first when asked, runs it, and then either records it
 * as pending (it stopped; parked changes wait until it is finished or aborted) or finishes it.
 */
export async function runOperation(
  deps: OperationDeps,
  ws: Resolved,
  start: OperationStart,
  run: () => Promise<MergeOutcome>
): Promise<MergeOutcome> {
  const { memory, orca } = deps
  const before = await ws.repo.head()
  const pending: PendingMerge = { source: start.source, before, commits: start.commits }
  if (start.park && (await ws.repo.dirtyFiles(true)).length) {
    const kind = await ws.repo.operation()
    if (kind) throw new UserError(kind === 'merge' ? core.mergeAlreadyRunning : core.operationRunning(kind))
    if (await memory.parked(ws.info.id)) {
      throw new UserError(m.parkedStillThere)
    }
    const parked = await ws.repo.park(start.stashMessage)
    await memory.setParked(ws.info.id, { ...parked, source: start.source, before, at: Date.now() })
  }
  let outcome: MergeOutcome
  try {
    outcome = await run()
  } catch (error) {
    // Parked changes never come back in the middle of an operation that is still under way.
    if (await ws.repo.operation().catch(() => null)) await memory.setPending(ws.info.id, pending)
    else await restoreParked(deps, ws, false).catch((e) => orca.log(`restore after failed operation: ${(e as Error).message}`))
    throw error
  }
  if (outcome.status === 'conflicts') {
    await memory.setPending(ws.info.id, pending)
    if (await memory.parked(ws.info.id)) {
      outcome = { ...outcome, message: m.parkedReturnLater(outcome.message) }
    }
    await openReviewTab(orca, ws, { view: 'overview', ...(start.reviewSource ? { source: start.reviewSource } : {}) }).catch((e) =>
      orca.log(String(e))
    )
    return outcome
  }
  return finishOperation(deps, ws, outcome, pending)
}

/**
 * After a merge, rebase or cherry-pick finished: the undo record (when HEAD moved and the plugin
 * knows where it was before), parked changes back, a notification and the tests (K11).
 */
export async function finishOperation(
  deps: OperationDeps,
  ws: Resolved,
  outcome: MergeOutcome,
  pending: PendingMerge | null
): Promise<MergeOutcome> {
  const { memory, orca } = deps
  const after = await ws.repo.head()
  const moved = outcome.status !== 'up-to-date' && (!pending || after !== pending.before)
  if (pending && moved) {
    await memory.setLastMerge(ws.info.id, { source: pending.source, before: pending.before, after, at: Date.now(), commits: pending.commits })
  }
  await memory.setPending(ws.info.id, null)
  const result = { ...outcome, message: outcome.message + (await restoreParked(deps, ws, true)) }
  if (moved) {
    void orca.host.call('notifications.show', { title: 'Merge & Review', body: result.message }).catch(() => {})
    await testAfterMerge(deps, ws, pending?.source ?? null)
  }
  return result
}

/**
 * Rebase / cherry-pick: `--continue` or `--skip`. Stops again on the next conflict (pending stays),
 * or finishes like any operation.
 */
export async function stepOperation(
  deps: OperationDeps,
  ws: Resolved,
  how: 'continue' | 'skip',
  showBase: boolean
): Promise<MergeOutcome> {
  let outcome = how === 'continue' ? await ws.repo.continueOp({ showBase }) : await ws.repo.skipOp({ showBase })
  if (outcome.status === 'conflicts') {
    if (await deps.memory.parked(ws.info.id)) outcome = { ...outcome, message: m.parkedReturnLater(outcome.message) }
    return outcome
  }
  return finishOperation(deps, ws, outcome, await deps.memory.pending(ws.info.id))
}
