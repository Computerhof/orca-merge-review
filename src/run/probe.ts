// K12 Probe-Merge (decision E4): tries a merge in a hidden temporary worktree of the same
// repository, optionally runs the test command there, and always removes the worktree again.
// The person's working tree, index and branches are never touched: the worktree is detached
// at the current HEAD, and the probe's merge commit is left unreferenced.
//
// Dependencies: a fresh worktree has no node_modules. If the repository has one at its top level,
// the probe links it (a junction on Windows) for the tests, and unlinks it itself before Git
// removes the worktree, so the real folder can never be deleted through the link.
import { existsSync, lstatSync, symlinkSync, unlinkSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, type GitRunner } from '../git/runner.ts'
import { runCommand, type CommandResult } from './command.ts'

/** Folders worth sharing with the probe so tests can run without installing first. */
const SHARED_DEPENDENCY_DIRS = ['node_modules']

export interface ProbeResult {
  status: 'clean' | 'conflicts' | 'passed' | 'failed' | 'error'
  conflicts: string[]
  tests: CommandResult | null
  message: string
}

export interface ProbeOptions {
  /** The test command; null merges only. */
  testCommand: string | null
  testTimeoutMs: number
  signal?: AbortSignal
}

export async function probeMerge(runner: GitRunner, root: string, source: string, options: ProbeOptions): Promise<ProbeResult> {
  const tmp = await mkdtemp(join(tmpdir(), 'merge-review-probe-'))
  const wt = join(tmp, 'wt')
  const noHooks = join(tmp, 'no-hooks')
  const links: string[] = []
  let added = false
  try {
    await mkdir(noHooks)
    await git(runner, root, ['worktree', 'add', '--detach', '--quiet', wt, 'HEAD'])
    added = true
    // The repository's own hooks (lint, husky) are not part of the question "does it merge?".
    const merge = await git(
      runner,
      wt,
      [
        '-c', `core.hooksPath=${noHooks}`,
        '-c', 'user.name=Merge & Review (Probe)',
        '-c', 'user.email=probe@merge-review.invalid',
        '-c', 'commit.gpgsign=false',
        'merge', '--no-ff', '--no-edit', '--end-of-options', source
      ],
      [0, 1, 128]
    )
    const unmerged = await git(runner, wt, ['diff', '--name-only', '--diff-filter=U', '-z'])
    const conflicts = [...new Set(unmerged.stdout.split('\0').filter(Boolean))]
    if (conflicts.length) {
      return { status: 'conflicts', conflicts, tests: null, message: `${conflicts.length} Datei(en) mit Konflikten.` }
    }
    if (merge.code !== 0) {
      return { status: 'error', conflicts: [], tests: null, message: `Merge nicht möglich: ${(merge.stderr || merge.stdout).trim()}` }
    }
    if (!options.testCommand) {
      return { status: 'clean', conflicts: [], tests: null, message: 'Merge geht sauber durch.' }
    }
    for (const name of SHARED_DEPENDENCY_DIRS) {
      const from = join(root, name)
      const to = join(wt, name)
      if (existsSync(from) && !existsSync(to)) {
        symlinkSync(from, to, 'junction') // 'junction' on Windows, a directory symlink elsewhere
        links.push(to)
      }
    }
    const tests = await runCommand(options.testCommand, wt, { timeoutMs: options.testTimeoutMs, signal: options.signal })
    const ok = tests.exitCode === 0
    return {
      status: ok ? 'passed' : 'failed',
      conflicts: [],
      tests,
      message: ok
        ? 'Merge sauber, Tests grün.'
        : tests.timedOut
          ? 'Tests nach dem Zeitlimit abgebrochen.'
          : tests.cancelled
            ? 'Abgebrochen.'
            : `Tests rot (Exit ${tests.exitCode ?? '?'}).`
    }
  } catch (error) {
    return { status: 'error', conflicts: [], tests: null, message: (error as Error).message }
  } finally {
    // Links first, by hand: never let a recursive delete reach the real folder behind them.
    for (const link of links) unlinkQuietly(link)
    if (added) await git(runner, root, ['worktree', 'remove', '--force', wt], [0, 128]).catch(() => undefined)
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
    await git(runner, root, ['worktree', 'prune'], [0, 128]).catch(() => undefined)
  }
}

function unlinkQuietly(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) unlinkSync(path)
  } catch {
    // already gone
  }
}
