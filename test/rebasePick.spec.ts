// Rebase and cherry-pick (E9–E12) against real Git repositories in a temp folder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guardDecision } from '../src/core/gitGuard.ts'
import { m } from '../src/core/messages.ts'
import { mergeHintPrompt, resolveConflictsPrompt } from '../src/core/prompts.ts'
import { UserError } from '../src/core/repo.ts'
import { mergeMarkersSync, operationSync } from '../src/git/mergeMarkers.ts'
import { setLocale } from '../src/i18n/index.ts'
import { divergent, withSandbox, type Sandbox } from './helpers.ts'

const rev = async (s: Sandbox, ref: string) => (await s.git('rev-parse', ref)).trim()
const subjects = async (s: Sandbox, n: number) => (await s.git('log', `-${n}`, '--format=%s')).trim().split('\n')

/** divergent() and then on `feature`: a second, clean commit. HEAD is feature. */
async function featureOnTop(s: Sandbox): Promise<void> {
  await divergent(s)
  await s.git('checkout', '--quiet', 'feature')
  await s.commit('feature: mehr', { 'd.txt': 'd\n' })
}

async function inEnglish(fn: () => Promise<void> | void): Promise<void> {
  setLocale('en')
  try {
    await fn()
  } finally {
    setLocale('de')
  }
}

// ---------------------------------------------------------------- rebase

test('rebase without conflicts puts the branch on top, then is up to date', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '-b', 'feature')
    await s.commit('feature: b', { 'b.txt': 'b\n' })
    await s.git('checkout', '--quiet', 'main')
    await s.commit('main: c', { 'c.txt': 'c\n' })
    await s.git('checkout', '--quiet', 'feature')

    const out = await s.repo.rebase('main')
    assert.equal(out.status, 'rebased')
    assert.equal(out.message, 'Rebase auf main abgeschlossen.')
    assert.deepEqual(await subjects(s, 3), ['feature: b', 'main: c', 'init'])
    assert.equal(await rev(s, 'HEAD~1'), await rev(s, 'main'))
    assert.equal((await s.repo.state()).merge, null)
    assert.equal((await s.repo.state()).branch, 'feature')

    const again = await s.repo.rebase('main')
    assert.equal(again.status, 'up-to-date')
  }))

test('rebase with a conflict: state names the sides right, resolve, continue', () =>
  withSandbox(async (s) => {
    await featureOnTop(s)
    const out = await s.repo.rebase('main')
    assert.equal(out.status, 'conflicts')
    assert.deepEqual(out.conflicts, ['a.txt'])
    assert.equal(operationSync(s.dir), 'rebase')
    assert.equal(mergeMarkersSync(s.dir), true)

    const st = await s.repo.state()
    const op = st.merge!
    assert.equal(op.kind, 'rebase')
    assert.equal(op.source, 'main')
    assert.equal(op.branch, 'feature')
    assert.equal(st.branch, null, 'HEAD is detached while rebasing')
    assert.equal(op.step?.current, 1)
    assert.equal(op.step?.total, 2)
    assert.equal(op.step?.subject, 'feature: zwei')
    assert.match(op.step?.commit ?? '', /^[0-9a-f]{7,}$/)
    // Git's "ours" is the base being rebased onto, "theirs" the replayed commit.
    assert.equal(op.sides.ours, 'main')
    assert.equal(op.sides.theirs, `${op.step?.commit} feature: zwei`)
    const file = await s.repo.conflict('a.txt')
    assert.equal(file.hunks[0].ours, 'ZWEI-main')
    assert.equal(file.hunks[0].theirs, 'ZWEI-feature')

    await assert.rejects(s.repo.continueOp(), (e: unknown) => e instanceof UserError && /ungelöste/.test(e.message))
    await assert.rejects(s.repo.commitMerge(), (e: unknown) => e instanceof UserError && /„Weiter“/.test(e.message))
    await assert.rejects(s.repo.merge('main', 'no-ff'), /Es läuft schon ein Rebase/)

    await s.repo.resolveHunk('a.txt', 0, 'both')
    await s.repo.markResolved('a.txt')
    const resolved = (await s.repo.state()).merge
    assert.equal(resolved?.kind, 'rebase', 'resolved but not continued: still under way')
    assert.deepEqual(resolved?.conflicts, [])

    const done = await s.repo.continueOp()
    assert.equal(done.status, 'rebased')
    assert.equal((await s.repo.state()).merge, null)
    assert.equal(operationSync(s.dir), null)
    assert.equal(await s.repo.currentBranch(), 'feature')
    assert.deepEqual(await subjects(s, 4), ['feature: mehr', 'feature: zwei', 'main: zwei', 'init'])
    assert.equal(await s.read('a.txt'), 'eins\nZWEI-main\nZWEI-feature\ndrei\n')
  }))

