// "Is a merge under way in this working tree?" without running Git, for hooks: Orca gives a hook
// 2 s and an agent can work in a workspace the plugin has never looked at. Reads only the marker
// files Git itself writes (MERGE_HEAD, and SQUASH_MSG for `merge --squash`), in linked worktrees
// too, where `.git` is a file pointing at the real Git directory.
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export function mergeMarkersSync(workdir: string): boolean {
  try {
    const dotGit = join(workdir, '.git')
    // Read first and let the error tell a directory from a file: no check-then-use race.
    let gitDir = dotGit
    const pointer = readPointer(dotGit)
    if (pointer === null) return false
    if (pointer !== DIRECTORY) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(pointer)
      if (!m?.[1]) return false
      gitDir = isAbsolute(m[1]) ? m[1] : resolve(workdir, m[1])
    }
    return existsSync(join(gitDir, 'MERGE_HEAD')) || existsSync(join(gitDir, 'SQUASH_MSG'))
  } catch {
    return false
  }
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
