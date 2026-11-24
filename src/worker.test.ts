// The real worker (src/worker.ts) over a mock Orca host and a real Git repository.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as main from './worker'
import { divergentRepo, hostResults } from './testing/fixture'

const manifest = {
  events: ['workspace.changed', 'agent.status.changed', 'workspace.removed'],
  hooks: ['agent.tool.before', 'agent.tool.after', 'editor.save.before'],
  commands: ['mergeReview.open', 'mergeReview.nextConflict', 'mergeReview.compareBase', 'mergeReview.finish']
}

test('compare, merge with conflicts, resolve in the tab, finish, undo', async () => {
  const dir = divergentRepo()
  const host = mockHost({ results: hostResults(dir) })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    const st = await worker.request('repo.state', {})
    assert.equal(st.branch, 'main')
    assert.equal(st.sources[0].ref, 'feature')
    assert.equal(st.sources[0].kind, 'workspace')
    assert.equal(st.suggestedSource, 'feature')

    const c = await worker.request('repo.compare', { source: 'feature' })
    assert.deepEqual(c.preview.conflicts, ['a.txt'])

    const out = await worker.request('merge.run', { source: 'feature', mode: 'no-ff' })
    assert.equal(out.status, 'conflicts')
    // The review tab opens by itself on conflicts, pointing at a helper file inside .git.
    const opened = host.callsOf('editor.open').at(-1) as { path: string }
    assert.equal(opened.path, '.git/merge-review/review.mergereview')
    const ticket = JSON.parse(readFileSync(join(dir, '.git', 'merge-review', 'review.mergereview'), 'utf8'))
    assert.equal(ticket.view, 'overview')

    // diff3 is on by default: the base is shown.
    const file = await worker.request('conflict.get', { path: 'a.txt' })
    assert.equal(file.hunks[0].base, 'zwei')

    // The guard refuses an agent's reset --hard while the merge runs, and lets git add through.
    await worker.emit('workspace.changed', { context: { workspaceId: 'ws-main', branch: 'main', displayName: 'main', terminals: [] } })
    const st2 = await worker.request('repo.state', {})
    assert.ok(st2.merge)
    await new Promise((r) => setTimeout(r, 50))
    const deny = await worker.hooks.fire('agent.tool.before', { agent: 'claude', workspaceId: 'ws-main', tool: 'Bash', input: { command: 'git reset --hard' } })
    assert.equal(deny.kind, 'deny')
    const pass = await worker.hooks.fire('agent.tool.before', { agent: 'claude', workspaceId: 'ws-main', tool: 'Bash', input: { command: 'git add a.txt' } })
    assert.equal(pass.kind, 'continue')
    // Real hooks name the workspace `repoId::path` (seen in Orca 1.4.271), not by its list id.
    const legacyId = `repo-1::${dir.replace(/\\/g, '/')}`
    const denyLegacy = await worker.hooks.fire('agent.tool.before', { agent: 'claude', workspaceId: legacyId, tool: 'Bash', input: { command: 'git merge --abort' } })
    assert.equal(denyLegacy.kind, 'deny')

    await worker.request('conflict.resolveHunk', { path: 'a.txt', index: 0, choice: 'theirs' })
    await worker.request('conflict.markResolved', { path: 'a.txt' })
    const { hash } = await worker.request('merge.commit', {})
    assert.match(hash, /^[0-9a-f]{40}$/)

    const after = await worker.request('repo.state', {})
    assert.equal(after.merge, null)
    assert.equal(after.lastMerge?.source, 'feature')
    await worker.request('merge.undo', {})
    assert.equal((await worker.request('repo.state', {})).lastMerge, null)
    assert.deepEqual(worker.refusals, [])
  } finally {
    await worker.deactivate()
  }
})

test('review notes go to the running agent of the source workspace, as one line', async () => {
  const dir = divergentRepo()
  const host = mockHost({
    results: hostResults(dir, {
      'agents.list': { agents: [{ terminalId: 'term-agent', title: 'claude', agent: 'claude', state: 'done', stateStartedAt: 0 }] },
      'terminal.sendText': { accepted: true }
    })
  })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    const r = await worker.request('agent.feedback', { source: 'feature', path: 'a.txt', note: 'Bitte\nZeile 2 umbenennen' })
    assert.equal(r.how, 'sent')
    const sent = host.callsOf('terminal.sendText')[0] as { terminalId: string; text: string; enter: boolean }
    assert.equal(sent.terminalId, 'term-agent')
    assert.ok(!sent.text.includes('\n'))
    assert.match(sent.text, /a\.txt/)
    assert.deepEqual(worker.refusals, [])
  } finally {
    await worker.deactivate()
  }
})

test('a conflict agent gets a launch prompt that forbids committing', async () => {
  const dir = divergentRepo()
  const host = mockHost({ results: hostResults(dir) })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    await worker.request('merge.run', { source: 'feature', mode: 'no-ff' })
    const r = await worker.request('agent.resolveConflicts', {})
    assert.equal(r.how, 'launched')
    const p = host.callsOf('agent.launch')[0] as { prompt: string; agent: string }
    assert.equal(p.agent, 'claude')
    assert.match(p.prompt, /- a\.txt/)
    assert.match(p.prompt, /Committe NICHT/)
  } finally {
    await worker.deactivate()
  }
})

test('the merge watch is created as an Orca automation for the base', async () => {
  const dir = divergentRepo()
  const host = mockHost({
    results: hostResults(dir, {
      'workspace.readContext': { workspaceId: 'ws-feature', branch: 'feature', displayName: 'agent-feature', terminals: [] },
      'automation.create': { automationId: 'auto-1' }
    })
  })
  // The feature workspace path must be on its branch for baseBranch() to differ.
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    await worker.request('watch.set', { workspaceId: 'ws-feature', enabled: true })
    const p = host.callsOf('automation.create')[0] as { name: string; schedule: string; workspaceId: string; prompt: string }
    assert.equal(p.workspaceId, 'ws-feature')
    assert.equal(p.schedule, '0 8 * * 1-5')
    assert.match(p.name, /^Merge-Wächter: main/)
    assert.match(p.prompt, /Ändere nichts/)
  } finally {
    await worker.deactivate()
  }
})
