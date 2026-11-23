// A real Git repository in the temp folder for `orca plugin test` and `orca plugin check`:
// main and feature both change a.txt (a conflict), feature adds b.txt. Fixed test identity only.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function divergentRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'merge-review-check-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  const write = (p: string, t: string) => writeFileSync(join(dir, p), t, 'utf8')
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  write('a.txt', 'eins\nzwei\ndrei\n')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'init')
  git('checkout', '--quiet', '-b', 'feature')
  write('a.txt', 'eins\nZWEI-feature\ndrei\n')
  write('b.txt', 'neu\n')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'feature: zwei')
  git('checkout', '--quiet', 'main')
  write('a.txt', 'eins\nZWEI-main\ndrei\n')
  git('commit', '--quiet', '-am', 'main: zwei')
  return dir
}

/** What a mock host answers so the worker finds `dir` as the focused workspace `ws-main`. */
export function hostResults(dir: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'workspace.readContext': { workspaceId: 'ws-main', branch: 'main', displayName: 'main', terminals: [] },
    'workspace.list': {
      workspaces: [
        { id: 'ws-main', kind: 'worktree', name: 'main', projectId: 'p1', path: dir, branch: 'main', hostId: 'local', status: { state: 'inactive', unread: false, terminalCount: 0, lastActivityAt: null } },
        { id: 'ws-feature', kind: 'worktree', name: 'agent-feature', projectId: 'p1', path: dir, branch: 'feature', hostId: 'local', status: { state: 'done', unread: false, terminalCount: 1, lastActivityAt: null } }
      ],
      truncated: false
    },
    'automation.list': { automations: [], truncated: false },
    'agents.list': { agents: [] },
    'editor.open': { opened: true },
    'statusBar.update': { ok: true },
    'notifications.show': { delivered: true },
    'agent.launch': { terminalId: 'term-new' },
    ...extra
  }
}

/** The same repository with `git merge feature` stopped on the conflict in a.txt (diff3 blocks). */
export function mergingRepo(): string {
  const dir = divergentRepo()
  try {
    execFileSync('git', ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-edit', 'feature'], { cwd: dir, stdio: 'ignore' })
  } catch {
    // exit 1: stopped on conflicts, as intended
  }
  return dir
}
