import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectTestCommand } from '../src/core/testDetect.ts'

const project = (files: Record<string, string>) => ({
  names: Object.keys(files),
  read: async (name: string) => files[name] ?? null
})

test('a package.json test script, with the package manager its lock file names', async () => {
  const pkg = JSON.stringify({ scripts: { test: 'vitest run' } })
  assert.equal((await detectTestCommand(project({ 'package.json': pkg })))?.command, 'npm test')
  assert.equal((await detectTestCommand(project({ 'package.json': pkg, 'pnpm-lock.yaml': '' })))?.command, 'pnpm test')
  assert.equal((await detectTestCommand(project({ 'package.json': pkg, 'yarn.lock': '' })))?.command, 'yarn test')
  assert.equal((await detectTestCommand(project({ 'package.json': pkg, 'bun.lockb': '' })))?.command, 'bun run test')
})

test('without a "test" script the unit suite is taken, never the end-to-end one', async () => {
  const pkg = JSON.stringify({ scripts: { 'test:e2e': 'playwright test', 'test:unit': 'vitest run' } })
  const s = await detectTestCommand(project({ 'package.json': pkg, 'package-lock.json': '' }))
  assert.equal(s?.command, 'npm run test:unit')
  assert.match(s?.because ?? '', /test:unit/)
  assert.equal(await detectTestCommand(project({ 'package.json': JSON.stringify({ scripts: { 'test:e2e': 'playwright test' } }) })), null)
})

test('npm\'s placeholder script and broken JSON are no test suite', async () => {
  const placeholder = JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })
  assert.equal(await detectTestCommand(project({ 'package.json': placeholder })), null)
  assert.equal(await detectTestCommand(project({ 'package.json': '{ kaputt' })), null)
})

test('other ecosystems', async () => {
  assert.equal((await detectTestCommand(project({ 'Cargo.toml': '' })))?.command, 'cargo test')
  assert.equal((await detectTestCommand(project({ 'go.mod': '' })))?.command, 'go test ./...')
  assert.equal((await detectTestCommand(project({ 'pyproject.toml': '[tool.pytest.ini_options]' })))?.command, 'pytest')
  assert.equal(await detectTestCommand(project({ 'pyproject.toml': '[project]\nname = "x"' })), null)
  assert.equal((await detectTestCommand(project({ 'App.sln': '' })))?.command, 'dotnet test')
  assert.equal((await detectTestCommand(project({ Makefile: 'build:\n\tcc x\ntest: build\n\t./run' })))?.command, 'make test')
  assert.equal(await detectTestCommand(project({ Makefile: 'build:\n\tcc x' })), null)
  assert.equal(await detectTestCommand(project({ 'README.md': '' })), null)
})
