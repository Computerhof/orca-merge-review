// Pure pieces behind the v0.2 loops: review export, merge hint, path mapping for saves.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewMarkdown } from '../src/core/reviewExport.ts'
import { MERGE_HINT_TAG, mergeHintPrompt } from '../src/core/prompts.ts'
import { relativeTo } from '../src/core/repo.ts'
import type { Comparison } from '../src/types.ts'

const comparison: Comparison = {
  source: 'agent-login',
  target: 'HEAD',
  mergeBase: 'b',
  incoming: [{ hash: 'h1', short: 'abc1234', subject: 'login: Formular', author: 'Agent', at: 0 }],
  ahead: 1,
  behind: 2,
  files: [
    { status: 'M', path: 'src/a|b.ts', added: 3, deleted: 1 },
    { status: 'R', path: 'neu.ts', from: 'alt.ts', added: 0, deleted: 0 },
    { status: 'A', path: 'logo.png', added: null, deleted: null }
  ],
  preview: { clean: false, conflicts: ['src/a|b.ts'], upToDate: false, fastForward: false }
}

test('review markdown: summary, notes per file, commits, escaped file table', () => {
  const md = reviewMarkdown({
    target: 'main',
    comparison,
    notes: [
      { path: null, text: 'Insgesamt gut.', sent: false },
      { path: 'src/a|b.ts', text: 'Zeile 3: Name\nbitte prüfen', sent: true },
      { path: 'neu.ts', text: '   ', sent: false }
    ],
    at: Date.UTC(2026, 10, 24, 9, 30),
    version: '9.9.9'
  })
  assert.match(md, /^# Review: agent-login → main\n/)
  assert.match(md, /- Stand: 2026-11-24 09:30 UTC/)
  assert.match(md, /1 Commit\(s\) kommen rein, 3 Datei\(en\), \+3 −1; main ist 2 Commit\(s\) weiter/)
  assert.match(md, /Vorhersage: 1 Konflikt-Datei\(en\) erwartet: src\/a\|b\.ts/)
  assert.match(md, /## Anmerkungen\n\n> Insgesamt gut\.\n/)
  assert.match(md, /### `src\/a\|b\.ts`\n\n> Zeile 3: Name\n> bitte prüfen\n\n_\(an den Agenten gesendet\)_/)
  assert.doesNotMatch(md, /### `neu\.ts`/, 'empty notes are left out')
  assert.match(md, /- `abc1234` login: Formular \(Agent\)/)
  assert.match(md, /\| M ⚠ \| src\/a\\\|b\.ts \| \+3 −1 \|/)
  assert.match(md, /\| R \| alt\.ts → neu\.ts \| \+0 −0 \|/)
  assert.match(md, /\| A \| logo\.png \| binär \|/)
  assert.match(md, /_Erstellt mit Merge & Review 9\.9\.9_\n$/)
})

test('the merge hint is one line, tagged, and names the open conflicts', () => {
  const hint = mergeHintPrompt({ source: 'feature', open: 2 })
  assert.ok(!hint.includes('\n'), 'one line: a TUI submits on Enter')
  assert.ok(hint.startsWith(MERGE_HINT_TAG))
  assert.match(hint, /`feature`/)
  assert.match(hint, /2 Datei\(en\) haben noch Konflikte/)
  assert.doesNotMatch(mergeHintPrompt({ source: 'x', open: 0 }), /Konflikte\. /)
})

test('relativeTo maps what Orca reports to repository paths', () => {
  assert.equal(relativeTo('C:/Repo/app', 'C:\\Repo\\app\\src\\a.ts', true), 'src/a.ts')
  assert.equal(relativeTo('C:/Repo/app', 'c:/repo/APP/src/a.ts', true), 'src/a.ts')
  assert.equal(relativeTo('/srv/app', '/srv/app/README.md', false), 'README.md')
  assert.equal(relativeTo('/srv/app', '/srv/APP/README.md', false), null)
  assert.equal(relativeTo('/srv/app', '/srv/app-other/x', false), null)
  assert.equal(relativeTo('/srv/app', './src/x.ts', false), 'src/x.ts')
})
