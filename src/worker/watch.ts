// The merge watch: an Orca automation that runs an agent on a schedule to check whether the base
// still merges cleanly into this workspace's branch. Opt-in from the panel; it never changes code.
import type { OrcaWorkerApi } from 'orca/worker'
import { mergeWatchPrompt } from '../core/prompts.ts'
import type { MergeWatch } from '../types.ts'
import type { Resolved } from './workspaces.ts'

const NAME_PREFIX = 'Merge-Wächter: '

export async function findWatch(orca: OrcaWorkerApi, workspaceId: string): Promise<MergeWatch | null> {
  const { automations } = await orca.host.call('automation.list')
  const a = automations.find(
    (x) => x.createdByThisPlugin && x.workspaceId === workspaceId && x.name.startsWith(NAME_PREFIX)
  )
  if (!a) return null
  return {
    automationId: a.id,
    base: a.name.slice(NAME_PREFIX.length).split(' → ')[0] ?? '',
    schedule: a.schedule ?? '',
    enabled: a.enabled,
    nextRunAt: a.nextRunAt
  }
}

export async function setWatch(
  orca: OrcaWorkerApi,
  ws: Resolved,
  base: string,
  options: { enabled: boolean; remove?: boolean; agent: string; schedule: string }
): Promise<MergeWatch | null> {
  const existing = await findWatch(orca, ws.info.id)
  if (options.remove) {
    if (existing) await orca.host.call('automation.delete', { automationId: existing.automationId })
    return null
  }
  if (existing) {
    await orca.host.call('automation.update', { automationId: existing.automationId, enabled: options.enabled })
    return findWatch(orca, ws.info.id)
  }
  if (!options.enabled) return null
  await orca.host.call('automation.create', {
    name: `${NAME_PREFIX}${base} → ${ws.row.branch ?? ws.info.name}`,
    prompt: mergeWatchPrompt({ base }),
    agent: options.agent,
    workspaceId: ws.info.id,
    schedule: options.schedule,
    enabled: true,
    creationKey: `merge-watch:${ws.info.id}`
  })
  return findWatch(orca, ws.info.id)
}
