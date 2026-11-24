// The real worker (src/worker.ts) over a mock Orca host and a real Git repository.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as main from './worker'
import { divergentRepo, hostResults } from './testing/fixture'

const manifest = {
  events: ['workspace.changed', 'agent.status.changed', 'workspace.removed'],
  hooks: ['agent.tool.before', 'agent.tool.after', 'editor.save.before', 'agent.prompt.before'],
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

test('K13: a conflicted file saved without markers is marked resolved', async () => {
  const dir = divergentRepo()
  const host = mockHost({ results: hostResults(dir) })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    await worker.request('merge.run', { source: 'feature', mode: 'no-ff' })
    const resolved = 'eins\nZWEI-feature\ndrei\n'
    writeFileSync(join(dir, 'a.txt'), resolved)
    const d = await worker.hooks.fire('editor.save.before', { workspaceId: 'ws-main', path: join(dir, 'a.txt'), languageId: 'plaintext', text: resolved })
    assert.equal(d.kind, 'continue', 'a save is never refused')
    await new Promise((r) => setTimeout(r, 1500))
    const st = await worker.request('repo.state', {})
    assert.deepEqual(st.merge?.conflicts, [])
  } finally {
    await worker.deactivate()
  }
})

test('K13: a save that still has markers changes nothing', async () => {
  const dir = divergentRepo()
  const host = mockHost({ results: hostResults(dir) })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    await worker.request('merge.run', { source: 'feature', mode: 'no-ff' })
    const text = readFileSync(join(dir, 'a.txt'), 'utf8')
    await worker.hooks.fire('editor.save.before', { workspaceId: 'ws-main', path: join(dir, 'a.txt'), text })
    await new Promise((r) => setTimeout(r, 1000))
    assert.deepEqual((await worker.request('repo.state', {})).merge?.conflicts, ['a.txt'])
  } finally {
    await worker.deactivate()
  }
})

test('K14: a prompt to an agent in a merging workspace gets the one-line hint', async () => {
  const dir = divergentRepo()
  const host = mockHost({ results: hostResults(dir, { 'terminal.list': { terminals: [{ id: 'term-x' }], truncated: false } }) })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    const idle = await worker.hooks.fire('agent.prompt.before', { agent: 'claude', terminalId: 'term-x', prompt: 'mach weiter', inputKind: 'driving' })
    assert.equal(idle.kind, 'continue')
    assert.equal((idle as { event?: { prompt: string } }).event?.prompt ?? 'mach weiter', 'mach weiter', 'no merge, no hint')

    await worker.request('merge.run', { source: 'feature', mode: 'no-ff' })
    const d = await worker.hooks.fire('agent.prompt.before', { agent: 'claude', terminalId: 'term-x', prompt: 'mach weiter', inputKind: 'driving' })
    assert.equal(d.kind, 'continue')
    const prompt = (d as { event: { prompt: string } }).event.prompt
    assert.match(prompt, /^\[Merge & Review\] In diesem Workspace läuft ein Merge/)
    assert.match(prompt, /mach weiter$/)
    assert.ok(!prompt.includes('\n'))

    const other = await worker.hooks.fire('agent.prompt.before', { agent: 'claude', terminalId: 'term-elsewhere', prompt: 'x', inputKind: 'driving' })
    assert.equal((other as { event?: { prompt: string } }).event?.prompt ?? 'x', 'x', 'other terminals are left alone')
  } finally {
    await worker.deactivate()
  }
})

test('K15: "Zum Agenten" focuses the agent terminal of the source workspace', async () => {
  const dir = divergentRepo()
  const host = mockHost({
    results: hostResults(dir, {
      'agents.list': { agents: [{ terminalId: 'term-agent', title: 'claude', agent: 'claude', state: 'working', stateStartedAt: 0 }] },
      'terminal.focus': { focused: true },
      'workspace.open': { opened: true }
    })
  })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    assert.equal((await worker.request('agent.focus', { source: 'feature' })).how, 'terminal')
    assert.deepEqual(host.callsOf('agents.list')[0], { workspaceId: 'ws-feature' })
    assert.deepEqual(host.callsOf('terminal.focus')[0], { terminalId: 'term-agent' })
  } finally {
    await worker.deactivate()
  }
})

