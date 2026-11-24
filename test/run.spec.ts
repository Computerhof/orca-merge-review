// K11/K12 without Orca: the test-command runner and the probe merge in a temporary worktree.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCommand } from '../src/run/command.ts'
import { probeMerge } from '../src/run/probe.ts'
import { divergent, runner, withSandbox } from './helpers.ts'

const node = (js: string) => `node -e "${js}"`

test('runCommand keeps the exit code and the last lines, without colour codes', async () => {
  const ok = await runCommand(node("console.log('eins');console.error('zwei');console.log('\\u001b[31mrot\\u001b[0m')"), '.', { timeoutMs: 20_000 })
  assert.equal(ok.exitCode, 0)
  assert.deepEqual(ok.tail.filter(Boolean).sort(), ['eins', 'rot', 'zwei'])
  const bad = await runCommand(node('process.exit(3)'), '.', { timeoutMs: 20_000 })
  assert.equal(bad.exitCode, 3)
  const many = await runCommand(node('for(let i=0;i<100;i++)console.log(i)'), '.', { timeoutMs: 20_000, tailLines: 5 })
  assert.deepEqual(many.tail.filter(Boolean), ['95', '96', '97', '98', '99'])
})

test('runCommand stops a command at its timeout and on cancel', async () => {
  const slow = await runCommand(node('setTimeout(()=>{},30000)'), '.', { timeoutMs: 400 })
  assert.equal(slow.timedOut, true)
  assert.equal(slow.exitCode, null)
  assert.ok(slow.durationMs < 15_000)
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 300)
  const cancelled = await runCommand(node('setTimeout(()=>{},30000)'), '.', { timeoutMs: 30_000, signal: controller.signal })
  assert.equal(cancelled.cancelled, true)
})

/** Nothing in the person's repository may change through a probe. */
async function untouched(s: { git(...a: string[]): Promise<string> }, head: string): Promise<void> {
  assert.equal((await s.git('rev-parse', 'HEAD')).trim(), head, 'HEAD unchanged')
  assert.equal((await s.git('status', '--porcelain', '--untracked-files=no')).trim(), '', 'no tracked change')
  assert.equal((await s.git('worktree', 'list', '--porcelain')).match(/^worktree /gm)?.length, 1, 'temporary worktree removed')
  assert.equal((await s.git('rev-parse', '-q', '--verify', 'MERGE_HEAD').catch(() => '')).trim(), '', 'no merge started here')
}

test('probe: conflicts are found in the temporary worktree; nothing changes here', () =>
  withSandbox(async (s) => {
    await divergent(s)
    const head = (await s.git('rev-parse', 'HEAD')).trim()
    const r = await probeMerge(runner, s.dir, 'feature', { testCommand: null, testTimeoutMs: 60_000 })
    assert.equal(r.status, 'conflicts')
    assert.deepEqual(r.conflicts, ['a.txt'])
    await untouched(s, head)
  }))

test('probe: a clean merge with passing and failing tests', () =>
  withSandbox(async (s) => {
    await s.git('checkout', '--quiet', '-b', 'feature')
    await s.commit('f', { 'b.txt': 'neu\n' })
    await s.git('checkout', '--quiet', 'main')
    await s.commit('m', { 'c.txt': 'auch neu\n' })
    const head = (await s.git('rev-parse', 'HEAD')).trim()

    const clean = await probeMerge(runner, s.dir, 'feature', { testCommand: null, testTimeoutMs: 60_000 })
    assert.equal(clean.status, 'clean')

    // The tests see the merged result: both sides' files exist in the probe worktree.
    const green = await probeMerge(runner, s.dir, 'feature', {
      testCommand: node("const f=require('fs');process.exit(f.existsSync('b.txt')&&f.existsSync('c.txt')?0:4)"),
      testTimeoutMs: 60_000
    })
    assert.equal(green.status, 'passed', green.message + green.tests?.tail.join('|'))

    const red = await probeMerge(runner, s.dir, 'feature', { testCommand: node("console.log('kaputt');process.exit(2)"), testTimeoutMs: 60_000 })
    assert.equal(red.status, 'failed')
    assert.equal(red.tests?.exitCode, 2)
    assert.ok(red.tests?.tail.includes('kaputt'))
    await untouched(s, head)
  }))

test('probe: node_modules is shared with the tests and survives the cleanup', () =>
  withSandbox(async (s) => {
    await s.commit('ignore deps', { '.gitignore': 'node_modules/\n' })
    await s.git('checkout', '--quiet', '-b', 'feature')
    await s.commit('f', { 'b.txt': 'neu\n' })
    await s.git('checkout', '--quiet', 'main')
    await s.commit('m', { 'c.txt': 'neu\n' })
    mkdirSync(join(s.dir, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(s.dir, 'node_modules', 'dep', 'keep.txt'), 'bleibt')

    const r = await probeMerge(runner, s.dir, 'feature', {
      testCommand: node("process.exit(require('fs').existsSync('node_modules/dep/keep.txt')?0:5)"),
      testTimeoutMs: 60_000
    })
    assert.equal(r.status, 'passed', 'the tests saw the linked node_modules')
    assert.ok(existsSync(join(s.dir, 'node_modules', 'dep', 'keep.txt')), 'the real node_modules is intact')
  }))

test('probe: an unknown source is an error, not a crash', () =>
  withSandbox(async (s) => {
    const r = await probeMerge(runner, s.dir, 'gibt-es-nicht', { testCommand: null, testTimeoutMs: 60_000 })
    assert.equal(r.status, 'error')
    assert.equal((await s.git('worktree', 'list', '--porcelain')).match(/^worktree /gm)?.length, 1)
  }))
