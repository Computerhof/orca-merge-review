// Answers the panel's and the review tab's requests. Thin: Git work lives in core/repo.ts.
import type { OrcaWorkerApi } from 'orca/worker'
import { resolveConflictsPrompt, reviewFeedbackPrompt } from '../core/prompts.ts'
import { UserError } from '../core/repo.ts'
import type { RepoState, ReviewView } from '../types.ts'
import { deliverToAgent, type PendingSends } from './agents.ts'
import type { Memory } from './memory.ts'
import type { Monitor } from './monitor.ts'
import { openReviewTab } from './reviewTab.ts'
import type { SettingsCache } from './settings.ts'
import { findWatch, setWatch } from './watch.ts'
import type { Workspaces } from './workspaces.ts'

export interface Deps {
  orca: OrcaWorkerApi
  workspaces: Workspaces
  memory: Memory
  monitor: Monitor
  settings: SettingsCache
  pending: PendingSends
}

/** Wraps a handler so a UserError reaches the panel with its message, and the repo gets re-read. */
function guarded<I extends { workspaceId?: string }, O>(deps: Deps, fn: (input: I) => Promise<O>, refresh = false) {
  return async (input: I): Promise<O> => {
    try {
      return await fn(input)
    } catch (error) {
      if (error instanceof UserError) {
        throw Object.assign(new Error(error.message), { code: 'action_failed' })
      }
      deps.orca.log(`request failed: ${(error as Error).stack ?? error}`)
      throw error
    } finally {
      if (refresh) deps.monitor.schedule(input.workspaceId ?? null, 'request')
    }
  }
}

