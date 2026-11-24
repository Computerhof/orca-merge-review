import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeMarkersSync } from '../src/git/mergeMarkers.ts'
import { Repo } from '../src/core/repo.ts'
import { localFiles } from '../src/git/files.ts'
import { divergent, runner, withSandbox } from './helpers.ts'

test('mergeMarkersSync follows a merge in the main working tree', () =>
  withSandbox(async (s) => {
    await divergent(s)
    assert.equal(mergeMarkersSync(s.dir), false)
    await s.repo.merge('feature', 'no-ff')
    assert.equal(mergeMarkersSync(s.dir), true)
    await s.repo.abort()
    assert.equal(mergeMarkersSync(s.dir), false)
  }))

test('mergeMarkersSync sees a squash merge and a merge in a linked worktree', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await s.repo.merge('feature', 'squash')
    assert.equal(mergeMarkersSync(s.dir), true, 'squash leaves SQUASH_MSG')
    await s.repo.abort()

    const parent = await mkdtemp(join(tmpdir(), 'merge-review-wt-'))
    const wt = join(parent, 'linked')
    try {
      await s.git('worktree', 'add', '--quiet', '-b', 'side', wt, 'main')
      const repo = (await Repo.open(runner, localFiles, wt))!
      assert.equal(mergeMarkersSync(wt), false)
      await repo.merge('feature', 'no-ff')
      assert.equal(mergeMarkersSync(wt), true, 'linked worktree: .git is a file')
      assert.equal(mergeMarkersSync(s.dir), false, 'the main tree is not merging')
      await repo.abort()
    } finally {
      await s.git('worktree', 'remove', '--force', wt).catch(() => '')
      await rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }))

test('mergeMarkersSync is false for a folder that is no repository', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'merge-review-plain-'))
  try {
    assert.equal(mergeMarkersSync(dir), false)
    assert.equal(mergeMarkersSync(join(dir, 'missing')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
