// Git operations behind the panel: state, comparison, merge preview, merge, conflict handling.
// Talks only to a GitRunner; reads and writes working files through `FileAccess`.
import type {
  Comparison,
  CommitRow,
  ConflictFile,
  FileChange,
  MergeMode,
  MergeOutcome,
  MergePreview,
  ConflictChoice,
  RepoState
} from '../types.ts'
import { git, GitError, LONG_RUNNING_MS, type GitRunner, type RunOptions } from '../git/runner.ts'
import { conflictsOf, displayLines, parseConflicts, resolveConflict } from './conflicts.ts'

export interface FileAccess {
  /** Null when the file does not exist. */
  read(absPath: string): Promise<string | null>
  write(absPath: string, text: string): Promise<void>
  mkdir(absPath: string): Promise<void>
  join(root: string, relPath: string): string
}

/** What Git alone can say about a repository; the worker adds workspace and source data. */
export type CoreState = Pick<RepoState, 'problem' | 'branch' | 'head' | 'branches' | 'dirtyFiles' | 'merge'>

/** A refusal meant for the person (bad input, wrong state), not a Git failure. */
export class UserError extends Error {
  readonly code = 'user_error'
}

const MAX_COMMITS = 200
const MAX_PATCH = 400 * 1024

export class Repo {
  private readonly runner: GitRunner
  private readonly files: FileAccess
  /** The repository's top level; every path the panel sends is relative to it. */
  readonly root: string

  private constructor(runner: GitRunner, files: FileAccess, root: string) {
    this.runner = runner
    this.files = files
    this.root = root
  }

  /** Opens the repository that contains `dir`; null when `dir` is not inside one. */
  static async open(runner: GitRunner, files: FileAccess, dir: string): Promise<Repo | null> {
    const top = await runner.run(dir, ['rev-parse', '--show-toplevel'])
    if (top.code !== 0) return null
    return new Repo(runner, files, top.stdout.trim())
  }

  private git(args: readonly string[], ok?: readonly number[], options?: RunOptions) {
    return git(this.runner, this.root, args, ok, options)
  }

  /** Merge and commit run the repository's Git hooks, which may take minutes. */
  private long(args: readonly string[], ok?: readonly number[]) {
    return this.git(args, ok, { timeoutMs: LONG_RUNNING_MS })
  }

  // ---------------------------------------------------------------- state

  async state(known?: { local: string[]; remote: string[] }): Promise<CoreState> {
    const [branch, refs, merge, head] = await Promise.all([
      this.currentBranch(),
      known ?? this.refs(),
      this.mergeSummary(),
      this.git(['rev-parse', '-q', '--verify', 'HEAD'], [0, 1, 128]).then((r) => (r.code === 0 ? r.stdout.trim() : null))
    ])
    const merging = merge !== null
    return {
      problem: null,
      branch,
      head,
      branches: [...refs.local, ...refs.remote],
      // Only tracked changes block a merge; Git itself refuses if an untracked file is in the way.
      dirtyFiles: merging ? [] : await this.dirtyFiles(true),
      merge
    }
  }

  /** Only the merge part of `state()`: cheap enough to poll (two or three Git calls outside a merge). */
  async mergeSummary(): Promise<CoreState['merge']> {
    const [unmerged, mergeHead] = await Promise.all([this.unmerged(), this.mergeHead()])
    if (mergeHead === null && unmerged.length === 0 && !(await this.squashPending())) return null
    return {
      source: mergeHead ? await this.describe(mergeHead) : 'Squash-Merge',
      conflicts: unmerged,
      markerFree: await this.markerFree(unmerged)
    }
  }

