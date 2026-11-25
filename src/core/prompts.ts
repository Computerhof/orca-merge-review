// The texts the plugin hands to agents. Pure functions, so they are tested and reviewed like code.
// Agents read these as instructions: keep them short, concrete and free of anything secret.
// The wording lives in messages.ts, in the plugin's current language.
import { m } from './messages.ts'

export function reviewFeedbackPrompt(input: {
  target: string
  source: string
  path?: string
  note: string
}): string {
  const where = input.path ? ` in \`${input.path}\`` : ''
  return [m.feedbackHead(input.source, input.target, where), '', input.note.trim(), '', m.feedbackTail].join('\n')
}

export function resolveConflictsPrompt(input: {
  target: string
  source: string
  files: readonly string[]
}): string {
  return [
    m.resolveIntro(input.source, input.target),
    ...input.files.map((f) => `- ${f}`),
    '',
    m.resolveTask
  ].join('\n')
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
 * One line put in front of any prompt that reaches an agent in a workspace with a running merge.
 * One line on purpose: a prompt typed into a running agent's TUI is submitted on Enter.
 */
export function mergeHintPrompt(input: { source: string; open: number }): string {
  return m.hint(MERGE_HINT_TAG, input.source, input.open ? m.hintOpen(input.open) : '')
}
