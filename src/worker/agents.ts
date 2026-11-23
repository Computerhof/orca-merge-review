// Hands work to agents: review notes to the agent of a source workspace, conflicts to a new agent.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentDelivery } from '../types.ts'

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

  /** Called from agent.status.changed: a waiting or done agent can take input. */
  onStatus(terminalId: string | undefined, state: string): void {
    if (terminalId && this.waiting.has(terminalId) && (state === 'waiting' || state === 'done')) {
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
  agent: AgentKind
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

  const launched = await orca.host.call('agent.launch', { workspaceId, agent, prompt })
  return { how: 'launched', terminalId: launched.terminalId }
}
