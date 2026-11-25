// "Is a merge, rebase or cherry-pick under way in this working tree?" without running Git, for
// hooks: Orca gives a hook 2 s and an agent can work in a workspace the plugin has never looked
// at. Reads only the marker files Git itself writes (MERGE_HEAD, and SQUASH_MSG for
// `merge --squash`; rebase-merge/ or rebase-apply/ for a rebase; CHERRY_PICK_HEAD, and
// sequencer/todo between the picks of several commits), in linked worktrees too, where `.git` is
// a file pointing at the worktree's own Git directory (all these markers live there).
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { OperationKind } from '../types.ts'

/** What is under way, in the same order the core checks it (rebase, cherry-pick, merge); null when nothing is. */
export function operationSync(workdir: string): OperationKind | null {
  try {
    const gitDir = gitDirOf(workdir)
    if (!gitDir) return null
    const has = (...parts: string[]) => existsSync(join(gitDir, ...parts))
    // rebase-apply is also `git am`; only the file `rebasing` makes it a rebase.
    if (has('rebase-merge') || has('rebase-apply', 'rebasing')) return 'rebase'
    if (has('CHERRY_PICK_HEAD') || picksLeft(join(gitDir, 'sequencer', 'todo'))) return 'cherry-pick'
    if (has('MERGE_HEAD') || has('SQUASH_MSG')) return 'merge'
    return null
  } catch {
    return null
  }
}

/** True while a merge, rebase or cherry-pick is under way (the hooks' rules are the same for all three). */
export function mergeMarkersSync(workdir: string): boolean {
  return !!operationSync(workdir)
}

/** The sequencer also runs `git revert`; only `pick` lines make it a cherry-pick. */
function picksLeft(todo: string): boolean {
  try {
    return /^(pick|p)\s/m.test(readFileSync(todo, 'utf8'))
  } catch {
    return false
  }
}

/** The worktree's own Git directory, or null when `workdir` has no `.git`. */
function gitDirOf(workdir: string): string | null {
  const dotGit = join(workdir, '.git')
  // Read first and let the error tell a directory from a file: no check-then-use race.
  const pointer = readPointer(dotGit)
  if (pointer === null) return null
  if (pointer === DIRECTORY) return dotGit
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(pointer)
  if (!m?.[1]) return null
  return isAbsolute(m[1]) ? m[1] : resolve(workdir, m[1])
}

const DIRECTORY = Symbol('directory')

/** The text of a `.git` file, DIRECTORY for a `.git` folder, null when there is none. */
function readPointer(dotGit: string): string | typeof DIRECTORY | null {
  try {
    return readFileSync(dotGit, 'utf8')
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'EISDIR') return DIRECTORY
    return null
  }
}
