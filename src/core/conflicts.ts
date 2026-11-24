// Pure parsing and resolving of Git conflict markers. No I/O: the worker reads and writes the file.
// Handles the default `merge` style and `diff3`/`zdiff3` (with a `|||||||` base section).
// Line endings are kept exactly as they are in the file (CRLF stays CRLF).

export type ConflictChoice = 'ours' | 'theirs' | 'both' | 'base'

export interface TextSegment {
  kind: 'text'
  lines: string[]
}

export interface ConflictSegment {
  kind: 'conflict'
  oursLabel: string
  theirsLabel: string
  ours: string[]
  /** Only present when the file was written with merge.conflictStyle diff3 or zdiff3. */
  base: string[] | null
  baseLabel: string
  theirs: string[]
}

export type Segment = TextSegment | ConflictSegment

const OURS = '<<<<<<<'
const BASE = '|||||||'
const SEP = '======='
const THEIRS = '>>>>>>>'

/** Splits into lines, each keeping its own line ending. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function stripEol(line: string): string {
  return line.replace(/\r?\n$/, '')
}

/** A marker is exactly seven marker characters at line start, then end of line or a space. */
function markerOf(line: string): { marker: string; label: string } | null {
  const bare = stripEol(line)
  for (const marker of [OURS, BASE, SEP, THEIRS]) {
    if (bare === marker) return { marker, label: '' }
    if (bare.startsWith(marker + ' ') && marker !== SEP) {
      return { marker, label: bare.slice(marker.length + 1) }
    }
  }
  return null
}

/**
 * Parses a file into plain text and conflict segments. A broken block (a `<<<<<<<` that never
 * closes) is kept as plain text, so writing the segments back never loses content.
 */
export function parseConflicts(text: string): Segment[] {
  const lines = splitLines(text)
  const segments: Segment[] = []
  let plain: string[] = []
  let i = 0

  const flushPlain = () => {
    if (plain.length) segments.push({ kind: 'text', lines: plain })
    plain = []
  }

  while (i < lines.length) {
    const start = markerOf(lines[i])
    if (start?.marker !== OURS) {
      plain.push(lines[i++])
      continue
    }
    const block = readBlock(lines, i, start.label)
    if (!block) {
      plain.push(lines[i++])
      continue
    }
    flushPlain()
    segments.push(block.segment)
    i = block.next
  }
  flushPlain()
  return segments
}

function readBlock(
  lines: string[],
  start: number,
  oursLabel: string
): { segment: ConflictSegment; next: number } | null {
  const ours: string[] = []
  const theirs: string[] = []
  let base: string[] | null = null
  let baseLabel = ''
  let section: 'ours' | 'base' | 'theirs' = 'ours'

  for (let i = start + 1; i < lines.length; i++) {
    const m = markerOf(lines[i])
    if (m?.marker === OURS) return null // nested or broken: leave it alone
    if (m?.marker === BASE && section === 'ours') {
      section = 'base'
      base = []
      baseLabel = m.label
      continue
    }
    if (m?.marker === SEP && section !== 'theirs') {
      section = 'theirs'
      continue
    }
    if (m?.marker === THEIRS && section === 'theirs') {
      return {
        segment: { kind: 'conflict', oursLabel, theirsLabel: m.label, ours, base, baseLabel, theirs },
        next: i + 1
      }
    }
    if (section === 'ours') ours.push(lines[i])
    else if (section === 'base') base!.push(lines[i])
    else theirs.push(lines[i])
  }
  return null
}

export function conflictsOf(segments: readonly Segment[]): ConflictSegment[] {
  return segments.filter((s): s is ConflictSegment => s.kind === 'conflict')
}

export function countConflicts(text: string): number {
  return conflictsOf(parseConflicts(text)).length
}

function chosenLines(conflict: ConflictSegment, choice: ConflictChoice): string[] {
  switch (choice) {
    case 'ours':
      return conflict.ours
    case 'theirs':
      return conflict.theirs
    case 'base':
      if (!conflict.base) throw new Error('Diese Datei enthält keinen Basis-Abschnitt (diff3).')
      return conflict.base
    case 'both': {
      // Make sure the two halves do not run together on one line.
      const ours = [...conflict.ours]
      const last = ours.length - 1
      if (last >= 0 && !ours[last].endsWith('\n') && conflict.theirs.length) {
        ours[last] += detectEol(conflict.theirs)
      }
      return [...ours, ...conflict.theirs]
    }
  }
}

function detectEol(lines: readonly string[]): string {
  return lines.some((l) => l.endsWith('\r\n')) ? '\r\n' : '\n'
}

/** Replaces conflict number `index` (0-based, in file order) with the chosen side. */
export function resolveConflict(text: string, index: number, choice: ConflictChoice): string {
  const segments = parseConflicts(text)
  // A block whose sides are empty has no line ending of its own; it gets the file's.
  const fileEol = text.includes('\r\n') ? '\r\n' : '\n'
  let seen = -1
  let found = false
  const out: string[] = []
  for (const segment of segments) {
    if (segment.kind === 'text') {
      out.push(...segment.lines)
      continue
    }
    seen++
    if (seen === index) {
      out.push(...chosenLines(segment, choice))
      found = true
    } else {
      out.push(...renderConflict(segment, fileEol))
    }
  }
  if (!found) throw new Error(`Konflikt ${index + 1} gibt es in dieser Datei nicht (mehr).`)
  return out.join('')
}

/** Writes a conflict block back exactly as Git wrote it. */
export function renderConflict(c: ConflictSegment, fallbackEol = '\n'): string[] {
  const sides = [...c.ours, ...c.theirs, ...(c.base ?? [])]
  const eol = sides.length ? detectEol(sides) : fallbackEol
  const head = (marker: string, label: string) => (label ? `${marker} ${label}` : marker) + eol
  return [
    head(OURS, c.oursLabel),
    ...c.ours,
    ...(c.base ? [head(BASE, c.baseLabel), ...c.base] : []),
    SEP + eol,
    ...c.theirs,
    head(THEIRS, c.theirsLabel)
  ]
}

/** Lines without their endings, for display. */
export function displayLines(lines: readonly string[]): string {
  return lines.map(stripEol).join('\n')
}
