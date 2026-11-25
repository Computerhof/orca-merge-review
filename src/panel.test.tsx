// The panel against a stand-in worker: the three modes and the two-step confirmations.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { Comparison, RepoState } from './types'

const base: RepoState = {
  workspace: { id: 'ws', name: 'main', path: '/x', supported: true, hostId: 'local' },
  base: 'main',
  job: null,
  parked: null,
  testCommand: null,
  suggestedTest: null,
  projectName: 'app',
  stalledAgent: null,
  problem: null,
  branch: 'main',
  head: 'h0',
  branches: ['main', 'feature'],
  dirtyFiles: [],
  merge: null,
  sources: [{ ref: 'feature', label: 'agent-feature · feature', kind: 'workspace', workspaceId: 'ws-f', agent: 'working' }],
  suggestedSource: 'feature',
  lastMerge: null
}

const CAPS = ['workspace:read', 'settings:own', 'storage:own', 'agent:read']

const comparison: Comparison = {
  source: 'feature',
  target: 'HEAD',
  mergeBase: 'abc',
  incoming: [{ hash: 'h1', short: 'h1', subject: 'feature: zwei', author: 'T', at: 0 }],
  ahead: 1,
  behind: 1,
  files: [{ path: 'a.txt', status: 'M', added: 1, deleted: 1 }],
  preview: { clean: false, conflicts: ['a.txt'], upToDate: false, fastForward: false },
  rebase: null
}

/** A merge stopped with conflicts, as the worker reports it. */
const mergeOp = (conflicts: string[], markerFree: string[]): RepoState['merge'] => ({
  kind: 'merge',
  source: 'feature',
  conflicts,
  markerFree,
  step: null,
  sides: { ours: 'main', theirs: 'feature' },
  branch: null
})