  async currentBranch(): Promise<string | null> {
    const r = await this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1, 128])
    return r.code === 0 ? r.stdout.trim() : null
  }

  async branches(): Promise<string[]> {
    const { local, remote } = await this.refs()
    return [...local, ...remote]
  }

  /** Local and remote-tracking branches, most recently committed first. */
  async refs(): Promise<{ local: string[]; remote: string[] }> {
    const r = await this.git([
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname)',
      'refs/heads',
      'refs/remotes'
    ])
    const local: string[] = []
    const remote: string[] = []
    for (const line of r.stdout.split('\n')) {
      const ref = line.trim()
      if (!ref || ref.endsWith('/HEAD')) continue
      if (ref.startsWith('refs/heads/')) local.push(ref.slice('refs/heads/'.length))
      else if (ref.startsWith('refs/remotes/')) remote.push(ref.slice('refs/remotes/'.length))
    }
    return { local, remote }
  }

  /** The project's base branch: the remote's default branch, else main/master/develop; null if none. */
  async baseBranch(known?: { local: string[]; remote: string[] }): Promise<string | null> {
    const { local, remote } = known ?? (await this.refs())
    const head = await this.git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], [0, 1, 128])
    if (head.code === 0) {
      const name = head.stdout.trim() // e.g. origin/main
      const short = name.startsWith('origin/') ? name.slice('origin/'.length) : name
      return local.includes(short) ? short : name
    }
    for (const name of ['main', 'master', 'develop']) if (local.includes(name)) return name
    for (const name of ['origin/main', 'origin/master']) if (remote.includes(name)) return name
    return null
  }

  /** Where Git keeps this worktree's own files (absolute), and whether that lies inside the worktree. */
  async gitDir(): Promise<{ path: string; inside: boolean }> {
    const r = await this.git(['rev-parse', '--path-format=absolute', '--git-dir'])
    const path = r.stdout.trim()
    const norm = (p: string) => p.split('\\').join('/').toLowerCase()
    return { path, inside: norm(path).startsWith(norm(this.root) + '/') }
  }

  /** Adds a pattern to the repository's local exclude file (never committed), once. */
  async excludeLocally(pattern: string): Promise<void> {
    const r = await this.git(['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'])
    const file = r.stdout.trim()
    const text = (await this.files.read(file)) ?? ''
    if (text.split(/\r?\n/).includes(pattern)) return
    await this.files.write(file, text + (text && !text.endsWith('\n') ? '\n' : '') + pattern + '\n')
  }

  /** Writes a plugin helper file (absolute path), creating its folder. */
  async writeHelper(dir: string, name: string, text: string): Promise<string> {
    await this.files.mkdir(dir)
    const file = this.files.join(dir, name)
    await this.files.write(file, text)
    return file
  }

  private async mergeHead(): Promise<string | null> {
    const r = await this.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], [0, 1])
    return r.code === 0 ? r.stdout.trim() : null
  }

  private async describe(rev: string): Promise<string> {
    const r = await this.git(
      ['name-rev', '--name-only', '--refs=refs/heads/*', '--refs=refs/remotes/*', rev],
      [0, 128]
    )
    const name = r.stdout.trim()
    return r.code === 0 && name && name !== 'undefined' ? name : rev.slice(0, 10)
  }

  async unmerged(): Promise<string[]> {
    const r = await this.git(['diff', '--name-only', '--diff-filter=U', '-z'])
    return [...new Set(r.stdout.split('\0').filter(Boolean))]
  }

  private async markerFree(paths: readonly string[]): Promise<string[]> {
    const free: string[] = []
    for (const p of paths) {
      const text = await this.files.read(this.files.join(this.root, p))
      if (text !== null && !text.includes('\0') && conflictsOf(parseConflicts(text)).length === 0) {
        free.push(p)
      }
    }
    return free
  }

  /** Tracked changes plus untracked files, as `git status` lists them. */
  async dirtyFiles(trackedOnly = false): Promise<string[]> {
    const r = await this.git([
      'status',
      '--porcelain=v1',
      '-z',
      trackedOnly ? '--untracked-files=no' : '--untracked-files=normal'
    ])
    const parts = r.stdout.split('\0')
    const out: string[] = []
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i]
      if (!entry) continue
      out.push(entry.slice(3))
      // The old path follows a rename or copy, staged (X) or in the worktree (Y).
      if ('RC'.includes(entry[0]) || 'RC'.includes(entry[1])) i++
    }
    return out
  }

  // ---------------------------------------------------------------- compare

  /** Resolves a branch, tag or commit to a commit id; refuses anything that could be an option. */
  async verify(ref: string): Promise<string> {
    const name = ref.trim()
    if (!name || name.startsWith('-') || /[\0\n]/.test(name)) {
      throw new UserError(`Ungültiger Branch-Name: "${ref}"`)
    }
    const r = await this.git(
      ['rev-parse', '--verify', '--quiet', '--end-of-options', `${name}^{commit}`],
      [0, 1, 128]
    )
    if (r.code !== 0) throw new UserError(`"${name}" ist kein Branch oder Commit in diesem Repository.`)
    return r.stdout.trim()
  }

  async compare(source: string, target = 'HEAD'): Promise<Comparison> {
    const [src, tgt] = await Promise.all([this.verify(source), this.verify(target)])
    const [mergeBase, counts] = await Promise.all([this.mergeBase(tgt, src), this.aheadBehind(tgt, src)])
    const [incoming, files, preview] = await Promise.all([
      counts.ahead ? this.commits(`${tgt}..${src}`) : Promise.resolve([]),
      this.changedFiles(mergeBase ?? tgt, src),
      this.preview(tgt, src, counts, mergeBase !== null)
    ])
    return { source, target, mergeBase, incoming, ahead: counts.ahead, behind: counts.behind, files, preview }
  }

  /** Commits only `source` has (ahead) and only `target` has (behind), in one Git call. */
  async aheadBehind(target: string, source: string): Promise<{ ahead: number; behind: number }> {
    const r = await this.git(['rev-list', '--left-right', '--count', `${target}...${source}`])
    const [behind, ahead] = r.stdout.trim().split(/\s+/).map((n) => Number(n) || 0)
    return { ahead: ahead ?? 0, behind: behind ?? 0 }
  }

  private async mergeBase(a: string, b: string): Promise<string | null> {
    const r = await this.git(['merge-base', a, b], [0, 1])
    return r.code === 0 ? r.stdout.trim() : null
  }

  private async commits(range: string): Promise<CommitRow[]> {
    const r = await this.git([
      'log',
      `--max-count=${MAX_COMMITS}`,
      '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct%x1e',
      range
    ])
    return r.stdout
      .split('\x1e')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash, short, subject, author, ct] = line.split('\x1f')
        return { hash, short, subject, author, at: Number(ct) * 1000 }
      })
  }

  /** What the merge brings in: the diff from the merge base to source, with renames. */
  async changedFiles(from: string, to: string): Promise<FileChange[]> {
    const [status, numstat] = await Promise.all([
      this.git(['diff', '--name-status', '-z', '-M', from, to]),
      this.git(['diff', '--numstat', '-z', '-M', from, to])
    ])
    const counts = parseNumstat(numstat.stdout)
    return parseNameStatus(status.stdout).map((f) => {
      const c = counts.get(f.path)
      return { ...f, added: c?.added ?? null, deleted: c?.deleted ?? null }
    })
  }

  /** Predicts the merge with `git merge-tree --write-tree`: touches no file and no ref. */
  async preview(
    target: string,
    source: string,
    known?: { ahead: number; behind: number },
    related?: boolean
  ): Promise<MergePreview> {
    const { ahead, behind } = known ?? (await this.aheadBehind(target, source))
    if (ahead === 0) return { clean: true, conflicts: [], upToDate: true, fastForward: false }
    if (behind === 0) return { clean: true, conflicts: [], upToDate: false, fastForward: true }
    if (related === false || (related === undefined && (await this.mergeBase(target, source)) === null)) {
      return { clean: null, conflicts: [], upToDate: false, fastForward: false, unrelated: true }
    }
    const r = await this.git(
      ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', target, source],
      [0, 1, 128, 129]
    )
    if (r.code > 1) return { clean: null, conflicts: [], upToDate: false, fastForward: false }
    // -z: <tree>\0<path>\0<path>\0 ... \0 (then messages, which --no-messages leaves out)
    const parts = r.stdout.split('\0')
    const conflicts: string[] = []
    for (const p of parts.slice(1)) {
      if (!p) break
      if (!conflicts.includes(p)) conflicts.push(p)
    }
    return { clean: r.code === 0, conflicts, upToDate: false, fastForward: false }
  }

  /** The patch of one file; `from` is its old path when it was renamed, so Git can pair them. */
  async fileDiff(source: string, path: string, target = 'HEAD', from?: string) {
    const [src, tgt] = await Promise.all([this.verify(source), this.verify(target)])
    const base = (await this.mergeBase(tgt, src)) ?? tgt
    const paths = from && from !== path ? [checkPath(from), checkPath(path)] : [checkPath(path)]
    const r = await this.git(['diff', '-M', '--no-color', base, src, '--', ...paths])
    const truncated = r.stdout.length > MAX_PATCH
    return { patch: truncated ? r.stdout.slice(0, MAX_PATCH) : r.stdout, truncated }
  }

  // ---------------------------------------------------------------- merge

  async head(): Promise<string> {
    return (await this.git(['rev-parse', 'HEAD'])).stdout.trim()
  }

  async merge(
    source: string,
    mode: MergeMode,
    message?: string,
    options: { showBase?: boolean } = {}
  ): Promise<MergeOutcome> {
    await this.verify(source)
    if ((await this.mergeHead()) || (await this.unmerged()).length) {
      throw new UserError('Es läuft schon ein Merge. Erst abschließen oder abbrechen.')
    }
    const dirty = await this.dirtyFiles(true)
    if (dirty.length) {
      throw new UserError(
        `Der Arbeitsbaum hat ${dirty.length} nicht committete Änderung(en). Erst committen oder stashen.`
      )
    }
    if (!(await this.currentBranch())) {
      throw new UserError('HEAD ist von keinem Branch ausgecheckt (detached). Erst einen Branch auschecken.')
    }

    const msg = message?.trim()
    // diff3 writes the common ancestor into each conflict block, so the review tab can show it.
    const args = options.showBase ? ['-c', 'merge.conflictStyle=diff3', 'merge'] : ['merge']
    if (mode === 'no-ff') args.push('--no-ff', '--no-edit')
    // Explicit, so `merge.ff` in the user's config cannot turn the choice into something else.
    if (mode === 'ff') args.push('--ff', '--no-edit')
    if (mode === 'ff-only') args.push('--ff-only')
    if (mode === 'squash') args.push('--squash')
    if (msg && (mode === 'ff' || mode === 'no-ff')) args.push('-m', msg)
    args.push('--end-of-options', source)

    const r = await this.long(args, [0, 1, 128])
    const conflicts = await this.unmerged()
    if (conflicts.length) {
      return {
        status: 'conflicts',
        message: `${conflicts.length} Datei(en) mit Konflikten. Im Bereich „Konflikte“ auflösen.`,
        conflicts
      }
    }
    if (r.code !== 0) {
      throw new GitError(`Merge nicht möglich: ${(r.stderr || r.stdout).trim()}`, r)
    }
    if (/Already up.to.date/i.test(r.stdout)) {
      return { status: 'up-to-date', message: 'Schon aktuell, nichts zu mergen.', conflicts: [] }
    }
    if (mode === 'squash') {
      const staged = await this.git(['diff', '--cached', '--quiet'], [0, 1])
      if (staged.code === 0) {
        return { status: 'up-to-date', message: 'Squash brachte keine Änderungen.', conflicts: [] }
      }
      await this.long(['commit', '-m', msg || `Squash-Merge von ${source}`])
      return { status: 'squashed', message: `${source} als ein Commit übernommen.`, conflicts: [] }
    }
    return { status: 'merged', message: `${source} gemergt.`, conflicts: [] }
  }

  async abort(): Promise<void> {
    if (await this.mergeHead()) await this.git(['merge', '--abort'])
    else if ((await this.unmerged()).length || (await this.squashPending())) await this.git(['reset', '--merge'])
    else throw new UserError('Es läuft kein Merge.')
  }

  /**
   * A squash merge leaves no MERGE_HEAD: once its conflicts are resolved it is only visible as
   * SQUASH_MSG plus staged changes. Without this the panel would lose track of it.
   */
  private async squashPending(): Promise<boolean> {
    const r = await this.git(['rev-parse', '--path-format=absolute', '--git-path', 'SQUASH_MSG'])
    if ((await this.files.read(r.stdout.trim())) === null) return false
    const staged = await this.git(['diff', '--cached', '--quiet'], [0, 1])
    return staged.code === 1
  }

  /**
   * Undoes a merge this plugin just made: HEAD goes back to `before`. Refuses unless HEAD is still
   * exactly `after` and the tree is clean, so it never throws away anything made since.
   */
  async undoMerge(before: string, after: string): Promise<void> {
    if ((await this.mergeHead()) || (await this.unmerged()).length) {
      throw new UserError('Es läuft ein Merge. Dafür „Merge abbrechen“ nutzen.')
    }
    if ((await this.head()) !== after) {
      throw new UserError('Seit dem Merge hat sich der Branch verändert. Rückgängig ist nicht mehr sicher möglich.')
    }
    if ((await this.dirtyFiles(true)).length) {
      throw new UserError('Der Arbeitsbaum hat nicht committete Änderungen. Erst committen oder stashen.')
    }
    await this.verify(before)
    await this.git(['reset', '--merge', before])
  }

  async commitMerge(message?: string): Promise<string> {
    const left = await this.unmerged()
    if (left.length) {
      throw new UserError(`Noch ${left.length} ungelöste Datei(en): ${left.slice(0, 5).join(', ')}`)
    }
    const msg = message?.trim()
    await this.long(msg ? ['commit', '-m', msg] : ['commit', '--no-edit'])
    return (await this.git(['rev-parse', 'HEAD'])).stdout.trim()
  }

  // ---------------------------------------------------------------- conflicts

  private async requireUnmerged(path: string): Promise<string> {
    const rel = checkPath(path)
    if (!(await this.unmerged()).includes(rel)) {
      throw new UserError(`"${rel}" hat keinen offenen Konflikt.`)
    }
    return rel
  }

  async conflict(path: string): Promise<ConflictFile> {
    const rel = await this.requireUnmerged(path)
    const stages = await this.git(['ls-files', '-u', '-z', '--', rel])
    const stage = { base: false, ours: false, theirs: false }
    for (const entry of stages.stdout.split('\0').filter(Boolean)) {
      const n = entry.split('\t')[0].split(' ')[2]
      if (n === '1') stage.base = true
      if (n === '2') stage.ours = true
      if (n === '3') stage.theirs = true
    }
    const text = await this.files.read(this.files.join(this.root, rel))
    const binary = text !== null && text.includes('\0')
    const conflicts = text === null || binary ? [] : conflictsOf(parseConflicts(text))
    return {
      path: rel,
      hunks: conflicts.map((c, index) => ({
        index,
        oursLabel: c.oursLabel,
        theirsLabel: c.theirsLabel,
        ours: displayLines(c.ours),
        base: c.base ? displayLines(c.base) : null,
        theirs: displayLines(c.theirs)
      })),
      markerFree: text !== null && !binary && conflicts.length === 0,
      wholeFileOnly: text === null || binary || !stage.ours || !stage.theirs,
      stage
    }
  }

  /**
   * Replaces block `index` with `choice`. With `expect` (the sides as the person saw them) it
   * refuses when that block changed meanwhile, e.g. because an agent edited the file.
   */
  async resolveHunk(
    path: string,
    index: number,
    choice: ConflictChoice,
    expect?: { ours: string; theirs: string }
  ): Promise<ConflictFile> {
    const rel = await this.requireUnmerged(path)
    const abs = this.files.join(this.root, rel)
    const text = await this.files.read(abs)
    if (text === null) throw new UserError(`"${rel}" gibt es im Arbeitsbaum nicht.`)
    if (expect) {
      const block = conflictsOf(parseConflicts(text))[index]
      if (!block || displayLines(block.ours) !== expect.ours || displayLines(block.theirs) !== expect.theirs) {
        throw new UserError(`"${rel}" hat sich inzwischen geändert. Die Ansicht wurde neu geladen; bitte erneut wählen.`)
      }
    }
    try {
      await this.files.write(abs, resolveConflict(text, index, choice))
    } catch (e) {
      if (e instanceof Error && !(e instanceof GitError)) throw new UserError(e.message)
      throw e
    }
    return this.conflict(rel)
  }

  async takeFile(path: string, side: 'ours' | 'theirs'): Promise<void> {
    const rel = await this.requireUnmerged(path)
    const info = await this.conflict(rel)
    if (info.stage[side]) {
      await this.git(['checkout', `--${side}`, '--', rel])
      await this.git(['add', '--', rel])
    } else {
      // That side deleted the file: taking it means deleting it.
      await this.git(['rm', '--quiet', '--force', '--', rel])
    }
  }

  async markResolved(path: string): Promise<void> {
    const rel = await this.requireUnmerged(path)
    const text = await this.files.read(this.files.join(this.root, rel))
    if (text !== null && !text.includes('\0') && conflictsOf(parseConflicts(text)).length) {
      throw new UserError(`"${rel}" enthält noch Konfliktmarker.`)
    }
    await this.git(['add', '-A', '--', rel])
  }
}

