// Git operations behind the panel: state, comparison, merge preview, merge, conflict handling.
// Talks only to a GitRunner; reads and writes working files through `FileAccess`.
import type {
  Comparison,
  CommitRow,
  ConflictFile,
  FileChange,
  MergeInProgress,
  MergeMode,
  MergeOutcome,
  MergePreview,
  ConflictChoice,
  OperationKind,
  RebaseImpact,
  RepoState
} from '../types.ts'
import { git, GitError, LONG_RUNNING_MS, type GitResult, type GitRunner, type RunOptions } from '../git/runner.ts'
import { conflictsOf, displayLines, parseConflicts, resolveConflict } from './conflicts.ts'
import { m } from './messages.ts'

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

/** Files and folders Git writes into a worktree's own Git directory while something is under way. */
const MARKERS = ['MERGE_HEAD', 'SQUASH_MSG', 'rebase-merge', 'rebase-apply', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'sequencer'] as const
type Marker = (typeof MARKERS)[number]

/** What the marker files say is under way; only file reads, no Git call. */
type Markers =
  | { kind: 'rebase'; dir: 'rebase-merge' | 'rebase-apply' }
  | { kind: 'cherry-pick'; head: string | null; todo: string[] | null }
  | { kind: 'merge'; head: string }
  | null

/** A full or abbreviated commit id as Git writes it into its marker files. */
const HEX = /^[0-9a-f]{4,64}$/

export class Repo {
  private readonly runner: GitRunner
  private readonly files: FileAccess
  /** The repository's top level; every path the panel sends is relative to it. */
  readonly root: string
  /** Absolute paths of Git's marker files for this worktree, asked once (`git rev-parse --git-path`). */
  private markerPaths: Promise<Record<Marker, string>> | null = null

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

  /**
   * Only the operation part of `state()`: what is under way (merge, rebase, cherry-pick), cheap
   * enough to poll. Outside any operation that is one Git call (unmerged files) plus a few reads
   * of marker files; the details are asked for only while something is under way.
   * Order: rebase, then cherry-pick, then merge. A rebase or cherry-pick that stopped and is not
   * continued yet counts as under way even when every conflict is resolved (or there was none).
   */
  async mergeSummary(): Promise<CoreState['merge']> {
    const [unmerged, op] = await Promise.all([this.unmerged(), this.markers()])
    if (op?.kind === 'rebase') return this.rebaseSummary(op.dir, unmerged)
    if (op?.kind === 'cherry-pick') return this.pickSummary(op.head, op.todo, unmerged)
    const mergeHead = op?.kind === 'merge' ? op.head : null
    if (mergeHead === null && unmerged.length === 0 && !(await this.squashPending())) return null
    const [source, branch, markerFree] = await Promise.all([
      mergeHead ? this.describe(mergeHead) : Promise.resolve(m.squashLabel),
      this.currentBranch(),
      this.markerFree(unmerged)
    ])
    return {
      kind: 'merge',
      source,
      conflicts: unmerged,
      markerFree,
      step: null,
      sides: { ours: branch ?? 'HEAD', theirs: source },
      branch: null
    }
  }

  /** What is under way, by kind only; null when nothing is. Cheaper than `mergeSummary()`. */
  async operation(): Promise<OperationKind | null> {
    const op = await this.markers()
    if (op) return op.kind
    return (await this.unmerged()).length || (await this.squashPending()) ? 'merge' : null
  }

  /** Absolute paths of the marker files; one Git call per Repo, then cached. */
  private paths(): Promise<Record<Marker, string>> {
    this.markerPaths ??= this.git(['rev-parse', '--path-format=absolute', ...MARKERS.flatMap((n) => ['--git-path', n])])
      .then((r) => {
        const lines = r.stdout.split(/\r?\n/)
        return Object.fromEntries(MARKERS.map((n, i) => [n, (lines[i] ?? '').trim()])) as Record<Marker, string>
      })
      .catch((error: unknown) => {
        this.markerPaths = null
        throw error
      })
    return this.markerPaths
  }

  /** A marker file (or a file inside a marker folder), trimmed; null when it does not exist. */
  private async readMarker(name: Marker, file?: string): Promise<string | null> {
    const base = (await this.paths())[name]
    if (!base) return null
    const text = await this.files.read(file ? this.files.join(base, file) : base)
    return text === null ? null : text.trim()
  }

