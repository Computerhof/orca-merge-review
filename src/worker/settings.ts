// Typed access to the settings declared in orca-plugin.json (contributes.settings).
import type { OrcaWorkerApi } from 'orca/worker'
import type { MergeMode } from '../types.ts'

export interface PluginSettings {
  defaultMode: MergeMode
  showBase: boolean
  agent: string
  guardAgents: boolean
  notifyAgentDone: boolean
  watchSchedule: string
  autoMarkResolved: boolean
  testCommand: string
}

export const DEFAULTS: PluginSettings = {
  defaultMode: 'no-ff',
  showBase: true,
  agent: 'claude',
  guardAgents: true,
  notifyAgentDone: true,
  watchSchedule: '0 8 * * 1-5',
  autoMarkResolved: true,
  testCommand: ''
}

/** Kept current from onDidChange, so hooks read settings synchronously within Orca's 2 s budget. */
export class SettingsCache {
  current: PluginSettings = { ...DEFAULTS }

  async start(orca: OrcaWorkerApi): Promise<void> {
    await this.reload(orca)
    orca.settings.onDidChange(() => void this.reload(orca))
  }

  private async reload(orca: OrcaWorkerApi): Promise<void> {
    try {
      const all = (await orca.settings.get()) as Partial<Record<keyof PluginSettings, unknown>>
      const pick = <K extends keyof PluginSettings>(key: K): PluginSettings[K] => {
        const v = all[key]
        return (typeof v === typeof DEFAULTS[key] ? v : DEFAULTS[key]) as PluginSettings[K]
      }
      this.current = {
        defaultMode: pick('defaultMode'),
        showBase: pick('showBase'),
        agent: pick('agent'),
        guardAgents: pick('guardAgents'),
        notifyAgentDone: pick('notifyAgentDone'),
        watchSchedule: pick('watchSchedule'),
        autoMarkResolved: pick('autoMarkResolved'),
        testCommand: pick('testCommand')
      }
    } catch (error) {
      orca.log(`settings: ${(error as Error).message}`)
    }
  }
}
