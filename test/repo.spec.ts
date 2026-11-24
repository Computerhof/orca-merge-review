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

test('paths are literal: resolving src/[id].ts never touches src/i.ts', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '-b', 'feature')
    await s.commit('f', { '[id].txt': 'F1\n', 'i.txt': 'F2\n' })
    await s.git('checkout', '--quiet', 'main')
    await s.commit('m', { '[id].txt': 'M1\n', 'i.txt': 'M2\n' })
    await s.repo.merge('feature', 'no-ff')
    await s.repo.resolveHunk('[id].txt', 0, 'ours')
    await s.repo.markResolved('[id].txt')
    assert.deepEqual(await s.repo.unmerged(), ['i.txt'], 'i.txt must still be unmerged')
    await s.repo.takeFile('i.txt', 'theirs')
    assert.equal(await s.read('[id].txt'), 'M1\n')
  }))

test('a renamed file diffs against its old path', () =>
  withSandbox(async (s) => {
    const body = Array.from({ length: 30 }, (_, i) => `zeile ${i}\n`).join('')
    await s.commit('base', { 'old.txt': body })
    await s.git('checkout', '--quiet', '-b', 'feature')
    await s.git('mv', 'old.txt', 'new.txt')
    await s.commit('rename', { 'new.txt': body.replace('zeile 3\n', 'ZEILE 3\n') })
    await s.git('checkout', '--quiet', 'main')
    const cmp = await s.repo.compare('feature')
    const f = cmp.files.find((x) => x.path === 'new.txt')!
    assert.equal(f.from, 'old.txt')
    const { patch } = await s.repo.fileDiff('feature', f.path, 'HEAD', f.from)
    assert.match(patch, /rename from old\.txt/)
    assert.doesNotMatch(patch, /new file mode/)
  }))

test('untracked files do not block a merge; the real commit count is reported', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await s.write('scratch.tmp', 'x\n')
    assert.deepEqual((await s.repo.state()).dirtyFiles, [])
    const cmp = await s.repo.compare('feature')
    assert.equal(cmp.ahead, 1)
    assert.equal(cmp.behind, 1)
  }))

test('"ff" mode fast-forwards even when merge.ff=false is configured', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '-b', 'feature')
    await s.commit('f', { 'b.txt': 'b\n' })
    await s.git('checkout', '--quiet', 'main')
    await s.git('config', 'merge.ff', 'false')
    await s.repo.merge('feature', 'ff')
    assert.equal((await s.git('rev-parse', 'HEAD')).trim(), (await s.git('rev-parse', 'feature')).trim())
  }))

test('unrelated histories are reported as such', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '--orphan', 'other')
    await s.git('rm', '-rf', '--quiet', '.')
    await s.commit('other root', { 'z.txt': 'z\n' })
    await s.git('checkout', '--quiet', 'main')
    await s.commit('main more', { 'a.txt': 'neu\n' })
    const cmp = await s.repo.compare('other')
    assert.equal(cmp.mergeBase, null)
    assert.equal(cmp.preview.unrelated, true)
    assert.equal(cmp.preview.clean, null)
  }))

test('resolveHunk refuses when the block changed since it was shown', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await s.repo.merge('feature', 'no-ff')
    const shown = (await s.repo.conflict('a.txt')).hunks[0]
    const text = await s.read('a.txt')
    await s.write('a.txt', text.replace('ZWEI-feature', 'ZWEI-agent'))
    await assert.rejects(
      s.repo.resolveHunk('a.txt', 0, 'ours', { ours: shown.ours, theirs: shown.theirs }),
      /inzwischen geändert/
    )
    const fresh = (await s.repo.conflict('a.txt')).hunks[0]
    await s.repo.resolveHunk('a.txt', 0, 'theirs', { ours: fresh.ours, theirs: fresh.theirs })
    assert.equal(await s.read('a.txt'), 'eins\nZWEI-agent\ndrei\n')
  }))

test('resolving a block keeps the bytes of a file that is not UTF-8 (Windows-1252)', () =>
  withSandbox(async (s) => {
    const { writeFile, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const cp1252 = (t: string) => Buffer.from(t, 'latin1') // ä ö ü ß are single bytes here
    await writeFile(join(s.dir, 'w.txt'), cp1252('Grüße\nzwei\nEnde\n'))
    await s.git('add', 'w.txt')
    await s.git('commit', '--quiet', '-m', 'w')
    await s.git('checkout', '--quiet', '-b', 'feature')
    await writeFile(join(s.dir, 'w.txt'), cp1252('Grüße\nzwei-Fäden\nEnde\n'))
    await s.git('commit', '--quiet', '-am', 'f')
    await s.git('checkout', '--quiet', 'main')
    await writeFile(join(s.dir, 'w.txt'), cp1252('Grüße\nzwei-Möhre\nEnde\n'))
    await s.git('commit', '--quiet', '-am', 'm')
    await s.repo.merge('feature', 'no-ff')
    await s.repo.resolveHunk('w.txt', 0, 'theirs')
    assert.deepEqual(await readFile(join(s.dir, 'w.txt')), cp1252('Grüße\nzwei-Fäden\nEnde\n'))
  }))

test('park and unpark: back when the merge did not touch the parked files', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '-b', 'feature')
    await s.commit('f', { 'b.txt': 'neu\n' })
    await s.git('checkout', '--quiet', 'main')
    const before = (await s.git('rev-parse', 'HEAD')).trim()
    await s.write('keep.txt', 'meine Arbeit\n')
    const parked = await s.repo.park('test')
    assert.deepEqual(parked.files, ['keep.txt'])
    assert.equal(await s.read('keep.txt'), 'bleibt\n', 'parked: the tree is clean')
    await s.repo.merge('feature', 'no-ff')
    assert.equal(await s.repo.unpark(parked.sha, parked.files, before), 'restored')
    assert.equal(await s.read('keep.txt'), 'meine Arbeit\n')
    assert.equal((await s.git('stash', 'list')).trim(), '')
  }))

test('park and unpark: stays parked when the merge changed the same file', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '-b', 'feature')
    await s.commit('f', { 'keep.txt': 'von feature\n' })
    await s.git('checkout', '--quiet', 'main')
    const before = (await s.git('rev-parse', 'HEAD')).trim()
    await s.write('keep.txt', 'meine Arbeit\n')
    const parked = await s.repo.park('test')
    await s.repo.merge('feature', 'ff')
    assert.equal(await s.repo.unpark(parked.sha, parked.files, before), 'overlap')
    assert.equal(await s.read('keep.txt'), 'von feature\n', 'nothing written into the file')
    assert.match(await s.git('stash', 'list'), /test/)
    // By hand (no `since`): Git tries; a clash leaves markers and keeps the stash.
    assert.equal(await s.repo.unpark(parked.sha, parked.files), 'conflict')
    assert.match(await s.git('stash', 'list'), /test/)
    assert.equal(await s.repo.unpark('0'.repeat(40), []), 'missing')
  }))