  /** What is under way according to the marker files alone (file reads, no Git call). */
  private async markers(): Promise<Markers> {
    const [ontoMerge, headNameMerge, rebasing, cherry, todo, mergeHead] = await Promise.all([
      this.readMarker('rebase-merge', 'onto'),
      this.readMarker('rebase-merge', 'head-name'),
      // rebase-apply is also used by `git am`; only the file `rebasing` marks a rebase (apply backend).
      this.readMarker('rebase-apply', 'rebasing'),
      this.readMarker('CHERRY_PICK_HEAD'),
      this.readMarker('sequencer', 'todo'),
      this.readMarker('MERGE_HEAD')
    ])
    if (ontoMerge !== null || headNameMerge !== null) return { kind: 'rebase', dir: 'rebase-merge' }
    if (rebasing !== null) return { kind: 'rebase', dir: 'rebase-apply' }
    // The sequencer also runs `git revert`; only pick lines make it a cherry-pick.
    const picks = todo === null ? [] : todo.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(pick|p)\s/.test(l))
    const head = firstId(cherry)
    if (head || picks.length) return { kind: 'cherry-pick', head, todo: picks.length ? picks : null }
    const merge = firstId(mergeHead)
    return merge ? { kind: 'merge', head: merge } : null
  }

  /** Short hash and subject of a commit Git named in a marker file; null when it is not one. */
  private async commitInfo(rev: string | null): Promise<{ short: string; subject: string } | null> {
    if (!rev || !HEX.test(rev)) return null
    const r = await this.git(['log', '-1', '--format=%h%x1f%s', '--end-of-options', rev, '--'], [0, 128])
    if (r.code !== 0) return null
    const [short, subject] = r.stdout.trim().split('\x1f')
    return short ? { short, subject: subject ?? '' } : null
  }

  private async rebaseSummary(dir: 'rebase-merge' | 'rebase-apply', unmerged: string[]): Promise<MergeInProgress> {
    const merge = dir === 'rebase-merge'
    const read = (file: string) => this.readMarker(dir, file)
    const [onto, headName, num, end, stopped, rebaseHead] = await Promise.all([
      read('onto'),
      read('head-name'),
      read(merge ? 'msgnum' : 'next'),
      read(merge ? 'end' : 'last'),
      read(merge ? 'stopped-sha' : 'original-commit'),
      this.readMarker('REBASE_HEAD')
    ])
    // REBASE_HEAD is the commit Git stopped on; stopped-sha may be left over from an earlier stop.
    const current = firstId(rebaseHead) ?? firstId(stopped)
    const ontoId = firstId(onto)
    const [ontoName, info, markerFree] = await Promise.all([
      ontoId ? this.describe(ontoId) : Promise.resolve('?'),
      this.commitInfo(current),
      this.markerFree(unmerged)
    ])
    const branch = headName?.startsWith('refs/heads/') ? headName.slice('refs/heads/'.length) : null
    const total = Number(end)
    const at = Number(num)
    return {
      kind: 'rebase',
      source: ontoName,
      conflicts: unmerged,
      markerFree,
      step:
        Number.isInteger(total) && total > 0
          ? { current: Math.min(Math.max(at || 1, 1), total), total, commit: info?.short ?? null, subject: info?.subject ?? null }
          : null,
      // Git's "ours" during a rebase is the base being rebased onto, "theirs" the replayed commit.
      sides: { ours: ontoName, theirs: info ? `${info.short} ${info.subject}` : (branch ?? 'HEAD') },
      branch
    }
  }

  /**
   * A cherry-pick. Git keeps no count for a running sequence: `sequencer/todo` lists the commit it
   * stopped on plus those still to come, `sequencer/head` is HEAD before the first pick. So the
   * step is approximated: done = commits made since `sequencer/head`, current = done + 1,
   * total = done + picks in the todo list (a skipped commit drops out of both numbers).
   * A single cherry-pick writes no sequencer: 1 of 1.
   */
  private async pickSummary(head: string | null, todo: string[] | null, unmerged: string[]): Promise<MergeInProgress> {
    // CHERRY_PICK_HEAD is gone when someone concluded the pick with `git commit` mid-sequence.
    const current = head ?? firstId(todo?.[0]?.split(/\s+/)[1] ?? null)
    const doneCount = async (): Promise<number> => {
      if (!todo) return 0
      const start = firstId(await this.readMarker('sequencer', 'head'))
      if (!start) return 0
      const r = await this.git(['rev-list', '--count', `${start}..HEAD`], [0, 128])
      return r.code === 0 ? Number(r.stdout.trim()) || 0 : 0
    }
    const [info, branch, done, markerFree] = await Promise.all([
      this.commitInfo(current),
      this.currentBranch(),
      doneCount(),
      this.markerFree(unmerged)
    ])
    const short = info?.short ?? current?.slice(0, 7) ?? '?'
    const commit = info?.short ?? null
    const subject = info?.subject ?? null
    return {
      kind: 'cherry-pick',
      source: short,
      conflicts: unmerged,
      markerFree,
      step: todo ? { current: done + 1, total: done + todo.length, commit, subject } : { current: 1, total: 1, commit, subject },
      sides: { ours: branch ?? 'HEAD', theirs: info ? `${info.short} ${info.subject}` : short },
      branch: null
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

  /** Every local branch with the commit it points at, in one Git call. */
  async branchHeads(): Promise<Map<string, string>> {
    const r = await this.git(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads'])
    const heads = new Map<string, string>()
    for (const line of r.stdout.split('\n')) {
      const space = line.indexOf(' ')
      if (space > 0) heads.set(line.slice(space + 1).trim().replace(/^refs\/heads\//, ''), line.slice(0, space))
    }
    return heads
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
      throw new UserError(m.invalidBranchName(ref))
    }
    const r = await this.git(
      ['rev-parse', '--verify', '--quiet', '--end-of-options', `${name}^{commit}`],
      [0, 1, 128]
    )
    if (r.code !== 0) throw new UserError(m.notBranchOrCommit(name))
    return r.stdout.trim()
  }

  async compare(source: string, target = 'HEAD'): Promise<Comparison> {
    const [src, tgt] = await Promise.all([this.verify(source), this.verify(target)])
    const [mergeBase, counts] = await Promise.all([this.mergeBase(tgt, src), this.aheadBehind(tgt, src)])
    const [incoming, files, preview, rebase] = await Promise.all([
      counts.ahead ? this.commits(`${tgt}..${src}`) : Promise.resolve([]),
      this.changedFiles(mergeBase ?? tgt, src),
      this.preview(tgt, src, counts, mergeBase !== null),
      // The rebase is always of the current branch; for another target there is nothing to say.
      target === 'HEAD' ? this.rebaseImpact(src, counts.behind) : Promise.resolve(null)
    ])
    return { source, target, mergeBase, incoming, ahead: counts.ahead, behind: counts.behind, files, preview, rebase }
  }

  /**
   * E10: what rebasing the current branch onto `onto` rewrites, and how much of that its upstream
   * already has (then a force push is needed afterwards). Null when HEAD is detached.
   * `commits`: the number of commits HEAD has that `onto` lacks, when the caller already knows it.
   */
  async rebaseImpact(onto: string, commits?: number): Promise<RebaseImpact | null> {
    const [branch, ontoId] = await Promise.all([this.currentBranch(), this.verify(onto)])
    if (!branch) return null
    const count = async (args: string[]) => Number((await this.git(['rev-list', '--count', ...args])).stdout.trim()) || 0
    const [n, up] = await Promise.all([
      commits ?? count([`${ontoId}..HEAD`]),
      this.git(['rev-parse', '--abbrev-ref', '@{upstream}'], [0, 128])
    ])
    const upstream = up.code === 0 ? up.stdout.trim() || null : null
    if (!upstream || n === 0) return { commits: n, pushed: 0, upstream }
    // Commits to rewrite that the upstream does not have yet; the rest is already pushed.
    const local = await count(['HEAD', `^${ontoId}`, '^@{upstream}'])
    return { commits: n, pushed: Math.max(0, n - local), upstream }
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

  /** Refuses while a merge, rebase or cherry-pick is under way, naming it. */
  private async ensureIdle(): Promise<void> {
    const kind = await this.operation()
    if (kind) throw new UserError(kind === 'merge' ? m.mergeAlreadyRunning : m.operationRunning(kind))
  }

  /** The preconditions every operation shares: nothing under way, no tracked changes, a branch checked out. */
  private async ensureReady(): Promise<void> {
    await this.ensureIdle()
    const dirty = await this.dirtyFiles(true)
    if (dirty.length) {
      throw new UserError(m.dirtyTree(dirty.length))
    }
    if (!(await this.currentBranch())) {
      throw new UserError(m.detachedHead)
    }
  }

  /** diff3 writes the common ancestor into each conflict block, so the review tab can show it. */
  private style(options: { showBase?: boolean }): string[] {
    return options.showBase ? ['-c', 'merge.conflictStyle=diff3'] : []
  }

  async merge(
    source: string,
    mode: MergeMode,
    message?: string,
    options: { showBase?: boolean } = {}
  ): Promise<MergeOutcome> {
    await this.verify(source)
    await this.ensureReady()

    const msg = message?.trim()
    const args = [...this.style(options), 'merge']
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
        message: m.conflictFiles(conflicts.length),
        conflicts
      }
    }
    if (r.code !== 0) {
      throw new GitError(m.mergeNotPossible((r.stderr || r.stdout).trim()), r)
    }
    if (/Already up.to.date/i.test(r.stdout)) {
      return { status: 'up-to-date', message: m.alreadyUpToDate, conflicts: [] }
    }
    if (mode === 'squash') {
      const staged = await this.git(['diff', '--cached', '--quiet'], [0, 1])
      if (staged.code === 0) {
        return { status: 'up-to-date', message: m.squashNoChanges, conflicts: [] }
      }
      await this.long(['commit', '-m', msg || m.squashCommitMessage(source)])
      return { status: 'squashed', message: m.squashed(source), conflicts: [] }
    }
    return { status: 'merged', message: m.merged(source), conflicts: [] }
  }

  // ---------------------------------------------------------------- rebase and cherry-pick (E9–E12)

  /**
   * E9: rebases the current branch onto `onto` (`git rebase`, not interactive). Same preconditions
   * as a merge. Stops with `conflicts` like a merge; the person then continues, skips or aborts.
   */
  async rebase(onto: string, options: { showBase?: boolean } = {}): Promise<MergeOutcome> {
    const name = onto.trim()
    await this.verify(name)
    await this.ensureReady()
    const before = await this.head()
    // --no-autostash: a `rebase.autoStash` in the user's config must not stash anything behind our back.
    const r = await this.long([...this.style(options), 'rebase', '--no-autostash', '--end-of-options', name], [0, 1, 128])
    return this.settle('rebase', r, async () =>
      (await this.head()) === before
        ? { status: 'up-to-date', message: m.rebaseUpToDate(name), conflicts: [] }
        : { status: 'rebased', message: m.rebased(name), conflicts: [] }
    )
  }

  /**
   * E11: applies `commits` (any order, full or short ids) with `git cherry-pick -x`, oldest first.
   *
   * The order is the topological order of their history (`git rev-list --topo-order --reverse
   * <commits> ^HEAD`), not commit dates (`--no-walk=sorted`): dates can tie (several commits in
   * one second) or run backwards after a rebase or amend, while parents always come before their
   * children in topological order. Commits HEAD already contains and merge commits are refused.
   */
  async cherryPick(commits: readonly string[], options: { showBase?: boolean } = {}): Promise<MergeOutcome> {
    if (!commits.length) throw new UserError(m.pickNothing)
    const ids: string[] = []
    for (const c of commits) {
      const id = await this.verify(c)
      if (!ids.includes(id)) ids.push(id)
    }
    await this.ensureReady()
    const merges = (await this.git(['rev-list', '--no-walk', '--min-parents=2', ...ids])).stdout.trim()
    if (merges) throw new UserError(m.pickMergeCommit(merges.split('\n')[0].slice(0, 7)))
    const walk = await this.git(['rev-list', '--topo-order', '--reverse', ...ids, '^HEAD'])
    const order = walk.stdout.split('\n').map((l) => l.trim()).filter((id) => ids.includes(id))
    const contained = ids.find((id) => !order.includes(id))
    if (contained) throw new UserError(m.pickAlreadyContained(contained.slice(0, 7)))

    const r = await this.long([...this.style(options), 'cherry-pick', '-x', ...order], [0, 1, 128])
    return this.settle('cherry-pick', r, async () => ({ status: 'picked', message: m.picked(order.length), conflicts: [] }))
  }

  /**
   * Rebase / cherry-pick: goes on once nothing is unmerged (`--continue`). The runner sets
   * `core.editor=true` and GIT_EDITOR=true, so Git keeps the commit message without opening an
   * editor. A resolution that leaves the commit empty is refused with a hint to skip it
   * (cherry-pick refuses that itself; a rebase drops such a commit on its own).
   */
  async continueOp(options: { showBase?: boolean } = {}): Promise<MergeOutcome> {
    const op = await this.runningStep()
    if (op.conflicts.length) {
      throw new UserError(m.unresolvedFiles(op.conflicts.length, op.conflicts.slice(0, 5).join(', ')))
    }
    const r = await this.long([...this.style(options), op.kind, '--continue'], [0, 1, 128])
    if (r.code !== 0 && (await this.operation()) === op.kind && !(await this.unmerged()).length) {
      const out = `${r.stdout}\n${r.stderr}`
      if (/now empty|nothing to commit|no changes/i.test(out)) throw new UserError(m.opEmpty(op.kind))
    }
    return this.settle(op.kind, r, async () => this.finished(op.kind, op.source))
  }

  /** Rebase / cherry-pick: leaves out the commit being applied (`--skip`) and goes on. */
  async skipOp(options: { showBase?: boolean } = {}): Promise<MergeOutcome> {
    const op = await this.runningStep()
    const r = await this.long([...this.style(options), op.kind, '--skip'], [0, 1, 128])
    return this.settle(op.kind, r, async () => {
      const done = this.finished(op.kind, op.source)
      return { ...done, message: `${m.commitSkipped} ${done.message}` }
    })
  }

  /** The rebase or cherry-pick under way, for continue and skip; refuses otherwise. */
  private async runningStep(): Promise<MergeInProgress & { kind: 'rebase' | 'cherry-pick' }> {
    const op = await this.mergeSummary()
    if (!op) throw new UserError(m.noStepOperation)
    if (op.kind === 'merge') throw new UserError(m.mergeUseFinish)
    return op as MergeInProgress & { kind: 'rebase' | 'cherry-pick' }
  }

  private finished(kind: 'rebase' | 'cherry-pick', source: string): MergeOutcome {
    return kind === 'rebase'
      ? { status: 'rebased', message: m.rebased(source), conflicts: [] }
      : { status: 'picked', message: m.pickFinished, conflicts: [] }
  }

  /**
   * After a rebase or cherry-pick command: stopped on conflicts, stopped for another reason
   * (an empty commit, an untracked file in the way; still under way, `conflicts` empty), failed
   * without starting (a GitError), or done.
   */
  private async settle(kind: 'rebase' | 'cherry-pick', r: GitResult, done: () => Promise<MergeOutcome>): Promise<MergeOutcome> {
    const [conflicts, running] = await Promise.all([this.unmerged(), this.operation()])
    if (conflicts.length) {
      return { status: 'conflicts', message: m.conflictFiles(conflicts.length), conflicts }
    }
    const detail = gitDetail(r)
    if (running === kind) {
      const message = /now empty|nothing to commit/i.test(`${r.stdout}\n${r.stderr}`) ? m.opEmpty(kind) : m.opStopped(kind, detail)
      return { status: 'conflicts', message, conflicts: [] }
    }
    if (r.code !== 0) {
      throw new GitError(m.operationNotPossible(kind, detail), r)
    }
    return done()
  }

  /** Aborts what is under way: merge --abort (reset --merge after a squash), rebase --abort, cherry-pick --abort. */
  async abort(): Promise<void> {
    const op = await this.markers()
    if (op?.kind === 'rebase') await this.long(['rebase', '--abort'])
    else if (op?.kind === 'cherry-pick') await this.long(['cherry-pick', '--abort'])
    else if (op?.kind === 'merge') await this.git(['merge', '--abort'])
    else if ((await this.unmerged()).length || (await this.squashPending())) await this.git(['reset', '--merge'])
    else throw new UserError(m.noMergeRunning)
  }

  /**
   * A squash merge leaves no MERGE_HEAD: once its conflicts are resolved it is only visible as
   * SQUASH_MSG plus staged changes. Without this the panel would lose track of it.
   */
  private async squashPending(): Promise<boolean> {
    if ((await this.readMarker('SQUASH_MSG')) === null) return false
    const staged = await this.git(['diff', '--cached', '--quiet'], [0, 1])
    return staged.code === 1
  }

  /**
   * Undoes a merge, rebase or cherry-pick this plugin just finished: HEAD goes back to `before`.
   * Refuses unless HEAD is still exactly `after` and the tree is clean, so it never throws away
   * anything made since.
   */
  async undoMerge(before: string, after: string): Promise<void> {
    const kind = await this.operation()
    if (kind) {
      throw new UserError(kind === 'merge' ? m.mergeRunningUseAbort : m.operationRunningUseAbort(kind))
    }
    if ((await this.head()) !== after) {
      throw new UserError(m.branchChangedSinceMerge)
    }
    if ((await this.dirtyFiles(true)).length) {
      throw new UserError(m.dirtyTreeShort)
    }
    await this.verify(before)
    await this.git(['reset', '--merge', before])
  }

  /** Concludes a merge with a commit. A rebase or cherry-pick goes on with `continueOp()` instead. */
  async commitMerge(message?: string): Promise<string> {
    const kind = (await this.markers())?.kind
    if (kind === 'rebase' || kind === 'cherry-pick') throw new UserError(m.useContinue(kind))
    const left = await this.unmerged()
    if (left.length) {
      throw new UserError(m.unresolvedFiles(left.length, left.slice(0, 5).join(', ')))
    }
    const msg = message?.trim()
    await this.long(msg ? ['commit', '-m', msg] : ['commit', '--no-edit'])
    return (await this.git(['rev-parse', 'HEAD'])).stdout.trim()
  }

  // ---------------------------------------------------------------- park (stash)

  /** Parks the tracked changes in the stash (untracked files stay); returns the stash commit and its files. */
  async park(message: string): Promise<{ sha: string; files: string[] }> {
    const files = await this.dirtyFiles(true)
    if (!files.length) throw new UserError(m.nothingToPark)
    await this.git(['stash', 'push', '--message', message])
    const sha = (await this.git(['rev-parse', '-q', '--verify', 'refs/stash'])).stdout.trim()
    return { sha, files }
  }

  /**
   * Brings parked changes back with `git stash pop`. With `since` (HEAD before the merge) it does
   * nothing when the merge changed one of the parked files, so a person decides instead of Git
   * writing conflict markers into their own work. A pop that conflicts keeps the stash entry.
   */
  async unpark(sha: string, files: readonly string[], since?: string): Promise<'restored' | 'overlap' | 'missing' | 'conflict'> {
    const list = await this.git(['stash', 'list', '--format=%H'])
    const index = list.stdout.split('\n').map((s) => s.trim()).indexOf(sha)
    if (index < 0) return 'missing'
    if (since) {
      const changed = (await this.git(['diff', '--name-only', '-z', since, 'HEAD'])).stdout.split('\0')
      if (changed.some((f) => f && files.includes(f))) return 'overlap'
    }
    const r = await this.git(['stash', 'pop', '--quiet', `stash@{${index}}`], [0, 1])
    return r.code === 0 ? 'restored' : 'conflict'
  }

  // ---------------------------------------------------------------- conflicts

  private async requireUnmerged(path: string): Promise<string> {
    const rel = checkPath(path)
    if (!(await this.unmerged()).includes(rel)) {
      throw new UserError(m.noOpenConflict(rel))
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
    if (text === null) throw new UserError(m.notInWorkingTree(rel))
    if (expect) {
      const block = conflictsOf(parseConflicts(text))[index]
      if (!block || displayLines(block.ours) !== expect.ours || displayLines(block.theirs) !== expect.theirs) {
        throw new UserError(m.changedMeanwhile(rel))
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
      throw new UserError(m.stillHasMarkers(rel))
    }
    await this.git(['add', '-A', '--', rel])
  }
}

/** The first word of a marker file when it is a commit id, else null (nothing else is handed to Git). */
function firstId(text: string | null): string | null {
  const id = text?.trim().split(/\s/)[0] ?? ''
  return HEX.test(id) ? id : null
}

/** Git's own explanation of a failed or stopped command, without its hints, in a few lines. */
function gitDetail(r: GitResult): string {
  return (r.stderr || r.stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('hint:'))
    .slice(0, 4)
    .join(' ')
}

/** Repository-relative, forward slashes, never absolute and never leaving the repository. */
export function checkPath(path: string): string {
  const p = path.replace(/\\/g, '/').trim()
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split('/').includes('..') || p.includes('\0')) {
    throw new UserError(m.invalidPath(path))
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