test('rebase: skip leaves the conflicting commit out and goes on', () =>
  withSandbox(async (s) => {
    await featureOnTop(s)
    await s.repo.rebase('main')
    const out = await s.repo.skipOp()
    assert.equal(out.status, 'rebased')
    assert.equal(out.message, 'Commit übersprungen. Rebase auf main abgeschlossen.')
    assert.deepEqual(await subjects(s, 3), ['feature: mehr', 'main: zwei', 'init'])
    assert.equal(await s.read('a.txt'), 'eins\nZWEI-main\ndrei\n')
  }))

test('rebase: abort puts the branch back as it was; undo after a finished rebase too', () =>
  withSandbox(async (s) => {
    await featureOnTop(s)
    const before = await rev(s, 'HEAD')
    await s.repo.rebase('main')
    await s.repo.abort()
    assert.equal(await rev(s, 'HEAD'), before)
    assert.equal(await s.repo.currentBranch(), 'feature')
    assert.equal(await s.repo.operation(), null)
    assert.equal(operationSync(s.dir), null)

    await s.repo.rebase('main')
    await s.repo.takeFile('a.txt', 'theirs')
    assert.equal((await s.repo.continueOp()).status, 'rebased')
    await s.repo.undoMerge(before, await rev(s, 'HEAD'))
    assert.equal(await rev(s, 'HEAD'), before)
    assert.equal(await s.repo.currentBranch(), 'feature')
  }))

test('rebase is refused on a dirty tree, during a merge and with HEAD detached', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await s.write('a.txt', 'angefangen\n')
    await assert.rejects(s.repo.rebase('feature'), (e: unknown) => e instanceof UserError && /nicht committete/.test(e.message))
    await s.git('checkout', '--quiet', '--', 'a.txt')
    await s.repo.merge('feature', 'no-ff')
    await assert.rejects(s.repo.rebase('feature'), /Es läuft schon ein Merge/)
    await s.repo.abort()
    await s.git('checkout', '--quiet', '--detach', 'main')
    await assert.rejects(s.repo.rebase('feature'), /detached/)
    await assert.rejects(s.repo.rebase('--exec=x'), UserError)
  }))

