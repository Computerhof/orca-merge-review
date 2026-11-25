// The texts the plugin hands to agents. Pure functions, so they are tested and reviewed like code.
// Agents read these as instructions: keep them short, concrete and free of anything secret.
// The wording lives in messages.ts, in the plugin's current language.
import { m } from './messages.ts'
import type { MergeInProgress, OperationKind } from '../types.ts'

export function reviewFeedbackPrompt(input: {
  target: string
  source: string
  path?: string
  note: string
}): string {
  const where = input.path ? ` in \`${input.path}\`` : ''
  return [m.feedbackHead(input.source, input.target, where), '', input.note.trim(), '', m.feedbackTail].join('\n')
}

/**
 * The launch prompt of a conflict agent. `op` (what `mergeSummary()` reports) names a rebase or
 * cherry-pick and its rules; without it, or for a merge, the merge prompt.
 */
export function resolveConflictsPrompt(input: {
  target: string
  source: string
  files: readonly string[]
  op?: Pick<MergeInProgress, 'kind' | 'step' | 'branch'> | null
}): string {
  const op = input.op
  const files = input.files.map((f) => `- ${f}`)
  if (!op || op.kind === 'merge') {
    return [m.resolveIntro(input.source, input.target), ...files, '', m.resolveTask].join('\n')
  }
  const s = op.step
  const step = s?.commit ? m.resolveStep(s.current, s.total, `${s.commit} ${s.subject ?? ''}`.trim()) : ''
  const intro =
    op.kind === 'rebase'
      ? m.resolveIntroRebase(input.source, op.branch ?? input.target, step)
      : m.resolveIntroPick(input.source, input.target, step)
  return [intro, ...files, '', m.resolveTaskStep(op.kind)].join('\n')
}

export function mergeWatchPrompt(input: { base: string }): string {
  return m.watchLines(input.base)
}

/** K11: tests went red after a merge; the agent finds and fixes the cause on top of the merge. */
export function testFixPrompt(input: {
  target: string
  source: string | null
  command: string
  exitCode: number | null
  tail: readonly string[]
}): string {
  const what = input.source ? m.testFixAfterMerge(input.source, input.target) : m.testFixOn(input.target)
  return [
    m.testFixHead(what, input.command, input.exitCode ?? '?'),
    '',
    m.testFixOutput,
    '```',
    ...input.tail.slice(-40),
    '```',
    '',
    m.testFixTask
  ].join('\n')
}

/** Marks text the plugin itself put in front of a prompt, so it is never added twice. */
export const MERGE_HINT_TAG = '[Merge & Review]'

/**
 * One line put in front of any prompt that reaches an agent in a workspace with a running merge,
 * rebase or cherry-pick (`kind`, default merge). One line on purpose: a prompt typed into a
 * running agent's TUI is submitted on Enter.
 */
export function mergeHintPrompt(input: { source: string; open: number; kind?: OperationKind }): string {
  const open = input.open ? m.hintOpen(input.open) : ''
  return !input.kind || input.kind === 'merge'
    ? m.hint(MERGE_HINT_TAG, input.source, open)
    : m.hintStep(MERGE_HINT_TAG, input.kind, input.source, open)
}