/** Repository-relative, forward slashes, never absolute and never leaving the repository. */
export function checkPath(path: string): string {
  const p = path.replace(/\\/g, '/').trim()
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split('/').includes('..') || p.includes('\0')) {
    throw new UserError(`Ungültiger Pfad: "${path}"`)
  }
  return p
}

/**
 * A path Orca reports (absolute, or already relative) as repository-relative with forward slashes;
 * null when it lies outside `root`. Case-insensitive where the file system is (Windows, macOS).
 */
export function relativeTo(root: string, path: string, caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = norm(root)
  const p = norm(path)
  if (!/^([a-zA-Z]:)?\//.test(p)) return p.replace(/^\.\//, '') || null
  const fold = (s: string) => (caseInsensitive ? s.toLowerCase() : s)
  if (!fold(p).startsWith(fold(r) + '/')) return null
  return p.slice(r.length + 1)
}

export function parseNameStatus(out: string): Omit<FileChange, 'added' | 'deleted'>[] {
  const parts = out.split('\0')
  const files: Omit<FileChange, 'added' | 'deleted'>[] = []
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]
    if (!code) continue
    const status = code[0]
    if (status === 'R' || status === 'C') {
      files.push({ status, from: parts[i + 1], path: parts[i + 2] })
      i += 2
    } else {
      files.push({ status, path: parts[i + 1] })
      i += 1
    }
  }
  return files
}

export function parseNumstat(out: string): Map<string, { added: number | null; deleted: number | null }> {
  const parts = out.split('\0')
  const map = new Map<string, { added: number | null; deleted: number | null }>()
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    const [a, d, path] = entry.split('\t')
    const counts = { added: a === '-' ? null : Number(a), deleted: d === '-' ? null : Number(d) }
    if (path === '' || path === undefined) {
      // Rename: "<a>\t<d>\t\0<old>\0<new>\0"
      map.set(parts[i + 2], counts)
      i += 2
    } else {
      map.set(path, counts)
    }
  }
  return map
}
