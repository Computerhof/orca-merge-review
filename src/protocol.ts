// The panel/editor <-> worker contract, declared once and read by every surface.
// Renaming a request or changing a shape is a breaking change (see CHANGELOG.md).
import type {
  AgentDelivery,
  Comparison,
  ConflictChoice,
  ConflictFile,
  MergeMode,
  MergeOutcome,
  MergeWatch,
  RepoState,
  ReviewView
} from './types.ts'

export type * from './types.ts'

/** Every request may name the workspace it is about; without it, the focused workspace. */
type Ws = { workspaceId?: string }

declare module 'orca' {
  interface PluginRequests {
    /** Where the workspace stands: branch, sources, dirty files, an ongoing or undoable merge. */
    'repo.state': { input: Ws; output: RepoState }
    /** Compares `source` with the current branch and predicts the merge. Remembers `source`. */
    'repo.compare': { input: Ws & { source: string }; output: Comparison }
    /** The patch of one file as the merge would bring it in (merge-base...source). */
    'repo.fileDiff': {
      /** `from`: the old path of a renamed file, so the patch pairs both instead of showing a new file. */
      input: Ws & { source: string; path: string; from?: string }
      output: { patch: string; truncated: boolean }
    }
    /** Merges `source` into the current branch. Refuses on a dirty tree or an ongoing merge. */
    'merge.run': { input: Ws & { source: string; mode: MergeMode; message?: string }; output: MergeOutcome }
    /** git merge --abort (or reset --merge after a squash). */
    'merge.abort': { input: Ws; output: { ok: true } }
    /** Concludes the ongoing merge with a commit once nothing is unmerged. */
    'merge.commit': { input: Ws & { message?: string }; output: { hash: string } }
    /** Undoes the last merge this plugin made here, if nothing happened since. */
    'merge.undo': { input: Ws; output: { ok: true } }
    /** Focuses the terminal of the agent working on `source` (a workspace of this project), else opens that workspace. */
    'agent.focus': { input: Ws & { source: string }; output: { how: 'terminal' | 'workspace' } }
    /** The conflict blocks of one unmerged file. */
    'conflict.get': { input: Ws & { path: string }; output: ConflictFile }
    /** Replaces one conflict block with a side, writes the file, answers the file again. With
     *  `expect` (the block's sides as shown) it refuses when the block changed in the meantime. */
    'conflict.resolveHunk': {
      input: Ws & { path: string; index: number; choice: ConflictChoice; expect?: { ours: string; theirs: string } }
      output: ConflictFile
    }
    /** Takes the whole file from one side and stages it. */
    'conflict.takeFile': { input: Ws & { path: string; side: 'ours' | 'theirs' }; output: { ok: true } }
    /** git add: marks a file resolved. Refuses while it still has conflict markers. */
    'conflict.markResolved': { input: Ws & { path: string }; output: { ok: true } }
    /** Opens the file in a normal Orca editor tab, for hand edits. */
    'conflict.openInEditor': { input: Ws & { path: string }; output: { ok: true } }
    /** Opens (or retargets) the wide review tab. */
    'review.open': { input: ReviewView & Ws; output: { ok: true } }
    /** Sends a review note to the agent of the source workspace (running, resumed or new). */
    'agent.feedback': { input: Ws & { source: string; path?: string; note: string }; output: AgentDelivery }
    /** Starts an agent in this workspace that resolves the open conflicts (the person still commits). */
    'agent.resolveConflicts': { input: Ws; output: AgentDelivery }
    /** The scheduled merge check (an Orca automation) for this workspace, if any. */
    'watch.get': { input: Ws; output: { watch: MergeWatch | null } }
    /** Creates, pauses or removes the scheduled merge check. */
    'watch.set': { input: Ws & { enabled: boolean; remove?: boolean }; output: { watch: MergeWatch | null } }
  }
  interface PluginPanelEvents {
    /** Posted after anything changed a repository, so open panels and tabs reload. */
    'repo.changed': { workspaceId: string | null; reason: string }
    /** A conflicted file was saved without markers and marked resolved automatically (setting autoMarkResolved). */
    'conflict.autoResolved': { workspaceId: string; path: string }
    /** The agent of a compared source workspace finished: the comparison may be stale. */
    'source.updated': { workspaceId: string; source: string }
  }
}
