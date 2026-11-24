// K10: how ready a workspace is to be merged into the base, and how the panel says it. Pure, shared
// by the worker (sorting) and the panel (labels), tested in CI.
import type { OverviewRow } from '../types.ts'

/** 0 ready (clean or fast-forward), 1 conflicts, 2 cannot be predicted, 3 nothing to merge. */
export function readiness(r: Pick<OverviewRow, 'ahead' | 'preview'>): 0 | 1 | 2 | 3 {
  const p = r.preview
  if (r.ahead === 0 || p.upToDate) return 3
  if (p.fastForward || p.clean === true) return 0
  if (p.clean === false) return 1
  return 2
}

export function readinessLabel(r: Pick<OverviewRow, 'ahead' | 'preview'>): string {
  const p = r.preview
  switch (readiness(r)) {
    case 0:
      return p.fastForward ? '✓ Fast-forward' : '✓ konfliktfrei'
    case 1:
      return `⚠ ${p.conflicts.length} Konflikt-Datei(en)`
    case 2:
      return p.unrelated ? 'keine gemeinsame Historie' : 'keine Vorhersage'
    default:
      return 'schon enthalten'
  }
}

export function byReadiness(a: OverviewRow, b: OverviewRow): number {
  return readiness(a) - readiness(b) || a.name.localeCompare(b.name)
}
