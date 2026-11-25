// Plain data types shared by the core, the worker, the panel and the editor tab.
// No Orca imports: the core and its tests run in plain Node (CI) without Orca's typings.

export type MergeMode = 'ff' | 'no-ff' | 'ff-only' | 'squash'
export type ConflictChoice = 'ours' | 'theirs' | 'both' | 'base'

export interface WorkspaceInfo {
  id: string
  name: string
  path: string
  /** False for a workspace on an SSH or remote Orca host: v0.1 runs Git locally only. */
  supported: boolean
  hostId: string | null
}

/** What is under way in a working tree (v0.5: also rebase and cherry-pick, E9–E12 in docs/UX-PLAN.md). */
export type OperationKind = 'merge' | 'rebase' | 'cherry-pick'

export interface MergeInProgress {
  /** Merge, rebase or cherry-pick. The field is called `merge` in RepoState for compatibility. */
  kind: OperationKind
  /**
   * Merge: what is being merged in (MERGE_HEAD), as a branch name when Git knows one.
   * Rebase: the branch or commit it rebases onto. Cherry-pick: the commit being applied (short hash).
   */
  source: string
  /** Files Git still lists as unmerged. */
  conflicts: string[]
  /** Unmerged files whose working copy no longer has conflict markers (ready to mark resolved). */
  markerFree: string[]
  /**
   * Rebase and cherry-pick apply commits one by one: which one is being applied (1-based) of how many,
   * its short hash and subject. Null for a merge, or when Git does not tell (cherry-pick of one commit: 1 of 1).
   */
  step: { current: number; total: number; commit: string | null; subject: string | null } | null
  /**
   * Names for the two sides of a conflict, already the right way round: during a rebase Git's
   * "ours" is the base being rebased onto and "theirs" the commit being replayed.
   * Merge: { ours: current branch, theirs: source }. Rebase: { ours: onto, theirs: "abc123 subject" }.
   * Cherry-pick: { ours: current branch, theirs: "abc123 subject" }.
   */
  sides: { ours: string; theirs: string }
  /** The branch being rebased (rebase only; HEAD is detached meanwhile), else null. */
  branch: string | null
}

/** Agent activity of a workspace, as Orca reports it. */
export type AgentActivity = 'working' | 'permission' | 'done' | 'active' | 'inactive'

/** Something the person can merge in: an Orca workspace of the same project, or a plain ref. */
export interface SourceOption {
  /** What Git merges: the branch name. */
  ref: string
  label: string
  kind: 'workspace' | 'branch' | 'remote'
  workspaceId?: string
  agent?: AgentActivity
  /** The project's base branch (Orca's base ref, else main/master). */
  isBase?: boolean
}

/** A merge this plugin made and can still undo. */
export interface LastMerge {
  source: string
  before: string
  after: string
  /** Unix ms. */
  at: number
  commits: number
}

export interface MergeWatch {
  automationId: string
  base: string
  schedule: string
  enabled: boolean
  nextRunAt: number | null
}

export interface RepoState {
  workspace: WorkspaceInfo | null
  /** The project's base branch (remote default, else main/master/develop); null if none. */
  base: string | null
  /** Changes parked for a merge that are not back yet (they come back after the merge, or by hand). */
  parked: ParkedChanges | null
  /** The plugin's running or last job here (tests, probe merge), until dismissed. */
  job: JobState | null
  /** The test command of this workspace's project (set in the panel), or null. */
  testCommand: string | null
  /** What the plugin would suggest for this project (from package.json, Cargo.toml, …), or null. */
  suggestedTest: { command: string; because: string } | null
  /** The Orca project this workspace belongs to, for labels ("Tests für amt-attest-v2"). */
  projectName: string | null
  /** An agent this panel started that never began its prompt (Orca did not send it). */
  stalledAgent: { terminalId: string } | null
  /** Why the panel cannot work here, in words for the person; null when it can. */
  problem: string | null
  branch: string | null
  /** The commit HEAD points at; null in an empty repository. Lets the panel notice the branch moved. */
  head: string | null
  branches: string[]
  /** Tracked files with uncommitted changes (outside an ongoing merge); they block a merge. */
  dirtyFiles: string[]
  merge: MergeInProgress | null
  /** Orca workspaces of the same project first, then other branches and remotes. */
  sources: SourceOption[]
  /** What the panel preselects: the last source used here, else the base branch. */
  suggestedSource: string | null
  lastMerge: LastMerge | null
}

