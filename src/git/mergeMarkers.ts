// "Is a merge under way in this working tree?" without running Git, for hooks: Orca gives a hook
// 2 s and an agent can work in a workspace the plugin has never looked at. Reads only the marker
// files Git itself writes (MERGE_HEAD, and SQUASH_MSG for `merge --squash`), in linked worktrees
// too, where `.git` is a file pointing at the real Git directory.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export function mergeMarkersSync(workdir: string): boolean {
  try {
    const dotGit = join(workdir, '.git')
    const st = statSync(dotGit, { throwIfNoEntry: false })
    if (!st) return false
    let gitDir = dotGit
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'))
      if (!m?.[1]) return false
      gitDir = isAbsolute(m[1]) ? m[1] : resolve(workdir, m[1])
    }
    return existsSync(join(gitDir, 'MERGE_HEAD')) || existsSync(join(gitDir, 'SQUASH_MSG'))
  } catch {
    return false
  }
}
