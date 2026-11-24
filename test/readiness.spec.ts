import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byReadiness, readiness, readinessLabel } from '../src/core/readiness.ts'
import type { MergePreview, OverviewRow } from '../src/types.ts'

const p = (over: Partial<MergePreview>): MergePreview => ({ clean: true, conflicts: [], upToDate: false, fastForward: false, ...over })
const row = (name: string, ahead: number, preview: MergePreview): OverviewRow => ({
  workspaceId: name,
  name,
  branch: name,
  ahead,
  behind: 0,
  preview
})

test('readiness: ready, conflicts, unknown, nothing to merge', () => {
  assert.equal(readiness(row('a', 2, p({}))), 0)
  assert.equal(readiness(row('a', 2, p({ fastForward: true }))), 0)
  assert.equal(readiness(row('a', 2, p({ clean: false, conflicts: ['x'] }))), 1)
  assert.equal(readiness(row('a', 2, p({ clean: null, unrelated: true }))), 2)
  assert.equal(readiness(row('a', 0, p({ upToDate: true }))), 3)
  assert.equal(readinessLabel(row('a', 2, p({ clean: false, conflicts: ['x', 'y'] }))), '⚠ 2 Konflikt-Datei(en)')
  assert.equal(readinessLabel(row('a', 2, p({ fastForward: true }))), '✓ Fast-forward')
  assert.equal(readinessLabel(row('a', 2, p({ clean: null, unrelated: true }))), 'keine gemeinsame Historie')
})

test('the overview lists ready workspaces first, then by name', () => {
  const rows = [
    row('zeta', 0, p({ upToDate: true })),
    row('beta', 1, p({ clean: false, conflicts: ['x'] })),
    row('gamma', 3, p({})),
    row('alpha', 1, p({ fastForward: true }))
  ]
  assert.deepEqual(rows.sort(byReadiness).map((r) => r.name), ['alpha', 'gamma', 'beta', 'zeta'])
})
