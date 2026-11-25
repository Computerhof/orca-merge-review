// Hands work to agents: review notes to the agent of a source workspace, conflicts to a new agent.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentDelivery } from '../types.ts'
import { isWorkState, LAUNCH_DEADLINE_MS } from '../core/launchPrompt.ts'

type AgentKind = string


/** Waits for a resumed agent to be ready before typing into it. */
export class PendingSends {
  private readonly waiting = new Map<string, { text: string; timer: ReturnType<typeof setTimeout> }>()
  private readonly orca: OrcaWorkerApi

  constructor(orca: OrcaWorkerApi) {
    this.orca = orca
  }

  add(terminalId: string, text: string, fallbackMs = 45_000): void {
    const timer = setTimeout(() => void this.flush(terminalId), fallbackMs)
    this.waiting.set(terminalId, { text, timer })
  }

  /** Drops what is still waiting (the worker stops). */
  dispose(): void {
    for (const { timer } of this.waiting.values()) clearTimeout(timer)
    this.waiting.clear()
    for (const { timer } of this.launches.values()) clearTimeout(timer)
    this.launches.clear()
    this.stalled.clear()
  }

  /** Launched agents whose prompt is not confirmed yet (no `working` seen). */
  private readonly launches = new Map<string, { timer: ReturnType<typeof setTimeout> }>()
  /** Per workspace whose panel launched it: an agent that never started on its prompt. */
  private readonly stalled = new Map<string, { terminalId: string; prompt: string }>()

  /**
   * Watches that a launched agent starts working on its prompt (`agent.status.changed`). If it
   * has not by the deadline, the panel of `originId` says so and offers to type the prompt; the
   * person's click happens in the workspace on screen, where Orca lets a plugin type.
   */
  watchLaunch(originId: string, terminalId: string, prompt: string, deadlineMs = LAUNCH_DEADLINE_MS): void {
    const atDeadline = () => {
      if (!this.launches.delete(terminalId)) return // it started working meanwhile
      this.orca.log(`launch prompt for ${terminalId}: the agent did not start working; asking the person`)
      this.stalled.set(originId, { terminalId, prompt })
      this.orca.panels.post('repo.changed', { workspaceId: originId, reason: 'agent' })
    }
    this.launches.set(terminalId, { timer: setTimeout(atDeadline, deadlineMs) })
  }

  /** The agent of this workspace's panel that did not get its prompt, if any. */
  stalledOf(originId: string): { terminalId: string } | null {
    const s = this.stalled.get(originId)
    return s ? { terminalId: s.terminalId } : null
  }

  /** Types the stalled agent's prompt into its terminal (the person asked for it). */
  async retry(originId: string): Promise<void> {
    const s = this.stalled.get(originId)
    if (!s) return
    await this.orca.host.call('terminal.sendText', { terminalId: s.terminalId, text: oneLine(s.prompt), enter: true })
    this.stalled.delete(originId)
  }

  dismissStalled(originId: string): void {
    this.stalled.delete(originId)
  }

  /** Called from agent.status.changed: a waiting or done agent can take input; a working one got its prompt. */
  onStatus(terminalId: string | undefined, state: string): void {
    if (!terminalId) return
    const launch = this.launches.get(terminalId)
    if (launch && isWorkState(state)) {
      clearTimeout(launch.timer)
      this.launches.delete(terminalId)
    }
    if (isWorkState(state)) {
      for (const [origin, st] of this.stalled) if (st.terminalId === terminalId) this.stalled.delete(origin)
    }
    if (this.waiting.has(terminalId) && (state === 'waiting' || state === 'done')) {
      void this.flush(terminalId)
    }
  }

  private async flush(terminalId: string): Promise<void> {
    const entry = this.waiting.get(terminalId)
    if (!entry) return
    this.waiting.delete(terminalId)
    clearTimeout(entry.timer)
    try {
      await this.orca.host.call('terminal.sendText', { terminalId, text: entry.text, enter: true })
    } catch (error) {
      this.orca.log(`pending send to ${terminalId}: ${(error as Error).message}`)
    }
  }
}

/** A running agent's TUI submits on Enter, so text typed into it must be one line. */
export function oneLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' · ')
}

/**
 * Delivers `prompt` to the agent of `workspaceId`: types it into a running agent, else resumes
 * that workspace's newest agent session and types once it is ready, else launches `agent` with it.
 */
export async function deliverToAgent(
  orca: OrcaWorkerApi,
  pending: PendingSends,
  workspaceId: string,
  prompt: string,
  agent: AgentKind,
  originId = workspaceId
): Promise<AgentDelivery> {
  const { agents } = await orca.host.call('agents.list', { workspaceId })
  const live = agents.find((a) => a.terminalId && a.state !== 'working') ?? agents.find((a) => a.terminalId)
  if (live?.terminalId) {
    await orca.host.call('terminal.sendText', { terminalId: live.terminalId, text: oneLine(prompt), enter: true })
    return { how: 'sent', terminalId: live.terminalId }
  }

  if (orca.host.has('agent.listSessions') && orca.host.has('agent.resume')) {
    try {
      const { sessions } = await orca.host.call('agent.listSessions', { workspaceId, limit: 5 })
      const last = sessions.find((s) => !s.running)
      if (last) {
        const resumed = await orca.host.call('agent.resume', {
          workspaceId,
          agent: last.agent as never,
          sessionId: last.sessionId
        })
        pending.add(resumed.terminalId, oneLine(prompt))
        return { how: 'resumed', terminalId: resumed.terminalId }
      }
    } catch (error) {
      orca.log(`resume failed, launching instead: ${(error as Error).message}`)
    }
  }

  return { how: 'launched', terminalId: await launchAgent(orca, pending, workspaceId, agent, prompt, originId) }
}

/**
 * Starts `agent` with `prompt` in a new terminal of `workspaceId` and watches that it starts
 * working; `originId` is the workspace whose panel asked (it shows a stalled start).
 */
export async function launchAgent(
  orca: OrcaWorkerApi,
  pending: PendingSends,
  workspaceId: string,
  agent: AgentKind,
  prompt: string,
  originId = workspaceId
): Promise<string> {
  const { terminalId } = await orca.host.call('agent.launch', { workspaceId, agent, prompt })
  pending.watchLaunch(originId, terminalId, prompt)
  return terminalId
}
