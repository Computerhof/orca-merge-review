// Answers the panel's and the review tab's requests. Thin: Git work lives in core/repo.ts.
import type { OrcaWorkerApi } from 'orca/worker'
import { m as core } from '../core/messages.ts'
import { resolveConflictsPrompt, reviewFeedbackPrompt, testFixPrompt } from '../core/prompts.ts'
import { UserError } from '../core/repo.ts'
import type { RepoState, ReviewView } from '../types.ts'
import { deliverToAgent, launchAgent, type PendingSends } from './agents.ts'
import { getLocale, localeOf, setLocale } from '../i18n/index.ts'
import type { Memory } from './memory.ts'
import { m } from './messages.ts'
import type { Monitor } from './monitor.ts'
import { openReviewTab } from './reviewTab.ts'
import type { SettingsCache } from './settings.ts'
import { focusAgent } from './circles.ts'
import type { Jobs } from './jobs.ts'
import { buildOverview } from './overview.ts'
import { projectKey, projectTestCommand, suggestTestCommand } from './projectTests.ts'
import { findWatch, setWatch } from './watch.ts'
import type { Resolved, Workspaces } from './workspaces.ts'

export interface Deps {
  orca: OrcaWorkerApi
  workspaces: Workspaces
  memory: Memory
  monitor: Monitor
  settings: SettingsCache
  pending: PendingSends
  jobs: Jobs
}

