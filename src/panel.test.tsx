// The panel against a stand-in worker: the three modes and the two-step confirmations.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { Comparison, RepoState } from './types'

const base: RepoState = {
  workspace: { id: 'ws', name: 'main', path: '/x', supported: true, hostId: 'local' },
  problem: null,
  branch: 'main',
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

test('a dirty tree blocks the merge and says why', async () => {
  const host = mockHost({
    capabilities: CAPS,
    requests: {
      'repo.state': () => ({ ...base, dirtyFiles: ['x.ts'] }),
      'repo.compare': () => comparison,
      'watch.get': () => ({ watch: null })
    }
  })
  const view = await mount(panel, { host })
  await view.settled()
  assert.ok(view.find({ text: 'Erst committen oder stashen: der Arbeitsbaum hat Änderungen.' }))
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
