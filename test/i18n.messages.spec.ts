// The core's texts in English, and German staying as it was. The language is module state, so each
// test restores it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardDecision } from '../src/core/gitGuard.ts'
import { m } from '../src/core/messages.ts'
import { MERGE_HINT_TAG, mergeHintPrompt, mergeWatchPrompt, resolveConflictsPrompt } from '../src/core/prompts.ts'
import { readinessLabel } from '../src/core/readiness.ts'
import { UserError } from '../src/core/repo.ts'
import { detectTestCommand } from '../src/core/testDetect.ts'
import { setLocale } from '../src/i18n/index.ts'
import { divergent, withSandbox } from './helpers.ts'

async function inEnglish(fn: () => Promise<void> | void): Promise<void> {
  setLocale('en')
  try {
    await fn()
  } finally {
    setLocale('de')
  }
}

test('a refusal of the repository reads in English, then in German again', () =>
  withSandbox(async (s) => {
    await inEnglish(async () => {
      await assert.rejects(
        s.repo.verify('nicht-da'),
        (e: unknown) => e instanceof UserError && e.message === '"nicht-da" is not a branch or commit in this repository.'
      )
      await assert.rejects(s.repo.abort(), (e: unknown) => e instanceof UserError && e.message === 'No merge is in progress.')
    })
    await assert.rejects(
      s.repo.abort(),
      (e: unknown) => e instanceof UserError && e.message === 'Es läuft kein Merge.'
    )
  }))

test('merge outcomes and the squash label are English', () =>
  withSandbox(async (s) => {
    await divergent(s)
    await inEnglish(async () => {
      const out = await s.repo.merge('feature', 'no-ff')
      assert.equal(out.status, 'conflicts')
      assert.equal(out.message, '1 file with conflicts. Resolve them in the “Conflicts” section.')
      assert.equal(m.merged('feature'), 'feature merged.')
    })
  }))

test('the guard tells an agent why, in English', async () => {
  await inEnglish(() => {
    assert.equal(
      guardDecision('git reset --hard', { merging: true }),
      'Merge & Review blocked this command: git reset --hard discards the merge and every resolution.' +
        ' A merge is in progress; the human finishes or aborts it in the Merge & Review panel.'
    )
    assert.equal(
      guardDecision('git push --force', { merging: false }),
      "Merge & Review blocked this command: Force-pushing overwrites other people's work."
    )
  })
  assert.match(guardDecision('git reset --hard', { merging: true }) ?? '', /^Merge & Review hat diesen Befehl blockiert: /)
})

test('agent prompts: English text, same tag, same shape', async () => {
  const de = mergeHintPrompt({ source: 'feature', open: 2 })
  await inEnglish(() => {
    const en = mergeHintPrompt({ source: 'feature', open: 2 })
    assert.ok(en.startsWith(`${MERGE_HINT_TAG} A merge of \`feature\` is in progress in this workspace. 2 files still have conflicts. `))
    assert.ok(!en.includes('\n'), 'a prompt typed into a running agent stays one line')
    assert.ok(mergeHintPrompt({ source: 'x', open: 1 }).includes('1 file still has conflicts.'))
    assert.ok(!mergeHintPrompt({ source: 'x', open: 0 }).includes('conflicts.'))
    assert.match(resolveConflictsPrompt({ target: 'main', source: 'feature', files: ['a.txt'] }), /^A merge of `feature` into `main` is in progress[^\n]*\n- a\.txt\n\nTask: /)
    assert.match(mergeWatchPrompt({ base: 'main' }), /^Merge watch \(Merge & Review\)/)
  })
  assert.ok(de.startsWith(`${MERGE_HINT_TAG} In diesem Workspace läuft ein Merge von \`feature\`. 2 Datei(en) haben noch Konflikte. `))
})

test('readiness labels and test suggestions follow the language', async () => {
  const row = { ahead: 2, preview: { clean: false, conflicts: ['a', 'b'], upToDate: false, fastForward: false } }
  await inEnglish(async () => {
    assert.equal(readinessLabel(row), '⚠ 2 conflicting files')
    const s = await detectTestCommand({ names: ['Cargo.toml'], read: async () => null })
    assert.deepEqual(s, { command: 'cargo test', because: 'Rust project (Cargo.toml)' })
  })
  assert.equal(readinessLabel(row), '⚠ 2 Konflikt-Datei(en)')
})