/** Wraps a handler so a UserError reaches the panel with its message, and the repo gets re-read. */
function guarded<I extends { workspaceId?: string }, O>(deps: Deps, fn: (input: I) => Promise<O>, refresh = false) {
  // `plugin.request(name)` without input arrives as null.
  return async (raw: I | null | undefined): Promise<O> => {
    const input = (raw ?? {}) as I
    try {
      return await fn(input)
    } catch (error) {
      if (error instanceof UserError) {
        deps.orca.log(`refused: ${error.message}`)
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
  const { orca, workspaces, memory, monitor, settings, pending, jobs } = deps

  /**
   * Brings changes parked for a merge back. `careful`: not when the merge changed the same files
   * (then they stay parked and the panel offers to restore them).
   */
  const restoreParked = async (ws: Resolved, careful: boolean): Promise<string> => {
    const p = await memory.parked(ws.info.id)
    if (!p) return ''
    const r = await ws.repo.unpark(p.sha, p.files, careful ? p.before : undefined)
    if (r === 'restored' || r === 'missing') await memory.setParked(ws.info.id, null)
    orca.log(`parked changes: ${r}`)
    return r === 'restored'
      ? m.parkedBack
      : r === 'overlap'
        ? m.parkedOverlap
        : r === 'conflict'
          ? m.parkedConflict
          : ''
  }
  /** K11: after a successful merge, the tests run by themselves when a command is set. */
  const testAfterMerge = async (ws: Resolved, source: string | null) => {
    const command = await projectTestCommand(memory, ws)
    if (!command) return
    try {
      jobs.runTests(ws, source, command)
    } catch (error) {
      orca.log(`tests after merge: ${(error as Error).message}`)
    }
  }
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
          base: null,
          problem: error.message,
          branch: null,
          head: null,
          branches: [],
          dirtyFiles: [],
          merge: null,
          sources: [],
          suggestedSource: null,
          lastMerge: null,
          parked: null,
          job: null,
          testCommand: null,
          suggestedTest: null,
          projectName: null,
          stalledAgent: null
        }
      }
      // One ref listing serves the state, the base guess and the source list.
      const refs = await ws.repo.refs()
      const [core, base, lastSource, lastMerge] = await Promise.all([
        ws.repo.state(refs),
        ws.repo.baseBranch(refs),
        memory.lastSource(ws.info.id),
        memory.lastMerge(ws.info.id)
      ])
      const sources = await workspaces.sources(ws, base, refs)
      let undoable = lastMerge
      if (undoable && (core.merge || core.head !== undoable.after)) {
        undoable = null
        await memory.setLastMerge(ws.info.id, null)
      }
      const suggested =
        (lastSource && sources.some((s) => s.ref === lastSource) ? lastSource : null) ??
        (base && base !== core.branch ? base : sources[0]?.ref ?? null)
      return {
        ...core,
        workspace: ws.info,
        base,
        sources,
        suggestedSource: suggested,
        lastMerge: undoable,
        parked: await memory.parked(ws.info.id).then((p) => (p ? { files: p.files, source: p.source, at: p.at } : null)),
        job: jobs.get(ws.info.id),
        testCommand: await projectTestCommand(memory, ws),
        suggestedTest: await suggestTestCommand(ws),
        projectName: ws.row.project ?? null,
        stalledAgent: pending.stalledOf(ws.info.id)
      }
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
    guarded(deps, async ({ workspaceId, source, path, from }) =>
      (await workspaces.resolve(workspaceId)).repo.fileDiff(source, path, 'HEAD', from)
    )
  )

  orca.panels.handle(
    'merge.run',
    guarded(
      deps,
      async ({ workspaceId, source, mode, message, park }) => {
        const ws = await workspaces.resolve(workspaceId)
        const before = await ws.repo.head()
        await ws.repo.verify(source)
        const { ahead: commits } = await ws.repo.aheadBehind('HEAD', source)
        if (park && (await ws.repo.dirtyFiles(true)).length) {
          if (await ws.repo.mergeSummary()) throw new UserError(core.mergeAlreadyRunning)
          if (await memory.parked(ws.info.id)) {
            throw new UserError(m.parkedStillThere)
          }
          const parked = await ws.repo.park(m.stashMessage(source))
          await memory.setParked(ws.info.id, { ...parked, source, before, at: Date.now() })
        }
        let outcome
        try {
          outcome = await ws.repo.merge(source, mode, message, { showBase: settings.current.showBase })
        } catch (error) {
          await restoreParked(ws, false).catch((e) => orca.log(`restore after failed merge: ${(e as Error).message}`))
          throw error
        }
        if (outcome.status === 'conflicts') {
          await memory.setPending(ws.info.id, { source, before, commits })
          if (await memory.parked(ws.info.id)) {
            outcome = { ...outcome, message: m.parkedReturnLater(outcome.message) }
          }
          await openReviewTab(orca, ws, { view: 'overview', source }).catch((e) => orca.log(String(e)))
        } else {
          if (outcome.status !== 'up-to-date') {
            await memory.setLastMerge(ws.info.id, { source, before, after: await ws.repo.head(), at: Date.now(), commits })
          }
          outcome = { ...outcome, message: outcome.message + (await restoreParked(ws, true)) }
          if (outcome.status !== 'up-to-date') {
            void orca.host.call('notifications.show', { title: 'Merge & Review', body: outcome.message }).catch(() => {})
            await testAfterMerge(ws, source)
          }
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
        await restoreParked(ws, true)
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
        const note = await restoreParked(ws, true)
        void orca.host.call('notifications.show', { title: 'Merge & Review', body: m.mergeDoneNotice(note) }).catch(() => {})
        await testAfterMerge(ws, p?.source ?? null)
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
        if (!last) throw new UserError(m.nothingToUndo)
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
      async ({ workspaceId, path, index, choice, expect }) =>
        (await workspaces.resolve(workspaceId)).repo.resolveHunk(path, index, choice, expect),
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
      if (!note.trim()) throw new UserError(m.noteEmpty)
      const ws = await workspaces.resolve(workspaceId)
      const target = await workspaces.workspaceOfBranch(ws, source)
      if (!target) throw new UserError(m.noAgentWorkspace(source))
      const prompt = reviewFeedbackPrompt({ target: ws.row.branch ?? ws.info.name, source, path, note })
      await memory.watch(target.id, { targetWorkspaceId: ws.info.id, source })
      return deliverToAgent(orca, pending, target.id, prompt, settings.current.agent, ws.info.id)
    })
  )

  orca.panels.handle(
    'agent.resolveConflicts',
    guarded(deps, async ({ workspaceId }) => {
      const ws = await workspaces.resolve(workspaceId)
      const [merge, branch] = await Promise.all([ws.repo.mergeSummary(), ws.repo.currentBranch()])
      if (!merge) throw new UserError(core.noMergeRunning)
      const open = merge.conflicts.filter((f) => !merge.markerFree.includes(f))
      if (!open.length) throw new UserError(m.allResolvedAlready)
      const prompt = resolveConflictsPrompt({ target: branch ?? ws.info.name, source: merge.source, files: open })
      const terminalId = await launchAgent(orca, pending, ws.info.id, settings.current.agent, prompt)
      return { how: 'launched' as const, terminalId }
    })
  )

  orca.panels.handle(
    'stash.restore',
    guarded(
      deps,
      async ({ workspaceId }) => {
        const ws = await workspaces.resolve(workspaceId)
        const p = await memory.parked(ws.info.id)
        if (!p) throw new UserError(m.noParked)
        if (await ws.repo.mergeSummary()) throw new UserError(m.finishMergeFirst)
        const result = await ws.repo.unpark(p.sha, p.files)
        if (result !== 'conflict') await memory.setParked(ws.info.id, null)
        return { result: result as 'restored' | 'missing' | 'conflict' }
      },
      touches
    )
  )

  orca.panels.handle('ui.locale', async ({ locale }) => {
    const l = localeOf(locale)
    if (l !== getLocale()) {
      setLocale(l)
      await memory.setLocale(l)
      monitor.schedule(null, 'locale') // status bar texts in the new language
    }
    return { locale: l }
  })

  orca.panels.handle(
    'ui.sourceControl',
    guarded(deps, async () => {
      await orca.host.call('commands.run', { action: 'sidebar.sourceControl.toggle' })
      return { ok: true as const }
    })
  )

  // --- K11/K12: tests and probe merges run in the background; results come as job.changed.
  orca.panels.handle(
    'merge.probe',
    guarded(deps, async ({ workspaceId, source, withTests }) => {
      const ws = await workspaces.resolve(workspaceId)
      await ws.repo.verify(source)
      jobs.probe(ws, source, withTests === false ? null : await projectTestCommand(memory, ws))
      return { started: true as const }
    })
  )

  orca.panels.handle(
    'tests.run',
    guarded(deps, async ({ workspaceId }) => {
      const ws = await workspaces.resolve(workspaceId)
      jobs.runTests(ws, jobs.get(ws.info.id)?.source ?? null, await projectTestCommand(memory, ws))
      return { started: true as const }
    })
  )

  orca.panels.handle(
    'tests.terminal',
    guarded(deps, async ({ workspaceId }) => {
      const ws = await workspaces.resolve(workspaceId)
      const command = await projectTestCommand(memory, ws)
      if (!command) throw new UserError(m.noTestCommand)
      return orca.host.call('terminal.create', { workspaceId: ws.info.id, title: m.testsTerminalTitle, command })
    })
  )

  orca.panels.handle(
    'tests.fix',
    guarded(deps, async ({ workspaceId }) => {
      const ws = await workspaces.resolve(workspaceId)
      const job = jobs.get(ws.info.id)
      if (!job || job.status !== 'failed' || !job.command) throw new UserError(m.noRedRun)
      const prompt = testFixPrompt({
        target: ws.row.branch ?? ws.info.name,
        source: job.source,
        command: job.command,
        exitCode: job.exitCode,
        tail: job.tail
      })
      const terminalId = await launchAgent(orca, pending, ws.info.id, settings.current.agent, prompt)
      return { how: 'launched' as const, terminalId }
    })
  )

  orca.panels.handle(
    'project.setTestCommand',
    guarded(deps, async ({ workspaceId, command }) => {
      const ws = await workspaces.resolve(workspaceId)
      const value = command.trim()
      if (value.length > 500 || /[\r\n\0]/.test(value)) throw new UserError(m.testCommandOneLine)
      await memory.setTestCommand(projectKey(ws), value || null)
      return { testCommand: value || null }
    })
  )

  orca.panels.handle(
    'agent.retryPrompt',
    guarded(deps, async ({ workspaceId }) => {
      const ws = await workspaces.resolve(workspaceId)
      try {
        await pending.retry(ws.info.id)
      } catch (error) {
        throw new UserError(m.typingRefused((error as Error).message))
      }
      return { ok: true as const }
    }, true)
  )

  orca.panels.handle(
    'agent.dismissStalled',
    guarded(deps, async ({ workspaceId }) => {
      pending.dismissStalled((await workspaces.resolve(workspaceId)).info.id)
      return { ok: true as const }
    }, true)
  )

  orca.panels.handle(
    'job.cancel',
    guarded(deps, async ({ workspaceId }) => {
      jobs.cancel((await workspaces.resolve(workspaceId)).info.id)
      return { ok: true as const }
    })
  )

  orca.panels.handle(
    'job.dismiss',
    guarded(deps, async ({ workspaceId }) => {
      jobs.dismiss((await workspaces.resolve(workspaceId)).info.id)
      return { ok: true as const }
    })
  )

  orca.panels.handle(
    'overview.list',
    guarded(deps, async ({ workspaceId }) => buildOverview(workspaces, await workspaces.resolve(workspaceId)))
  )

  orca.panels.handle(
    'agent.focus',
    guarded(deps, async ({ workspaceId, source }) => {
      const ws = await workspaces.resolve(workspaceId)
      return { how: await focusAgent({ orca, workspaces, monitor, settings }, ws, source) }
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
        throw new UserError(m.watchOnBase)
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
