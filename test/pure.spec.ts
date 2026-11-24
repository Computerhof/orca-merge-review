// Pure core pieces: side-by-side diff rows, the agent Git guard, agent prompts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sideBySide } from '../src/core/diffview.ts'
import { commandOf, guardDecision, runsGit } from '../src/core/gitGuard.ts'
import { resolveConflictsPrompt, reviewFeedbackPrompt } from '../src/core/prompts.ts'

test('side-by-side pairs a deletion with the following addition', () => {
  const patch = [
    'diff --git a/a.txt b/a.txt',
    'index 1..2 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1,3 +1,4 @@ function x',
    ' eins',
    '-zwei',
    '+ZWEI',
    '+neu',
    ' drei',
    '\\ No newline at end of file'
  ].join('\n')
  const rows = sideBySide(patch)
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['meta', 'meta', 'meta', 'meta', 'hunk', 'context', 'change', 'add', 'context']
  )
  const change = rows[6]
  assert.deepEqual([change.leftNo, change.left, change.rightNo, change.right], [2, 'zwei', 2, 'ZWEI'])
  assert.deepEqual([rows[7].rightNo, rows[7].right, rows[7].left], [3, 'neu', null])
  assert.deepEqual([rows[8].leftNo, rows[8].rightNo], [3, 4])
  assert.equal(rows[4].right, 'function x')
  // Git ends every patch with a newline; that must not become an extra context row.
  assert.equal(sideBySide(patch + '\n').length, rows.length)
})

test('commandOf reads the shapes agents use', () => {
  assert.equal(commandOf({ command: 'git status' }), 'git status')
  assert.equal(commandOf({ command: ['git', 'reset', '--hard'] }), 'git reset --hard')
  assert.equal(commandOf({ file_path: 'x' }), null)
  assert.equal(commandOf(null), null)
})

test('runsGit finds git anywhere in a chain, not inside words', () => {
  assert.ok(runsGit('cd x && git merge main'))
  assert.ok(runsGit('git.exe status'))
  assert.ok(!runsGit('echo digit stuff'))
  assert.ok(!runsGit('npm run legit '))
})

test('during a merge, destructive git is refused and resolution commands pass', () => {
  const merging = { merging: true }
  for (const bad of [
    'git reset --hard HEAD',
    'git merge --abort',
    'git checkout .',
    'git restore -- .',
    'git clean -fd',
    'git stash',
    'git checkout main',
    'git switch -c other',
    'git rebase main'
  ]) {
    assert.ok(guardDecision(bad, merging), `should refuse: ${bad}`)
  }
  for (const ok of [
    'git status',
    'git diff',
    'git add src/a.ts',
    'git checkout --theirs src/a.ts',
    'git checkout -- src/a.ts',
    'git log --merge',
    'git stash list'
  ]) {
    assert.equal(guardDecision(ok, merging), null, `should pass: ${ok}`)
  }
})

test('the guard parses like a shell: global options, paths, quotes, nested shells', () => {
  const merging = { merging: true }
  for (const bad of [
    'git -C . reset --hard',
    'git -c x=y merge --abort',
    'git.exe reset --hard',
    '/usr/bin/git reset --hard',
    '"C:\\Program Files\\Git\\cmd\\git.exe" reset --hard',
    '& "C:\\Program Files\\Git\\cmd\\git.exe" merge --abort',
    '"git" reset --hard',
    'git restore :/',
    'git checkout -f HEAD',
    'git merge --quit',
    'cd sub && GIT_TRACE=1 git stash push',
    'bash -c "git reset --hard"',
    'echo ok; (git rebase main)',
    'git -C "a dir" checkout -b other'
  ]) {
    assert.ok(guardDecision(bad, merging), `should refuse: ${bad}`)
  }
  for (const ok of [
    'git commit -m "docs: explain git rebase"',
    'git log --grep "git stash"',
    'git commit --no-edit',
    'git checkout --ours -- a.ts',
    'git checkout --merge a.ts',
    'git reset --help',
    'echo "git reset --hard" > notes.txt',
    'orca agent launch --prompt "run git push --force somewhere"'
  ]) {
    assert.equal(guardDecision(ok, merging), null, `should pass: ${ok}`)
  }
})

test('force-push is refused in every form, a lease is allowed', () => {
  const idle = { merging: false }
  for (const bad of ['git push origin +main', 'git push -fu origin x', 'git -C repo push --force', 'git push --force-with-lease --force']) {
    assert.ok(guardDecision(bad, idle), `should refuse: ${bad}`)
  }
  for (const ok of ['git push --force-with-lease --force-if-includes', 'git push -u origin main', 'git push origin feature']) {
    assert.equal(guardDecision(ok, idle), null, `should pass: ${ok}`)
  }
})

test('commandOf keeps argv arrays intact', () => {
  assert.equal(guardDecision(commandOf({ command: ['git', 'commit', '-m', 'git rebase später'] })!, { merging: true }), null)
  assert.ok(guardDecision(commandOf({ command: ['git', 'merge', '--abort'] })!, { merging: true }))
})

test('outside a merge only force-push is refused', () => {
  assert.equal(guardDecision('git reset --hard HEAD~1', { merging: false }), null)
  assert.ok(guardDecision('git push --force origin main', { merging: false }))
  assert.ok(guardDecision('git push -f', { merging: false }))
  assert.equal(guardDecision('git push --force-with-lease', { merging: false }), null)
})

test('prompts name files and the rules', () => {
  const p = resolveConflictsPrompt({ target: 'main', source: 'feature', files: ['a.ts', 'b.ts'] })
  assert.match(p, /- a\.ts\n- b\.ts/)
  assert.match(p, /Committe NICHT/)
  assert.match(reviewFeedbackPrompt({ target: 'main', source: 'f', path: 'x.ts', note: ' bitte fixen ' }), /in `x\.ts`:\n\nbitte fixen\n/)
})
