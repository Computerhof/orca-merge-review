// The test command belongs to the Orca project (all its workspaces), kept in the plugin's storage,
// and set by the person in the panel. The plugin only suggests one from the project's files.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { detectTestCommand, type TestSuggestion } from '../core/testDetect.ts'
import type { Memory } from './memory.ts'
import type { Resolved } from './workspaces.ts'

/** Orca's project id; a workspace without one (a plain folder) is keyed by its repository. */
export function projectKey(ws: Resolved): string {
  return ws.row.projectId ?? `path:${ws.repo.root}`
}

export async function projectTestCommand(memory: Memory, ws: Resolved): Promise<string | null> {
  return ((await memory.testCommand(projectKey(ws))) ?? '').trim() || null
}

export async function suggestTestCommand(ws: Resolved): Promise<TestSuggestion | null> {
  const root = ws.repo.root
  const names = await readdir(root).catch(() => [] as string[])
  return detectTestCommand({ names, read: (name) => readFile(join(root, name), 'utf8').catch(() => null) })
}