test('rebaseImpact counts the commits a rebase rewrites and those already pushed', async () => {
  const remote = await mkdtemp(join(tmpdir(), 'merge-review-remote-'))
  try {
    await withSandbox(async (s) => {
      await s.git('init', '--quiet', '--bare', remote)
      await s.git('remote', 'add', 'origin', remote)
      await s.git('checkout', '--quiet', '-b', 'feature')
      await s.commit('f1', { 'f1.txt': '1\n' })
      await s.commit('f2', { 'f2.txt': '2\n' })
      await s.git('push', '--quiet', '-u', 'origin', 'feature')
      await s.commit('f3', { 'f3.txt': '3\n' })
      await s.git('checkout', '--quiet', 'main')
      await s.commit('main: neu', { 'm.txt': 'm\n' })
      await s.git('checkout', '--quiet', 'feature')

      assert.deepEqual(await s.repo.rebaseImpact('main'), { commits: 3, pushed: 2, upstream: 'origin/feature' })
      const c = await s.repo.compare('main')
      assert.deepEqual(c.rebase, { commits: 3, pushed: 2, upstream: 'origin/feature' })

      await s.git('checkout', '--quiet', '-b', 'lokal')
      assert.deepEqual(await s.repo.rebaseImpact('main'), { commits: 3, pushed: 0, upstream: null })
      await s.git('checkout', '--quiet', '--detach')
      assert.equal(await s.repo.rebaseImpact('main'), null)
      assert.equal((await s.repo.compare('main')).rebase, null)
    })
  } finally {
    await rm(remote, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

// ---------------------------------------------------------------- cherry-pick

test('cherry-pick of two commits given newest first applies them oldest first, with -x', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '-b', 'quelle')
    await s.commit('c: neu', { 'c.txt': 'eins\n' })
    // The second commit changes the file the first one adds: the wrong order could not apply.
    await s.commit('c: mehr', { 'c.txt': 'eins\nzwei\n' })
    const [c2, c1] = [await rev(s, 'quelle'), await rev(s, 'quelle~1')]
    await s.git('checkout', '--quiet', 'main')

    const out = await s.repo.cherryPick([c2.slice(0, 8), c1])
    assert.equal(out.status, 'picked')
    assert.equal(out.message, '2 Commit(s) per Cherry-Pick übernommen.')
    assert.deepEqual(await subjects(s, 3), ['c: mehr', 'c: neu', 'init'])
    assert.match(await s.git('log', '-1', '--format=%B'), new RegExp(`\\(cherry picked from commit ${c2}\\)`))
    assert.match(await s.git('log', '-1', '--skip=1', '--format=%B'), new RegExp(`\\(cherry picked from commit ${c1}\\)`))
    assert.equal(await s.read('c.txt'), 'eins\nzwei\n')

    await assert.rejects(s.repo.cherryPick([await rev(s, 'HEAD~2')]), /schon im aktuellen Branch/)
    await assert.rejects(s.repo.cherryPick([]), UserError)
    // The same change once more: Git stops on an empty commit; it is under way without conflicts.
    const again = await s.repo.cherryPick([c2])
    assert.equal(again.status, 'conflicts')
    assert.deepEqual(again.conflicts, [])
    assert.match(again.message, /leer/)
    assert.equal(await s.repo.operation(), 'cherry-pick')
    await s.repo.abort()
    assert.equal(await s.repo.operation(), null)
  }))

test('cherry-pick with a conflict: state, empty resolution refused, skip, continue', () =>
  withSandbox(async (s) => {
    await featureOnTop(s)
    const [f2, f1] = [await rev(s, 'feature'), await rev(s, 'feature~1')]
    await s.git('checkout', '--quiet', 'main')
    await s.commit('main: noch eins', { 'e.txt': 'e\n' })

    const out = await s.repo.cherryPick([f2, f1])
    assert.equal(out.status, 'conflicts')
    assert.deepEqual(out.conflicts, ['a.txt'])
    assert.equal(operationSync(s.dir), 'cherry-pick')
    const op = (await s.repo.state()).merge!
    assert.equal(op.kind, 'cherry-pick')
    assert.equal(op.source, f1.slice(0, op.source.length))
    assert.deepEqual({ current: op.step?.current, total: op.step?.total }, { current: 1, total: 2 })
    assert.equal(op.step?.subject, 'feature: zwei')
    assert.equal(op.sides.ours, 'main')
    assert.equal(op.sides.theirs, `${op.source} feature: zwei`)
    assert.equal(op.branch, null)

    // Keeping main's line makes the picked commit empty: continuing is refused with a hint to skip.
    await s.repo.takeFile('a.txt', 'ours')
    await s.git('rm', '--quiet', '--force', 'b.txt') // the picked commit also added b.txt
    await assert.rejects(s.repo.continueOp(), (e: unknown) => e instanceof UserError && /leer/.test(e.message))
    assert.equal(operationSync(s.dir), 'cherry-pick', 'still under way after the refusal')

    const skipped = await s.repo.skipOp()
    assert.equal(skipped.status, 'picked')
    assert.equal(skipped.message, 'Commit übersprungen. Cherry-Pick abgeschlossen.')
    assert.deepEqual(await subjects(s, 2), ['feature: mehr', 'main: noch eins'])
    assert.equal(await s.repo.operation(), null)
  }))

test('cherry-pick: resolve and continue picks the rest; a single pick is step 1 of 1; abort', () =>
  withSandbox(async (s) => {
    await featureOnTop(s)
    const [f2, f1] = [await rev(s, 'feature'), await rev(s, 'feature~1')]
    await s.git('checkout', '--quiet', 'main')
    const before = await rev(s, 'HEAD')

    assert.equal((await s.repo.cherryPick([f1, f2])).status, 'conflicts')
    await s.repo.takeFile('a.txt', 'theirs')
    const done = await s.repo.continueOp()
    assert.equal(done.status, 'picked')
    assert.equal(done.message, 'Cherry-Pick abgeschlossen.')
    assert.deepEqual(await subjects(s, 3), ['feature: mehr', 'feature: zwei', 'main: zwei'])
    assert.match(await s.git('log', '-1', '--skip=1', '--format=%B'), /\(cherry picked from commit /)

    await s.git('reset', '--quiet', '--hard', before)
    assert.equal((await s.repo.cherryPick([f1])).status, 'conflicts')
    const single = (await s.repo.state()).merge!
    assert.deepEqual({ current: single.step?.current, total: single.step?.total }, { current: 1, total: 1 })
    await s.repo.abort()
    assert.equal(await rev(s, 'HEAD'), before)
    assert.equal(await s.repo.operation(), null)
  }))

test('a merge commit is refused for cherry-pick', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await s.git('checkout', '--quiet', '-b', 'gemergt', 'feature')
    await s.git('merge', '--quiet', '-s', 'ours', '--no-edit', 'main')
    const merge = await rev(s, 'gemergt')
    await s.git('checkout', '--quiet', 'main')
    await assert.rejects(s.repo.cherryPick([merge]), /Merge-Commit/)
  }))

// ---------------------------------------------------------------- guard and texts (E12)