test('compare mode: prediction, warning about a working agent, merge needs a second press', async () => {
  const runs: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => base,
      'repo.compare': () => comparison,
      'watch.get': () => ({ watch: null }),
      'merge.run': (input) => {
        runs.push(input)
        return { status: 'conflicts', message: '1 Datei(en) mit Konflikten.', conflicts: ['a.txt'] }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  const summary = view.summary().join('\n')
  assert.match(summary, /1 Konflikt-Datei\(en\) erwartet/)
  await view.press({ text: 'feature → main mergen' })
  assert.equal(runs.length, 0, 'first press only asks')
  assert.ok(view.find({ text: 'Ja, mergen' }))
  assert.match(view.summary().join('\n') + JSON.stringify(view.tree()), /Agent der Quelle arbeitet noch/)
  await view.press({ text: 'Ja, mergen' })
  await view.settled()
  assert.equal(runs.length, 1)
  // Optional fields are left out, never sent as undefined (Orca refuses those).
  assert.deepEqual(runs[0], { source: 'feature', mode: 'no-ff' })
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('K10: on the base workspace the panel lists the project workspaces; a row compares', async () => {
  const compared: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({ ...base, suggestedSource: '' }),
      'repo.compare': (input) => {
        compared.push(input)
        return comparison
      },
      'watch.get': () => ({ watch: null }),
      'overview.list': () => ({
        base: 'main',
        rows: [
          { workspaceId: 'ws-a', name: 'agent-a', branch: 'feature', agent: 'done', ahead: 2, behind: 0, preview: { clean: true, conflicts: [], upToDate: false, fastForward: true } },
          { workspaceId: 'ws-b', name: 'agent-b', branch: 'agent-b', agent: 'working', ahead: 1, behind: 3, preview: { clean: false, conflicts: ['x.ts'], upToDate: false, fastForward: false } }
        ]
      })
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  const text = view.summary().join('\n') + JSON.stringify(view.tree())
  assert.match(text, /Workspaces des Projekts · 1 bereit · 1 mit Konflikten/)
  assert.match(text, /✓ Fast-forward/)
  assert.match(text, /⚠ 1 Konflikt-Datei\(en\)/)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('K11: red tests after a merge show the output and offer an agent fix', async () => {
  const fixes: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({
        ...base,
        suggestedSource: '',
        testCommand: 'npm test',
        job: {
          kind: 'tests',
          status: 'failed',
          source: 'feature',
          command: 'npm test',
          startedAt: 0,
          finishedAt: 1,
          exitCode: 1,
          message: 'Tests rot (Exit 1).',
          tail: ['FAIL src/a.test.ts', 'expected 2, got 3'],
          conflicts: []
        }
      }),
      'watch.get': () => ({ watch: null }),
      'overview.list': () => ({ base: 'main', rows: [] }),
      'tests.fix': () => {
        fixes.push(1)
        return { how: 'launched', terminalId: 't' }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  const text = view.summary().join('\n') + JSON.stringify(view.tree())
  assert.match(text, /Tests rot \(Exit 1\)\./)
  assert.match(text, /expected 2, got 3/)
  await view.press({ text: 'Agent repariert' })
  await view.settled()
  assert.equal(fixes.length, 1)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('uncommitted changes are shown plainly; the merge parks them first', async () => {
  const runs: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({ ...base, dirtyFiles: ['x.ts', 'package.json'] }),
      'repo.compare': () => comparison,
      'watch.get': () => ({ watch: null }),
      'overview.list': () => ({ base: 'main', rows: [] }),
      'merge.run': (input) => {
        runs.push(input)
        return { status: 'merged', message: 'feature gemergt. Deine geparkten Änderungen sind zurück.', conflicts: [] }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  const text = view.summary().join('\n') + JSON.stringify(view.tree())
  assert.match(text, /2 nicht committete Änderung\(en\)/)
  assert.match(text, /x\.ts, package\.json/)
  await view.press({ text: 'Änderungen parken und feature mergen' })
  assert.match(view.summary().join('\n') + JSON.stringify(view.tree()), /Vorher werden 2 geänderte Datei\(en\) geparkt/)
  await view.press({ text: 'Ja, parken und mergen' })
  await view.settled()
  assert.deepEqual(runs[0], { source: 'feature', mode: 'no-ff', park: true })
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('the project test command: a detected suggestion is offered, never saved by itself', async () => {
  const saved: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({ ...base, suggestedSource: '', suggestedTest: { command: 'pnpm test', because: 'package.json hat ein test-Skript' } }),
      'watch.get': () => ({ watch: null }),
      'overview.list': () => ({ base: 'main', rows: [] }),
      'project.setTestCommand': (input) => {
        saved.push(input)
        return { testCommand: 'pnpm test' }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  assert.match(view.summary().join('\n') + JSON.stringify(view.tree()), /Tests für app: keine/)
  assert.equal(saved.length, 0)
  await view.press({ text: 'Vorschlag übernehmen: pnpm test' })
  await view.settled()
  assert.deepEqual(saved[0], { command: 'pnpm test' })
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('changes still parked after a merge are offered back', async () => {
  const restores: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({ ...base, suggestedSource: '', parked: { files: ['a.txt'], source: 'feature', at: 0 } }),
      'watch.get': () => ({ watch: null }),
      'overview.list': () => ({ base: 'main', rows: [] }),
      'stash.restore': () => {
        restores.push(1)
        return { result: 'restored' }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  assert.match(view.summary().join('\n'), /1 geparkte Änderung\(en\) liegen im Stash/)
  await view.press({ text: 'Zurückholen' })
  await view.settled()
  assert.equal(restores.length, 1)
  await view.unmount()
})

test('a first load that fails shows why and offers to try again, instead of spinning forever', async () => {
  let calls = 0
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => {
        calls++
        if (calls === 1) throw new Error('Git antwortet nicht.')
        return { ...base, suggestedSource: '' }
      },
      'watch.get': () => ({ watch: null }),
      'overview.list': () => ({ base: 'main', rows: [] })
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  assert.match(view.summary().join('\n') + JSON.stringify(view.tree()), /Git antwortet nicht/)
  await view.press({ text: 'Erneut laden' })
  await view.settled()
  assert.equal(calls, 2)
  assert.equal(view.find({ text: 'Erneut laden' }), null)
  await view.unmount()
})

test('an agent that never got its launch prompt is shown, and the prompt is typed on request', async () => {
  const retries: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({ ...base, suggestedSource: '', stalledAgent: { terminalId: 'term-a' } }),
      'watch.get': () => ({ watch: null }),
      'overview.list': () => ({ base: 'main', rows: [] }),
      'agent.retryPrompt': (input) => {
        retries.push(input)
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  assert.match(view.summary().join('\n') + JSON.stringify(view.tree()), /hat seinen Auftrag nicht bekommen/)
  await view.press({ text: 'Auftrag eintippen' })
  await view.settled()
  assert.equal(retries.length, 1)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('long file lists are paged: the first 200 rows, more on scrolling', async () => {
  const many: Comparison = {
    ...comparison,
    preview: { clean: true, conflicts: [], upToDate: false, fastForward: false },
    files: Array.from({ length: 450 }, (_, i) => ({ path: `f${i}.txt`, status: 'M', added: 1, deleted: 0 }))
  }
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => base,
      'repo.compare': () => many,
      'watch.get': () => ({ watch: null })
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  const tree = JSON.stringify(view.tree())
  // f350 is past the first page (and past the note's file choice, which lists 300).
  assert.match(tree, /f199\.txt/)
  assert.ok(!/f350\.txt/.test(tree))
  await view.loadMore({ label: 'Geänderte Dateien (Enter oder Doppelklick öffnet den Diff)' })
  await view.settled()
  assert.match(JSON.stringify(view.tree()), /f350\.txt/)
  await view.unmount()
})

test('resolve mode lists conflicts; abort needs confirmation', async () => {
  const aborts: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({ ...base, merge: mergeOp(['a.txt', 'b.txt'], ['b.txt']) }),
      'merge.abort': () => {
        aborts.push(1)
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  assert.match(view.summary().join('\n'), /Merge feature → main läuft/)
  assert.ok(view.find({ text: 'Als gelöst markieren' }))
  await view.press({ text: 'Merge abbrechen' })
  assert.equal(aborts.length, 0)
  await view.press({ text: 'Ja, abbrechen' })
  assert.equal(aborts.length, 1)
  await view.unmount()
})

test('finish mode when nothing is unresolved', async () => {
  const host = mockHost({
    capabilities: CAPS,
    requests: { 'repo.state': () => ({ ...base, merge: mergeOp([], []) }) }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  assert.match(view.summary().join('\n'), /Alle Konflikte gelöst/)
  assert.ok(view.find({ text: 'Merge abschließen' }))
  await view.unmount()
})

test('English UI: the panel speaks English when Orca runs in English', async () => {
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => base,
      'repo.compare': () => comparison,
      'watch.get': () => ({ watch: null })
    }
  })
  const view = await mount(panel, { host, locale: 'en-US' })
  await view.settled()
  assert.ok(view.find({ text: 'Merge feature into main' }))
  assert.match(view.summary().join('\n'), /1 conflicting file expected/)
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

// ------------------------------------------------------------------ rebase and cherry-pick (E9–E12)

/** The panel on a feature branch, its base `main` chosen as the source. */
const onFeature: RepoState = {
  ...base,
  branch: 'feature',
  sources: [{ ref: 'main', label: 'main', kind: 'branch', isBase: true }],
  suggestedSource: 'main'
}

test('E9/E10: rebase onto the source names the rewritten and pushed commits and needs a second press', async () => {
  const runs: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => onFeature,
      'repo.compare': () => ({ ...comparison, source: 'main', rebase: { commits: 3, pushed: 2, upstream: 'origin/feature' } }),
      'watch.get': () => ({ watch: null }),
      'rebase.run': (input) => {
        runs.push(input)
        return { status: 'rebased', message: 'feature auf main aktualisiert.', conflicts: [] }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  await view.press({ text: 'Auf main aktualisieren (Rebase)' })
  assert.equal(runs.length, 0, 'first press only asks')
  const text = view.summary().join('\n') + JSON.stringify(view.tree())
  assert.match(text, /feature auf main aktualisieren\?/)
  assert.match(text, /3 Commit\(s\) von feature werden neu geschrieben/)
  assert.match(text, /2 davon schon gepusht \(auf origin\/feature\): danach ist ein Force-Push nötig; Merge & Review pusht nie\./)
  await view.press({ text: 'Ja, trotzdem aktualisieren' })
  await view.settled()
  assert.deepEqual(runs, [{ source: 'main' }])
  assert.match(view.summary().join('\n'), /feature auf main aktualisiert\./)
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('E9: rebase is disabled on a detached HEAD and when the source brings nothing new', async () => {
  const detached = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => onFeature,
      'repo.compare': () => ({ ...comparison, source: 'main', rebase: null }),
      'watch.get': () => ({ watch: null })
    }
  })
  let view = await mount(panel, { host: detached, locale: 'de-DE' })
  await view.settled()
  assert.equal(view.find({ text: 'Auf main aktualisieren (Rebase)' })?.disabled, true)
  await view.unmount()

  const nothingNew = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => onFeature,
      'repo.compare': () => ({ ...comparison, source: 'main', ahead: 0, rebase: { commits: 1, pushed: 0, upstream: null } }),
      'watch.get': () => ({ watch: null })
    }
  })
  view = await mount(panel, { host: nothingNew, locale: 'de-DE' })
  await view.settled()
  assert.equal(view.find({ text: 'Auf main aktualisieren (Rebase)' })?.disabled, true)
  await view.unmount()
})

test('E11: chosen incoming commits are cherry-picked oldest first after a confirmation', async () => {
  const picks: unknown[] = []
  const two: Comparison = {
    ...comparison,
    ahead: 2,
    incoming: [
      { hash: 'h2full', short: 'h2', subject: 'feature: zwei', author: 'T', at: 0 },
      { hash: 'h1full', short: 'h1', subject: 'feature: eins', author: 'T', at: 0 }
    ]
  }
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => base,
      'repo.compare': () => two,
      'watch.get': () => ({ watch: null }),
      'pick.run': (input) => {
        picks.push(input)
        return { status: 'picked', message: '2 Commit(s) übernommen.', conflicts: [] }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  await view.toggle({ label: 'Commits (2)' })
  assert.equal(view.find({ text: /Commit\(s\) übernehmen \(Cherry-Pick\)/ }), null, 'no button without a selection')
  await view.selectRows({ label: 'Eingehende Commits' }, ['h2full', 'h1full'])
  await view.press({ text: '2 Commit(s) übernehmen (Cherry-Pick)' })
  assert.equal(picks.length, 0, 'first press only asks')
  const text = view.summary().join('\n') + JSON.stringify(view.tree())
  assert.match(text, /2 Commit\(s\) auf main übernehmen\?/)
  assert.match(text, /h2, h1 werden in Historien-Reihenfolge auf main angewendet, mit Herkunftsvermerk \(-x\)\./)
  await view.press({ text: 'Ja, übernehmen' })
  await view.settled()
  assert.deepEqual(picks, [{ commits: ['h1full', 'h2full'] }])
  assert.match(view.summary().join('\n'), /2 Commit\(s\) übernommen\./)
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('resolve mode for a rebase: step in the title, "Weiter" only without open conflicts, skip is confirmed', async () => {
  let conflicts = ['a.txt']
  const continues: unknown[] = []
  const skips: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({
        ...onFeature,
        branch: null,
        merge: {
          kind: 'rebase',
          source: 'main',
          conflicts,
          markerFree: [],
          step: { current: 2, total: 5, commit: 'abc123', subject: 'Login prüfen' },
          sides: { ours: 'main', theirs: 'abc123 Login prüfen' },
          branch: 'feature'
        }
      }),
      'op.continue': (input) => {
        continues.push(input)
        return { status: 'conflicts', message: 'Konflikte.', conflicts: ['b.txt'] }
      },
      'op.skip': (input) => {
        skips.push(input)
        return { status: 'rebased', message: 'feature auf main aktualisiert.', conflicts: [] }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  const text = view.summary().join('\n') + JSON.stringify(view.tree())
  assert.match(text, /Rebase von feature auf main läuft · Commit 2 von 5 \(abc123 Login prüfen\)/)
  assert.match(text, /Rebase läuft/)
  assert.ok(view.find({ text: 'Rebase abbrechen' }))
  assert.equal(view.find({ text: 'Merge abschließen' }), null)
  assert.equal(view.find({ text: 'Weiter' })?.disabled, true)

  conflicts = []
  await view.press({ label: 'Neu laden' })
  await view.settled()
  assert.equal(view.find({ text: 'Weiter' })?.disabled, false)
  await view.press({ text: 'Weiter' })
  await view.settled()
  assert.deepEqual(continues, [{}])
  assert.match(view.summary().join('\n'), /Der nächste Commit hat Konflikte in 1 Datei\(en\)/)

  await view.press({ text: 'Commit überspringen' })
  assert.equal(skips.length, 0, 'first press only asks')
  assert.match(view.summary().join('\n') + JSON.stringify(view.tree()), /abc123 überspringen\?/)
  await view.press({ text: 'Ja, überspringen' })
  await view.settled()
  assert.deepEqual(skips, [{}])
  assert.match(view.summary().join('\n'), /feature auf main aktualisiert\./)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('resolve mode for a cherry-pick: title and abort say what runs', async () => {
  const aborts: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({
        ...base,
        merge: {
          kind: 'cherry-pick',
          source: 'def456',
          conflicts: ['a.txt'],
          markerFree: [],
          step: { current: 1, total: 2, commit: 'def456', subject: 'Fix' },
          sides: { ours: 'main', theirs: 'def456 Fix' },
          branch: null
        }
      }),
      'merge.abort': () => {
        aborts.push(1)
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host, locale: 'de-DE' })
  await view.settled()
  assert.match(view.summary().join('\n'), /Cherry-Pick läuft · Commit 1 von 2 \(def456 Fix\)/)
  await view.press({ text: 'Cherry-Pick abbrechen' })
  assert.match(view.summary().join('\n') + JSON.stringify(view.tree()), /Cherry-Pick wirklich abbrechen\?/)
  await view.press({ text: 'Ja, abbrechen' })
  await view.settled()
  assert.equal(aborts.length, 1)
  assert.match(view.summary().join('\n'), /Cherry-Pick abgebrochen\./)
  await view.unmount()
})

test('English UI: the rebase button', async () => {
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => onFeature,
      'repo.compare': () => ({ ...comparison, source: 'main', rebase: { commits: 1, pushed: 0, upstream: null } }),
      'watch.get': () => ({ watch: null })
    }
  })
  const view = await mount(panel, { host, locale: 'en-US' })
  await view.settled()
  const button = view.find({ text: 'Update onto main (rebase)' })
  assert.ok(button)
  assert.equal(button.disabled, false)
  await view.press({ text: 'Update onto main (rebase)' })
  assert.match(view.summary().join('\n') + JSON.stringify(view.tree()), /1 commit of feature will be rewritten/)
  assert.ok(view.find({ text: 'Yes, update' }))
  await view.unmount()
})
