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
  preview: { clean: false, conflicts: ['a.txt'], upToDate: false, fastForward: false }
}

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
  const view = await mount(panel, { host })
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
  const view = await mount(panel, { host })
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
  const view = await mount(panel, { host })
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
  const view = await mount(panel, { host })
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
  const view = await mount(panel, { host })
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
  const view = await mount(panel, { host })
  await view.settled()
  assert.match(view.summary().join('\n'), /1 geparkte Änderung\(en\) liegen im Stash/)
  await view.press({ text: 'Zurückholen' })
  await view.settled()
  assert.equal(restores.length, 1)
  await view.unmount()
})

test('resolve mode lists conflicts; abort needs confirmation', async () => {
  const aborts: unknown[] = []
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({ ...base, merge: { source: 'feature', conflicts: ['a.txt', 'b.txt'], markerFree: ['b.txt'] } }),
      'merge.abort': () => {
        aborts.push(1)
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
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
    requests: { 'repo.state': () => ({ ...base, merge: { source: 'feature', conflicts: [], markerFree: [] } }) }
  })
  const view = await mount(panel, { host })
  await view.settled()
  assert.match(view.summary().join('\n'), /Alle Konflikte gelöst/)
  assert.ok(view.find({ text: 'Merge abschließen' }))
  await view.unmount()
})
