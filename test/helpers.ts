// A throwaway Git repository per test, with a fixed identity so nothing personal leaks into fixtures.
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalGitRunner, git } from '../src/git/runner.ts'
import { localFiles } from '../src/git/files.ts'
import { Repo } from '../src/core/repo.ts'

export const runner = new LocalGitRunner()

export interface Sandbox {
  dir: string
  repo: Repo
  git(...args: string[]): Promise<string>
  write(path: string, text: string): Promise<void>
  read(path: string): Promise<string>
  commit(message: string, files: Record<string, string>): Promise<void>
  dispose(): Promise<void>
}

export async function sandbox(options: { conflictStyle?: 'merge' | 'diff3' } = {}): Promise<Sandbox> {
  const dir = await mkdtemp(join(tmpdir(), 'merge-review-'))
  const g = async (...args: string[]) => (await git(runner, dir, args)).stdout
  await g('init', '--quiet', '--initial-branch=main')
  await g('config', 'user.name', 'Test')
  await g('config', 'user.email', 'test@example.invalid')
  await g('config', 'commit.gpgsign', 'false')
  await g('config', 'core.autocrlf', 'false')
  await g('config', 'merge.conflictStyle', options.conflictStyle ?? 'merge')
  const write = (path: string, text: string) => writeFile(join(dir, path), text, 'utf8')
  const s: Sandbox = {
    dir,
    repo: null as unknown as Repo,
    git: g,
    write,
    read: (path) => readFile(join(dir, path), 'utf8'),
    async commit(message, files) {
      for (const [p, t] of Object.entries(files)) await write(p, t)
      await g('add', '-A')
      await g('commit', '--quiet', '-m', message)
    },
    dispose: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
  await s.commit('init', { 'a.txt': 'eins\nzwei\ndrei\n', 'keep.txt': 'bleibt\n' })
  s.repo = (await Repo.open(runner, localFiles, dir))!
  return s
}

/** Runs `fn` against a fresh sandbox and always removes it. */
export async function withSandbox(
  fn: (s: Sandbox) => Promise<void>,
  options?: { conflictStyle?: 'merge' | 'diff3' }
): Promise<void> {
  const s = await sandbox(options)
  try {
    await fn(s)
  } finally {
    await s.dispose()
  }
}

/** main and feature both change line 2 of a.txt; feature also adds b.txt. */
export async function divergent(s: Sandbox): Promise<void> {
  await s.git('checkout', '--quiet', '-b', 'feature')
  await s.commit('feature: zwei', { 'a.txt': 'eins\nZWEI-feature\ndrei\n', 'b.txt': 'neu\n' })
  await s.git('checkout', '--quiet', 'main')
  await s.commit('main: zwei', { 'a.txt': 'eins\nZWEI-main\ndrei\n' })
}