export interface CommitRow {
  hash: string
  short: string
  subject: string
  author: string
  /** Unix ms. */
  at: number
}

export interface FileChange {
  path: string
  /** A, M, D, R, C, T as git diff --name-status reports it. */
  status: string
  /** Old path for a rename or copy. */
  from?: string
  added: number | null
  deleted: number | null
}

export interface Comparison {
  source: string
  target: string
  mergeBase: string | null
  /** Commits on source that target lacks (what a merge brings in), newest first; at most 200. */
  incoming: CommitRow[]
  /** How many commits source has that target lacks (the real number; `incoming` may be cut). */
  ahead: number
  /** How many commits target has that source lacks. */
  behind: number
  files: FileChange[]
  preview: MergePreview
  /** Rebasing the current branch onto `source` (E9/E10); null when the branch is detached. */
  rebase: RebaseImpact | null
}

export interface MergePreview {
  /** False when the merge would stop with conflicts. Null when it cannot be predicted (Git older than 2.38, or `unrelated`). */
  clean: boolean | null
  /** True when source and target share no history; Git refuses to merge them. */
  unrelated?: boolean
  conflicts: string[]
  /** True when target already contains source (nothing to merge). */
  upToDate: boolean
  /** True when target can fast-forward to source. */
  fastForward: boolean
}

/** Tracked changes the plugin parked in the stash for a merge ("Änderungen parken und mergen"). */
export interface ParkedChanges {
  files: string[]
  /** The source of the merge they were parked for. */
  source: string
  at: number
}

/** K11/K12: a long-running job of the plugin in one workspace: tests after a merge, or a probe merge. */
export interface JobState {
  kind: 'tests' | 'probe'
  status: 'running' | 'passed' | 'clean' | 'failed' | 'conflicts' | 'error'
  /** The merged or probed source, when there is one. */
  source: string | null
  /** The test command, when tests ran or run. */
  command: string | null
  startedAt: number
  finishedAt: number | null
  exitCode: number | null
  /** One sentence for the person. */
  message: string
  /** The last lines of the test output. */
  tail: string[]
  /** Files a probe merge would leave in conflict. */
  conflicts: string[]
}

/** K10: one workspace of the project, seen from the base branch. */
export interface OverviewRow {
  workspaceId: string
  name: string
  branch: string
  agent?: AgentActivity
  /** Commits the workspace has that the base lacks. */
  ahead: number
  /** Commits the base has that the workspace lacks. */
  behind: number
  preview: MergePreview
}

export interface Overview {
  base: string
  rows: OverviewRow[]
}

export interface MergeOutcome {
  /** `rebased` / `picked`: a rebase or cherry-pick finished; `skipped`: the last commit was skipped and the operation finished. */
  status: 'merged' | 'conflicts' | 'up-to-date' | 'squashed' | 'rebased' | 'picked'
  message: string
  conflicts: string[]
}

/** What rebasing the current branch onto a source would rewrite (E10: warn about pushed commits). */
export interface RebaseImpact {
  /** Commits of the current branch that get rewritten (they are not in the source). */
  commits: number
  /** Of those, how many the branch's upstream already has: rebasing them needs a force push afterwards. 0 without an upstream. */
  pushed: number
  /** The upstream's name, e.g. `origin/feature`, or null. */
  upstream: string | null
}

export interface ConflictHunk {
  index: number
  oursLabel: string
  theirsLabel: string
  ours: string
  base: string | null
  theirs: string
}

export interface ConflictFile {
  path: string
  hunks: ConflictHunk[]
  /** The file is unmerged in Git but its working copy has no markers left. */
  markerFree: boolean
  /** Deleted on one side, or binary: only a whole-file choice works. */
  wholeFileOnly: boolean
  stage: { base: boolean; ours: boolean; theirs: boolean }
}


/** What the review tab shows; stored as JSON in the tab's helper file. */
export type ReviewView =
  | { view: 'overview'; source?: string }
  | { view: 'diff'; source: string; path: string }
  | { view: 'conflict'; path: string }

export type ReviewTicket = ReviewView & { v: 1; workspaceId: string }

export interface AgentDelivery {
  /** sent: typed into a running agent; resumed: its last session was resumed; launched: a new agent. */
  how: 'sent' | 'resumed' | 'launched'
  terminalId: string
}
