// Turns a unified patch into side-by-side rows for the review tab. Pure; no I/O.

export type RowKind = 'context' | 'change' | 'add' | 'del' | 'hunk' | 'meta'

export interface SideBySideRow {
  kind: RowKind
  /** Line number on the left (merge base) side, null when the row has no left line. */
  leftNo: number | null
  left: string | null
  rightNo: number | null
  right: string | null
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/

/**
 * Pairs deletions with the additions that follow them (as most review tools do), so a changed
 * line shows old and new on one row. Header lines (diff --git, index, ---/+++) become `meta`.
 */
export function sideBySide(patch: string): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let left = 0
  let right = 0
  let dels: { no: number; text: string }[] = []
  let adds: { no: number; text: string }[] = []
  let inHunk = false

  const flush = () => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) {
      const d = dels[i]
      const a = adds[i]
      rows.push({
        kind: d && a ? 'change' : d ? 'del' : 'add',
        leftNo: d?.no ?? null,
        left: d?.text ?? null,
        rightNo: a?.no ?? null,
        right: a?.text ?? null
      })
    }
    dels = []
    adds = []
  }

  for (const raw of patch.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const hunk = HUNK.exec(line)
    if (hunk) {
      flush()
      left = Number(hunk[1])
      right = Number(hunk[2])
      inHunk = true
      rows.push({ kind: 'hunk', leftNo: null, left: line, rightNo: null, right: hunk[3].trim() || null })
      continue
    }
    if (!inHunk || line.startsWith('diff --git')) {
      if (line) rows.push({ kind: 'meta', leftNo: null, left: line, rightNo: null, right: null })
      inHunk = false
      continue
    }
    if (line.startsWith('\\')) continue // "\ No newline at end of file"
    const mark = line[0]
    const text = line.slice(1)
    if (mark === '-') dels.push({ no: left++, text })
    else if (mark === '+') adds.push({ no: right++, text })
    else if (mark === ' ' || line === '') {
      flush()
      rows.push({ kind: 'context', leftNo: left++, left: text, rightNo: right++, right: text })
    }
  }
  flush()
  return rows
}
