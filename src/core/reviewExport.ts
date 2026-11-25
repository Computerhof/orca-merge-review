// The review as Markdown: comparison, prediction, commits, files and the notes written in the tab.
// Pure, so it is tested like the rest of the core; the tab only hands it to Orca's save dialog.
import type { Comparison } from '../types.ts'
import { m } from './messages.ts'

export interface ReviewNote {
  /** Repository-relative file, or null for a note about the whole change. */
  path: string | null
  text: string
  /** True once it went to the agent of the source workspace. */
  sent: boolean
}

/** Text for a Markdown table cell: one line, backslashes and pipes escaped (in that order). */
export function cell(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

export function predictionText(c: Comparison): string {
  const p = c.preview
  if (p.upToDate) return m.predUpToDate
  if (p.fastForward) return m.predFastForward
  if (p.unrelated) return m.predUnrelated
  if (p.clean === null) return m.predUnknown
  if (p.clean) return m.predClean
  return m.predConflicts(p.conflicts.length, p.conflicts.join(', '))
}

export function reviewMarkdown(input: {
  target: string
  comparison: Comparison
  notes: readonly ReviewNote[]
  /** Milliseconds since the epoch; passed in so the output is deterministic in tests. */
  at: number
  version: string
}): string {
  const c = input.comparison
  const added = c.files.reduce((n, f) => n + (f.added ?? 0), 0)
  const deleted = c.files.reduce((n, f) => n + (f.deleted ?? 0), 0)
  const out: string[] = [
    m.exportTitle(c.source, input.target),
    '',
    m.exportAsOf(new Date(input.at).toISOString().slice(0, 16).replace('T', ' ')),
    m.exportCounts(c.ahead, c.files.length, added, deleted) + (c.behind ? m.exportBehind(input.target, c.behind) : ''),
    m.exportPrediction(predictionText(c)),
    ''
  ]

  const general = input.notes.filter((n) => n.path === null && n.text.trim())
  const perFile = input.notes.filter((n) => n.path !== null && n.text.trim())
  if (general.length || perFile.length) {
    out.push(m.exportNotes, '')
    for (const n of general) out.push(...noteLines(n), '')
    for (const n of perFile) out.push(`### \`${n.path}\``, '', ...noteLines(n), '')
  }

  if (c.incoming.length) {
    out.push(c.ahead > c.incoming.length ? m.exportCommitsPartial(c.incoming.length, c.ahead) : m.exportCommits(c.ahead), '')
    for (const x of c.incoming) out.push(`- \`${x.short}\` ${x.subject} (${x.author})`)
    out.push('')
  }

  if (c.files.length) {
    out.push(m.exportFiles(c.files.length), '', m.exportTableHead, '|---|---|---|')
    for (const f of c.files) {
      const name = f.from ? `${f.from} → ${f.path}` : f.path
      const warn = c.preview.conflicts.includes(f.path) ? ' ⚠' : ''
      const delta = f.added === null ? m.exportBinary : `+${f.added} −${f.deleted}`
      out.push(`| ${f.status}${warn} | ${cell(name)} | ${delta} |`)
    }
    out.push('')
  }

  out.push(m.exportCreatedWith(input.version), '')
  return out.join('\n')
}

function noteLines(n: ReviewNote): string[] {
  const lines = n.text.trim().split(/\r?\n/).map((l) => `> ${l}`)
  return n.sent ? [...lines, '', m.exportSentToAgent] : lines
}