export function registerHandlers(deps: Deps): void {
  const { orca, workspaces, memory, monitor, settings, pending } = deps
  const touches = true

  orca.panels.handle(
    'repo.state',
    guarded(deps, async ({ workspaceId }): Promise<RepoState> => {
      let ws
      try {
        ws = await workspaces.resolve(workspaceId)
      } catch (error) {
        if (!(error instanceof UserError)) throw error
        return {
          workspace: null,
          problem: error.message,
          branch: null,
          branches: [],
          dirtyFiles: [],
          merge: null,
          sources: [],
          suggestedSource: null,
          lastMerge: null
        }
      }
      const [core, base, lastSource, lastMerge] = await Promise.all([
        ws.repo.state(),
        ws.repo.baseBranch(),
        memory.lastSource(ws.info.id),
        memory.lastMerge(ws.info.id)
      ])
      const sources = await workspaces.sources(ws, base)
      let undoable = lastMerge
      if (undoable && (core.merge || (await ws.repo.head()) !== undoable.after)) {
        undoable = null
        await memory.setLastMerge(ws.info.id, null)
      }
      const suggested =
        (lastSource && sources.some((s) => s.ref === lastSource) ? lastSource : null) ??
        (base && base !== core.branch ? base : sources[0]?.ref ?? null)
      return { ...core, workspace: ws.info, sources, suggestedSource: suggested, lastMerge: undoable }
    })
  )

  orca.panels.handle(
    'repo.compare',
    guarded(deps, async ({ workspaceId, source }) => {
      const ws = await workspaces.resolve(workspaceId)
      const result = await ws.repo.compare(source)
      await memory.setLastSource(ws.info.id, source)
      const srcWs = await workspaces.workspaceOfBranch(ws, source)
      if (srcWs) await memory.watch(srcWs.id, { targetWorkspaceId: ws.info.id, source })
      return result
    })
  )

  orca.panels.handle(
    'repo.fileDiff',
    guarded(deps, async ({ workspaceId, source, path }) =>
      (await workspaces.resolve(workspaceId)).repo.fileDiff(source, path)
    )
  )

  orca.panels.handle(
    'merge.run',
    guarded(
      deps,
      async ({ workspaceId, source, mode, message }) => {
        const ws = await workspaces.resolve(workspaceId)
        const before = await ws.repo.head()
        const commits = (await ws.repo.compare(source)).incoming.length
        const outcome = await ws.repo.merge(source, mode, message, { showBase: settings.current.showBase })
        if (outcome.status === 'conflicts') {
          await memory.setPending(ws.info.id, { source, before, commits })
          await openReviewTab(orca, ws, { view: 'overview', source }).catch((e) => orca.log(String(e)))
        } else if (outcome.status !== 'up-to-date') {
          await memory.setLastMerge(ws.info.id, { source, before, after: await ws.repo.head(), at: Date.now(), commits })
          void orca.host.call('notifications.show', { title: 'Merge & Review', body: outcome.message }).catch(() => {})
        }
        return outcome
      },
      touches
    )
  )

  orca.panels.handle(
    'merge.abort',
    guarded(
      deps,
      async ({ workspaceId }) => {
        const ws = await workspaces.resolve(workspaceId)
        await ws.repo.abort()
        await memory.setPending(ws.info.id, null)
        return { ok: true as const }
      },
      touches
    )
  )

  orca.panels.handle(
    'merge.commit',
    guarded(
      deps,
      async ({ workspaceId, message }) => {
        const ws = await workspaces.resolve(workspaceId)
        const hash = await ws.repo.commitMerge(message)
        const p = await memory.pending(ws.info.id)
        if (p) {
          await memory.setLastMerge(ws.info.id, { source: p.source, before: p.before, after: hash, at: Date.now(), commits: p.commits })
          await memory.setPending(ws.info.id, null)
        }
        void orca.host.call('notifications.show', { title: 'Merge & Review', body: 'Merge abgeschlossen.' }).catch(() => {})
        return { hash }
      },
      touches
    )
  )

  orca.panels.handle(
    'merge.undo',
    guarded(
      deps,
      async ({ workspaceId }) => {
        const ws = await workspaces.resolve(workspaceId)
        const last = await memory.lastMerge(ws.info.id)
        if (!last) throw new UserError('Hier gibt es keinen Merge, der sich rückgängig machen lässt.')
        await ws.repo.undoMerge(last.before, last.after)
        await memory.setLastMerge(ws.info.id, null)
        return { ok: true as const }
      },
      touches
    )
  )

  orca.panels.handle(
    'conflict.get',
    guarded(deps, async ({ workspaceId, path }) => (await workspaces.resolve(workspaceId)).repo.conflict(path))
  )

  orca.panels.handle(
    'conflict.resolveHunk',
    guarded(
      deps,
      async ({ workspaceId, path, index, choice }) =>
        (await workspaces.resolve(workspaceId)).repo.resolveHunk(path, index, choice),
      touches
    )
  )

  orca.panels.handle(
    'conflict.takeFile',
    guarded(
      deps,
      async ({ workspaceId, path, side }) => {
        await (await workspaces.resolve(workspaceId)).repo.takeFile(path, side)
        return { ok: true as const }
      },
      touches
    )
  )

  orca.panels.handle(
    'conflict.markResolved',
    guarded(
      deps,
      async ({ workspaceId, path }) => {
        await (await workspaces.resolve(workspaceId)).repo.markResolved(path)
        return { ok: true as const }
      },
      touches
    )
  )

  orca.panels.handle(
    'conflict.openInEditor',
    guarded(deps, async ({ workspaceId, path }) => {
      const ws = await workspaces.resolve(workspaceId)
      await ws.repo.conflict(path) // only files that are really in conflict
      await orca.host.call('editor.open', { workspaceId: ws.info.id, path })
      return { ok: true as const }
    })
  )

  orca.panels.handle(
    'review.open',
    guarded(deps, async (input) => {
      const { workspaceId, ...ticket } = input
      const ws = await workspaces.resolve(workspaceId)
      await openReviewTab(orca, ws, ticket as ReviewView)
      return { ok: true as const }
    })
  )

  orca.panels.handle(
    'agent.feedback',
    guarded(deps, async ({ workspaceId, source, path, note }) => {
      if (!note.trim()) throw new UserError('Die Anmerkung ist leer.')
      const ws = await workspaces.resolve(workspaceId)
      const target = await workspaces.workspaceOfBranch(ws, source)
      if (!target) throw new UserError(`Zu „${source}“ gibt es keinen Orca-Workspace mit Agent.`)
      const prompt = reviewFeedbackPrompt({ target: ws.row.branch ?? ws.info.name, source, path, note })
      await memory.watch(target.id, { targetWorkspaceId: ws.info.id, source })
      return deliverToAgent(orca, pending, target.id, prompt, settings.current.agent)
    })
  )

  orca.panels.handle(
    'agent.resolveConflicts',
    guarded(deps, async ({ workspaceId }) => {
      const ws = await workspaces.resolve(workspaceId)
      const st = await ws.repo.state()
      if (!st.merge) throw new UserError('Es läuft kein Merge.')
      const open = st.merge.conflicts.filter((f) => !st.merge!.markerFree.includes(f))
      if (!open.length) throw new UserError('Alle Konflikte sind schon aufgelöst.')
      const prompt = resolveConflictsPrompt({ target: st.branch ?? ws.info.name, source: st.merge.source, files: open })
      const launched = await orca.host.call('agent.launch', {
        workspaceId: ws.info.id,
        agent: settings.current.agent,
        prompt
      })
      return { how: 'launched' as const, terminalId: launched.terminalId }
    })
  )

  orca.panels.handle(
    'watch.get',
    guarded(deps, async ({ workspaceId }) => {
      const ws = await workspaces.resolve(workspaceId)
      return { watch: await findWatch(orca, ws.info.id) }
    })
  )

  orca.panels.handle(
    'watch.set',
    guarded(deps, async ({ workspaceId, enabled, remove }) => {
      const ws = await workspaces.resolve(workspaceId)
      const base = (await ws.repo.baseBranch()) ?? 'main'
      if (base === ws.row.branch && !remove) {
        throw new UserError('Dieser Workspace ist selbst die Base. Der Merge-Wächter gehört in einen Feature-Workspace.')
      }
      const watch = await setWatch(orca, ws, base, {
        enabled,
        remove,
        agent: settings.current.agent,
        schedule: settings.current.watchSchedule
      })
      return { watch }
    })
  )
}
