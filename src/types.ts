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

export interface MergeInProgress {
  /** What is being merged in (MERGE_HEAD), as a branch name when Git knows one. */
  source: string
  /** Files Git still lists as unmerged. */
  conflicts: string[]
  /** Unmerged files whose working copy no longer has conflict markers (ready to mark resolved). */
  markerFree: string[]
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
  /** Why the panel cannot work here, in words for the person; null when it can. */
  problem: string | null
  branch: string | null
  branches: string[]
  /** Changed or untracked files in the working tree (outside an ongoing merge). */
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
  /** Commits on source that target lacks (what a merge brings in), newest first. */
  incoming: CommitRow[]
  /** How many commits target has that source lacks. */
  behind: number
  files: FileChange[]
  preview: MergePreview
}

export interface MergePreview {
  /** False when the merge would stop with conflicts. Null when Git is too old for merge-tree. */
  clean: boolean | null
  conflicts: string[]
  /** True when target already contains source (nothing to merge). */
  upToDate: boolean
  /** True when target can fast-forward to source. */
  fastForward: boolean
}

export interface MergeOutcome {
  status: 'merged' | 'conflicts' | 'up-to-date' | 'squashed'
  message: string
  conflicts: string[]
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