test('guard: during a rebase or cherry-pick their controls are blocked; outside, rebasing is free', () => {
  const rebasing = { merging: true, operation: 'rebase' as const }
  const picking = { merging: true, operation: 'cherry-pick' as const }
  for (const bad of [
    'git rebase --continue',
    'git rebase --abort',
    'git rebase --skip',
    'git rebase --quit',
    'git rebase --edit-todo',
    'git reset --hard',
    'git stash',
    'git checkout main',
    'git cherry-pick --abort',
    'git revert --continue',
    'git am --abort'
  ]) {
    assert.ok(guardDecision(bad, rebasing), `should refuse during a rebase: ${bad}`)
  }
  for (const bad of ['git cherry-pick --continue', 'git cherry-pick --skip', 'git cherry-pick --quit', 'git rebase --abort', 'git merge --abort']) {
    assert.ok(guardDecision(bad, picking), `should refuse during a cherry-pick: ${bad}`)
  }
  for (const ok of ['git add a.txt', 'git status', 'git diff', 'git show REBASE_HEAD', 'git rebase --show-current-patch', 'git checkout --theirs -- a.txt']) {
    assert.equal(guardDecision(ok, rebasing), null, `should pass during a rebase: ${ok}`)
  }
  for (const ok of ['git rebase main', 'git rebase --continue', 'git cherry-pick abc1234', 'git cherry-pick --abort']) {
    assert.equal(guardDecision(ok, { merging: false }), null, `outside any operation: ${ok}`)
  }
  assert.equal(
    guardDecision('git rebase --continue', rebasing),
    'Merge & Review hat diesen Befehl blockiert: git rebase --continue greift in den laufenden Rebase ein.' +
      ' Es läuft ein Rebase; der Mensch setzt ihn im Merge-&-Review-Panel fort oder bricht ihn dort ab.'
  )
  assert.match(guardDecision('git reset --hard', picking) ?? '', /verwirft den Cherry-Pick .* Es läuft ein Cherry-Pick;/)
  // Without `operation`, `merging` still means a merge (unchanged texts).
  assert.match(guardDecision('git reset --hard', { merging: true }) ?? '', /verwirft den Merge .* Es läuft ein Merge;/)
})

test('guard, prompts and outcomes of a rebase in English', () =>
  inEnglish(() => {
    assert.equal(
      guardDecision('git rebase --skip', { merging: true, operation: 'rebase' }),
      'Merge & Review blocked this command: git rebase --skip interferes with the rebase in progress.' +
        ' A rebase is in progress; the human continues or aborts it in the Merge & Review panel.'
    )
    assert.equal(m.rebased('main'), 'Rebased onto main.')
    assert.equal(m.picked(1), '1 commit taken over by cherry-pick.')
    const hint = mergeHintPrompt({ source: 'main', open: 1, kind: 'rebase' })
    assert.match(hint, /^\[Merge & Review\] A rebase onto `main` is in progress in this workspace\. 1 file still has conflicts\. /)
    assert.match(hint, /no --continue\/--skip\/--abort/)
    assert.ok(!hint.includes('\n'))
  }))

test('prompts name the running operation and its rules', () => {
  const hint = mergeHintPrompt({ source: 'abc1234', open: 0, kind: 'cherry-pick' })
  assert.match(hint, /^\[Merge & Review\] In diesem Workspace läuft ein Cherry-Pick von `abc1234`\. Cherry-Pick nicht fortsetzen/)
  assert.ok(!hint.includes('\n'))
  assert.match(mergeHintPrompt({ source: 'feature', open: 2 }), /läuft ein Merge von `feature`/)

  const p = resolveConflictsPrompt({
    target: 'HEAD',
    source: 'main',
    files: ['a.txt'],
    op: { kind: 'rebase', branch: 'feature', step: { current: 2, total: 5, commit: 'abc1234', subject: 'Login' } }
  })
  assert.match(p, /^In diesem Workspace läuft ein Rebase von `feature` auf `main` \(Commit 2 von 5: abc1234 Login\), mit Konflikten in:\n- a\.txt\n/)
  assert.match(p, /git show REBASE_HEAD/)
  assert.match(p, /„ours“\/HEAD für die Basis/)
  assert.match(p, /Committe NICHT, setze den Rebase NICHT fort/)
  assert.match(p, /setzt den Rebase selbst fort\.$/)

  const pick = resolveConflictsPrompt({
    target: 'main',
    source: 'abc1234',
    files: ['a.txt'],
    op: { kind: 'cherry-pick', branch: null, step: { current: 1, total: 1, commit: 'abc1234', subject: 'Fix' } }
  })
  assert.match(pick, /^In diesem Workspace läuft ein Cherry-Pick von `abc1234` auf `main` \(Commit 1 von 1: abc1234 Fix\)/)
  assert.match(pick, /git show CHERRY_PICK_HEAD/)
  assert.ok(!pick.includes('„ours“'))
})
