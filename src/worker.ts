// The plugin's worker: wiring only. Orca starts it when the plugin is enabled (it owns a status bar
// item) and transpiles this file when it loads. Logic lives in src/core (Git) and src/worker/*.
import type { OrcaWorkerApi } from 'orca/worker'
import { commandOf, guardDecision, runsGit } from './core/gitGuard.ts'
import { LocalGitRunner } from './git/runner.ts'
import { PendingSends } from './worker/agents.ts'
import { registerHandlers } from './worker/handlers.ts'
import { Memory } from './worker/memory.ts'
import { Monitor } from './worker/monitor.ts'
import { openReviewTab } from './worker/reviewTab.ts'
import { SettingsCache } from './worker/settings.ts'
import { Workspaces } from './worker/workspaces.ts'

let monitor: Monitor | null = null

export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  const workspaces = new Workspaces(orca, new LocalGitRunner())
  const memory = new Memory(orca)
  const settings = new SettingsCache()
  const pending = new PendingSends(orca)
  monitor = new Monitor(orca, workspaces)
  const mon = monitor

  registerHandlers({ orca, workspaces, memory, monitor: mon, settings, pending })

  // --- Events: follow focus, notice agents finishing, forget removed workspaces.
  orca.events.on('workspace.changed', ({ context }) => mon.setFocused(context?.workspaceId ?? null))

  orca.events.on('agent.status.changed', async (e) => {
    pending.onStatus(e.terminalId, e.state)
    const sourceId = e.workspaceListId ?? e.workspaceId
    if (e.state !== 'done' || !sourceId) return
    const watched = (await memory.watched())[sourceId]
    if (!watched) return
    orca.panels.post('source.updated', { workspaceId: watched.targetWorkspaceId, source: watched.source })
    if (settings.current.notifyAgentDone) {
      await orca.host
        .call('notifications.show', {
          title: 'Merge & Review',
          body: `Agent in „${watched.source}“ ist fertig. Neu vergleichen?`
        })
        .catch(() => {})
    }
  })

  orca.events.on('workspace.removed', async (e) => {
    await memory.forget(e.workspaceListId ?? e.workspaceId)
  })

  // --- Hooks. The guard decides synchronously from cached state (Orca allows 2 s).
  orca.hooks.on('agent.tool.before', (e) => {
    if (!settings.current.guardAgents) return
    const command = commandOf(e.input)
    if (!command) return
    const deny = guardDecision(command, { merging: mon.isMerging(e.workspaceId) })
    if (deny) {
      orca.log(`guard: refused "${command.slice(0, 120)}"`)
      return { deny }
    }
  })

  orca.hooks.on('agent.tool.after', (e) => {
    const command = commandOf(e.input)
    if (command && runsGit(command)) mon.schedule(e.workspaceId, 'agent-git')
  })

  orca.hooks.on('editor.save.before', (e) => {
    if (mon.isMerging(e.workspaceId)) mon.schedule(e.workspaceId, 'save')
  })

  // --- Commands (palette, shortcuts, status bar).
  orca.commands.register('mergeReview.open', async () => {
    const ws = await workspaces.resolve()
    await openReviewTab(orca, ws, { view: 'overview', source: (await memory.lastSource(ws.info.id)) ?? undefined })
    return 'Merge & Review geöffnet.'
  })

  orca.commands.register('mergeReview.nextConflict', async () => {
    const ws = await workspaces.resolve()
    const st = await ws.repo.state()
    if (!st.merge) return 'Es läuft kein Merge.'
    const next = st.merge.conflicts.find((f) => !st.merge!.markerFree.includes(f))
    if (!next) return 'Alle Konflikte sind aufgelöst. Jetzt den Merge abschließen.'
    await openReviewTab(orca, ws, { view: 'conflict', path: next })
    return `Konflikt in ${next}`
  })

  orca.commands.register('mergeReview.compareBase', async () => {
    const ws = await workspaces.resolve()
    const base = await ws.repo.baseBranch()
    if (!base || base === ws.row.branch) return 'Kein anderer Base-Branch gefunden.'
    await memory.setLastSource(ws.info.id, base)
    await openReviewTab(orca, ws, { view: 'overview', source: base })
    return `Vergleich mit ${base}`
  })

  orca.commands.register('mergeReview.finish', async () => {
    const ws = await workspaces.resolve()
    const hash = await ws.repo.commitMerge()
    const p = await memory.pending(ws.info.id)
    if (p) {
      await memory.setLastMerge(ws.info.id, { source: p.source, before: p.before, after: hash, at: Date.now(), commits: p.commits })
      await memory.setPending(ws.info.id, null)
    }
    mon.schedule(ws.info.id, 'command')
    return `Merge abgeschlossen (${hash.slice(0, 8)}).`
  })

  await settings.start(orca)
  mon.start()
  mon.setFocused(await workspaces.focusedId().catch(() => null))
}

export function deactivate(): void {
  monitor?.stop()
  monitor = null
}
