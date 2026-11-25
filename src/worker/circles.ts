// Small closed loops around a running merge (docs/UX-PLAN.md, K13–K15):
//   K13 a conflicted file saved without markers is marked resolved,
//   K14 prompts to an agent in a merging workspace get a one-line merge hint,
//   K15 "Zum Agenten" focuses the agent of a source workspace, else opens the workspace.
import type { OrcaWorkerApi, PluginHooks } from 'orca/worker'
import { countConflicts } from '../core/conflicts.ts'
import { MERGE_HINT_TAG, mergeHintPrompt } from '../core/prompts.ts'
import { relativeTo, UserError } from '../core/repo.ts'
import { mergeMarkersSync } from '../git/mergeMarkers.ts'
import { m } from './messages.ts'
import type { Monitor } from './monitor.ts'
import type { SettingsCache } from './settings.ts'
import type { Resolved, Workspaces } from './workspaces.ts'

/** Wait after `editor.save.before` until the file is on disk. */
const AFTER_SAVE_MS = 500

export interface CircleDeps {
  orca: OrcaWorkerApi
  workspaces: Workspaces
  monitor: Monitor
  settings: SettingsCache
}

// ---------------------------------------------------------------- K13

/** Called from `editor.save.before`; never refuses the save. */
export function onSave(deps: CircleDeps, e: PluginHooks['editor.save.before']['event']): void {
  const id = deps.workspaces.canonical(e.workspaceId)
  if (!id || !deps.monitor.isMerging(id)) return
  deps.monitor.schedule(id, 'save')
  if (!deps.settings.current.autoMarkResolved || countConflicts(e.text) > 0) return
  setTimeout(() => void autoMark(deps, id, e.path), AFTER_SAVE_MS)
}

async function autoMark(deps: CircleDeps, workspaceId: string, path: string): Promise<void> {
  try {
    const ws = await deps.workspaces.resolve(workspaceId)
    const rel = relativeTo(ws.repo.root, path)
    if (!rel || !(await ws.repo.unmerged()).includes(rel)) return
    await ws.repo.markResolved(rel) // checks the file on disk again; refuses if markers came back
    deps.orca.log(`auto-resolved ${rel}`)
    deps.orca.panels.post('conflict.autoResolved', { workspaceId: ws.info.id, path: rel })
    deps.monitor.schedule(ws.info.id, 'auto-resolved')
  } catch (error) {
    if (!(error instanceof UserError)) deps.orca.log(`auto-resolve: ${(error as Error).message}`)
  }
}

// ---------------------------------------------------------------- K14

type PromptEvent = PluginHooks['agent.prompt.before']['event']

/** The merge hint for this prompt's terminal, or null when its workspace is not merging. */
export async function promptHint(deps: CircleDeps, e: PromptEvent): Promise<string | null> {
  // Our own prompts (conflict agent, review notes) already say what matters; they name the plugin.
  if (!deps.settings.current.guardAgents || e.prompt.includes(MERGE_HINT_TAG) || e.prompt.includes('Merge & Review')) return null
  // Usually no workspace is merging, and this answers from the file system without any host call.
  const merging = (await deps.workspaces.list()).filter(
    (w) => (w.hostId === 'local' || w.hostId === null) && mergeMarkersSync(w.path)
  )
  for (const row of merging) {
    const { terminals } = await deps.orca.host.call('terminal.list', { workspaceId: row.id })
    if (!terminals.some((t) => t.id === e.terminalId)) continue
    const ws = await deps.workspaces.resolve(row.id)
    const merge = await ws.repo.mergeSummary()
    if (!merge) return null
    return mergeHintPrompt({ source: merge.source, open: merge.conflicts.length - merge.markerFree.length })
  }
  return null
}

// ---------------------------------------------------------------- K15

/** Focuses the agent working on `source` (its workspace), else opens that workspace. */
export async function focusAgent(deps: CircleDeps, ws: Resolved, source: string): Promise<'terminal' | 'workspace'> {
  const row = await deps.workspaces.workspaceOfBranch(ws, source)
  if (!row) throw new UserError(m.noWorkspaceForBranch(source))
  try {
    const { agents } = await deps.orca.host.call('agents.list', { workspaceId: row.id })
    const agent = agents.find((a) => a.terminalId && a.state !== 'done') ?? agents.find((a) => a.terminalId)
    if (agent?.terminalId) {
      // Show the workspace first: focusing a terminal of a workspace that is not shown can fail.
      await deps.orca.host.call('workspace.open', { workspaceId: row.id })
      const r = await deps.orca.host.call('terminal.focus', { terminalId: agent.terminalId })
      if (r.focused) return 'terminal'
      deps.orca.log(`focus agent: Orca did not focus ${agent.terminalId} (window in the background?)`)
    } else {
      deps.orca.log(`focus agent: ${agents.length} agent(s) in ${row.id}, none with a terminal`)
    }
  } catch (error) {
    deps.orca.log(`focus agent: ${(error as Error).message}`)
  }
  await deps.orca.host.call('workspace.open', { workspaceId: row.id })
  return 'workspace'
}
