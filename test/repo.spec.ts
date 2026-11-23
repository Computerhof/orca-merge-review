// The core against real Git repositories in a temp folder: Git itself is never mocked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPath, UserError } from '../src/core/repo.ts'
import { divergent, withSandbox } from './helpers.ts'

test('state of a clean repository', () =>
  withSandbox(async (s) => {
    const st = await s.repo.state()
    assert.equal(st.branch, 'main')
    assert.deepEqual(st.branches, ['main'])
    assert.deepEqual(st.dirtyFiles, [])
    assert.equal(st.merge, null)
  }))

test('compare predicts conflicts without touching the working tree', () =>
  withSandbox(async (s) => {
    await divergent(s)
    const c = await s.repo.compare('feature')
    assert.equal(c.incoming.length, 1)
    assert.equal(c.incoming[0].subject, 'feature: zwei')
    assert.equal(c.behind, 1)
    assert.deepEqual(c.files.map((f) => `${f.status} ${f.path} +${f.added} -${f.deleted}`).sort(), [
      'A b.txt +1 -0',
      'M a.txt +1 -1'
    ])
    assert.equal(c.preview.clean, false)
    assert.deepEqual(c.preview.conflicts, ['a.txt'])
    assert.equal(await s.read('a.txt'), 'eins\nZWEI-main\ndrei\n')
    assert.deepEqual((await s.repo.state()).dirtyFiles, [])
    assert.match((await s.repo.fileDiff('feature', 'a.txt')).patch, /\+ZWEI-feature/)
  }))

test('fast-forward and up-to-date are recognised', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '-b', 'ahead')
    await s.commit('more', { 'c.txt': 'c\n' })
    await s.git('checkout', '--quiet', 'main')
    assert.equal((await s.repo.compare('ahead')).preview.fastForward, true)
    assert.equal((await s.repo.merge('ahead', 'ff-only')).status, 'merged')
    assert.equal((await s.repo.compare('ahead')).preview.upToDate, true)
  }))

test('full conflict round trip: merge, resolve per block, mark, commit', () =>
  withSandbox(async (s) => {
    await divergent(s)
    const out = await s.repo.merge('feature', 'no-ff')
    assert.equal(out.status, 'conflicts')
    assert.deepEqual(out.conflicts, ['a.txt'])

    const st = await s.repo.state()
    assert.equal(st.merge?.source, 'feature')
    assert.deepEqual(st.merge?.markerFree, [])

    const file = await s.repo.conflict('a.txt')
    assert.equal(file.hunks.length, 1)
    assert.equal(file.hunks[0].ours, 'ZWEI-main')
    assert.equal(file.hunks[0].theirs, 'ZWEI-feature')

    await assert.rejects(s.repo.markResolved('a.txt'), UserError)
    await assert.rejects(s.repo.commitMerge(), /ungelöste/)

    const after = await s.repo.resolveHunk('a.txt', 0, 'both')
    assert.equal(after.markerFree, true)
    assert.equal(await s.read('a.txt'), 'eins\nZWEI-main\nZWEI-feature\ndrei\n')
    await s.repo.markResolved('a.txt')
    assert.match(await s.repo.commitMerge(), /^[0-9a-f]{40}$/)
    assert.equal((await s.git('rev-list', '--parents', '-n1', 'HEAD')).trim().split(' ').length, 3)
    assert.equal((await s.repo.state()).merge, null)
  }))

test('diff3 conflicts expose the base', () =>
  withSandbox(
    async (s) => {
      await divergent(s)
      await s.repo.merge('feature', 'no-ff')
      const file = await s.repo.conflict('a.txt')
      assert.equal(file.hunks[0].base, 'zwei')
      await s.repo.resolveHunk('a.txt', 0, 'base')
      assert.equal(await s.read('a.txt'), 'eins\nzwei\ndrei\n')
    },
    { conflictStyle: 'diff3' }
  ))

