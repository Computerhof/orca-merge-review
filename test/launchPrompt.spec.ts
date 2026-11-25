import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWorkState, LAUNCH_DEADLINE_MS } from '../src/core/launchPrompt.ts'

test('working or waiting for a permission means the agent got its prompt', () => {
  assert.equal(isWorkState('working'), true)
  assert.equal(isWorkState('blocked'), true)
  assert.equal(isWorkState('done'), false)
  assert.equal(isWorkState('waiting'), false)
})

test('the deadline leaves a slow agent start enough time', () => {
  assert.ok(LAUNCH_DEADLINE_MS >= 20_000)
})