test('K10: the base workspace lists the other workspaces with their prediction', async () => {
  const dir = divergentRepo()
  const host = mockHost({ results: hostResults(dir) })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    const st = await worker.request('repo.state', {})
    assert.equal(st.base, 'main')
    const o = await worker.request('overview.list', {})
    assert.equal(o.base, 'main')
    assert.equal(o.rows.length, 1)
    assert.equal(o.rows[0].workspaceId, 'ws-feature')
    assert.equal(o.rows[0].agent, 'done')
    assert.equal(o.rows[0].ahead, 1)
    assert.equal(o.rows[0].behind, 1)
    assert.deepEqual(o.rows[0].preview.conflicts, ['a.txt'])
    // A second call answers from the cache: same result, no new merge-tree needed.
    assert.deepEqual(await worker.request('overview.list', {}), o)
  } finally {
    await worker.deactivate()
  }
})

test('K11: after a clean merge the configured tests run; red offers an agent fix', async () => {
  const dir = divergentRepo()
  // Make the merge clean: resolve the divergence on main first.
  execFileSync('git', ['merge', '-X', 'theirs', '--no-edit', 'feature'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['checkout', '-q', '-b', 'more', 'feature'], { cwd: dir, stdio: 'ignore' })
  writeFileSync(join(dir, 'more.txt'), 'x')
  execFileSync('git', ['add', 'more.txt'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-q', '-m', 'more'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir, stdio: 'ignore' })
  const host = mockHost({ results: hostResults(dir) })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    // The command belongs to the project (all its workspaces), set from the panel.
    const set = await worker.request('project.setTestCommand', { command: ' node -e "console.log(1234);process.exit(7)" ' })
    assert.equal(set.testCommand, 'node -e "console.log(1234);process.exit(7)"')
    assert.equal((await worker.request('repo.state', { workspaceId: 'ws-feature' })).testCommand, set.testCommand, 'same project, same command')
    const out = await worker.request('merge.run', { source: 'more', mode: 'no-ff' })
    assert.equal(out.status, 'merged')
    let st = await worker.request('repo.state', {})
    for (let i = 0; i < 100 && st.job?.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 100))
      st = await worker.request('repo.state', {})
    }
    assert.equal(st.job?.kind, 'tests')
    assert.equal(st.job?.status, 'failed')
    assert.equal(st.job?.exitCode, 7)
    assert.ok(st.job?.tail.includes('1234'))
    const fix = await worker.request('tests.fix', {})
    assert.equal(fix.how, 'launched')
    const p = host.callsOf('agent.launch')[0] as { prompt: string }
    assert.match(p.prompt, /Exit 7/)
    assert.match(p.prompt, /1234/)
    await worker.request('job.dismiss', {})
    assert.equal((await worker.request('repo.state', {})).job, null)
  } finally {
    await worker.deactivate()
  }
})

test('K12: a probe merge answers at once and reports conflicts without touching the workspace', async () => {
  const dir = divergentRepo()
  const host = mockHost({ results: hostResults(dir) })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })
    assert.deepEqual(await worker.request('merge.probe', { source: 'feature' }), { started: true })
    let st = await worker.request('repo.state', {})
    for (let i = 0; i < 100 && st.job?.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 100))
      st = await worker.request('repo.state', {})
    }
    assert.equal(st.job?.kind, 'probe')
    assert.equal(st.job?.status, 'conflicts')
    assert.deepEqual(st.job?.conflicts, ['a.txt'])
    assert.equal(st.merge, null, 'no merge started in the workspace')
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }), before)
  } finally {
    await worker.deactivate()
  }
})

test('park and merge: uncommitted changes are parked, merged around, and come back', async () => {
  const dir = divergentRepo()
  // feature changes a.txt only; our work in progress is in keep.txt (tracked).
  writeFileSync(join(dir, 'keep.txt'), 'bleibt\n')
  execFileSync('git', ['add', 'keep.txt'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-q', '-m', 'keep'], { cwd: dir, stdio: 'ignore' })
  writeFileSync(join(dir, 'keep.txt'), 'meine Arbeit\n')
  const host = mockHost({ results: hostResults(dir) })
  const worker = await mountWorker(main, { host, ...manifest })
  try {
    const st = await worker.request('repo.state', {})
    assert.deepEqual(st.dirtyFiles, ['keep.txt'])
    const out = await worker.request('merge.run', { source: 'feature', mode: 'no-ff', park: true })
    assert.equal(out.status, 'conflicts')
    assert.match(out.message, /kommen nach dem Abschluss oder Abbruch zurück/)
    assert.equal(readFileSync(join(dir, 'keep.txt'), 'utf8'), 'bleibt\n', 'parked while merging')
    await worker.request('conflict.takeFile', { path: 'a.txt', side: 'theirs' })
    await worker.request('merge.commit', {})
    assert.equal(readFileSync(join(dir, 'keep.txt'), 'utf8'), 'meine Arbeit\n', 'back after the commit')
    assert.equal((await worker.request('repo.state', {})).parked, null)
  } finally {
    await worker.deactivate()
  }
})