test('abort restores the state before the merge', () =>
  withSandbox(async (s) => {
    await divergent(s)
    const before = (await s.git('rev-parse', 'HEAD')).trim()
    await s.repo.merge('feature', 'ff')
    await s.repo.abort()
    assert.equal((await s.git('rev-parse', 'HEAD')).trim(), before)
    assert.equal(await s.read('a.txt'), 'eins\nZWEI-main\ndrei\n')
    assert.equal((await s.repo.state()).merge, null)
  }))

test('take the whole file from the incoming side', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await s.repo.merge('feature', 'no-ff')
    await s.repo.takeFile('a.txt', 'theirs')
    assert.equal(await s.read('a.txt'), 'eins\nZWEI-feature\ndrei\n')
    assert.deepEqual(await s.repo.unmerged(), [])
  }))

test('a squash merge with conflicts is detected and can be aborted', () =>
  withSandbox(async (s) => {
    await divergent(s)
    assert.equal((await s.repo.merge('feature', 'squash')).status, 'conflicts')
    assert.equal((await s.repo.state()).merge?.source, 'Squash-Merge')
    await s.repo.abort()
    assert.equal((await s.repo.state()).merge, null)
  }))

test('a clean squash creates exactly one commit', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '-b', 'topic')
    await s.commit('t1', { 'x.txt': '1\n' })
    await s.commit('t2', { 'x.txt': '2\n' })
    await s.git('checkout', '--quiet', 'main')
    await s.commit('m', { 'y.txt': 'y\n' })
    assert.equal((await s.repo.merge('topic', 'squash', 'Topic übernommen')).status, 'squashed')
    assert.equal((await s.git('log', '-1', '--format=%s')).trim(), 'Topic übernommen')
    assert.equal((await s.git('rev-list', '--parents', '-n1', 'HEAD')).trim().split(' ').length, 2)
  }))

test('refuses a merge on a dirty tree, and option-like or unknown refs', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await s.write('a.txt', 'lokal geändert\n')
    await assert.rejects(s.repo.merge('feature', 'ff'), /nicht committete/)
    await assert.rejects(s.repo.compare('--output=x'), UserError)
    await assert.rejects(s.repo.compare('gibtsnicht'), UserError)
  }))

test('conflict operations only touch files that are actually unmerged', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await s.repo.merge('feature', 'no-ff')
    await assert.rejects(s.repo.resolveHunk('keep.txt', 0, 'ours'), /keinen offenen Konflikt/)
    await assert.rejects(s.repo.conflict('../../etc/passwd'), UserError)
  }))

test('checkPath', () => {
  assert.equal(checkPath('src\\a.ts'), 'src/a.ts')
  for (const bad of ['', '/abs', 'C:/x', 'a/../../b', 'x\0y']) {
    assert.throws(() => checkPath(bad), UserError)
  }
})

test('undo a merge goes back exactly, and refuses once the branch moved on', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '-b', 'topic')
    await s.commit('t', { 'x.txt': 'x\n' })
    await s.git('checkout', '--quiet', 'main')
    await s.commit('m', { 'y.txt': 'y\n' })
    const before = await s.repo.head()
    await s.repo.merge('topic', 'no-ff')
    const after = await s.repo.head()
    await s.repo.undoMerge(before, after)
    assert.equal(await s.repo.head(), before)

    await s.repo.merge('topic', 'no-ff')
    const merged = await s.repo.head()
    await s.commit('danach', { 'z.txt': 'z\n' })
    await assert.rejects(s.repo.undoMerge(before, merged), /verändert/)
  }))

test('showBase writes diff3 blocks even when the repo is configured otherwise', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await s.repo.merge('feature', 'no-ff', undefined, { showBase: true })
    assert.equal((await s.repo.conflict('a.txt')).hunks[0].base, 'zwei')
  }))

test('a squash with resolved conflicts stays visible until it is committed', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await s.repo.merge('feature', 'squash')
    await s.repo.takeFile('a.txt', 'theirs')
    const st = await s.repo.state()
    assert.equal(st.merge?.source, 'Squash-Merge')
    assert.deepEqual(st.merge?.conflicts, [])
    await s.repo.commitMerge('Feature gesquasht')
    assert.equal((await s.git('log', '-1', '--format=%s')).trim(), 'Feature gesquasht')
    assert.equal((await s.repo.state()).merge, null)
  }))
