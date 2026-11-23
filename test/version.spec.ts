import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { VERSION } from '../src/version.ts'

test('src/version.ts matches orca-plugin.json and has a CHANGELOG.md entry', async () => {
  const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
  assert.equal(VERSION, manifest.version)
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  assert.ok(changelog.split(/\r?\n/).some((line) => line.startsWith(`## [${VERSION}]`)), `CHANGELOG.md has no "## [${VERSION}]"`)
})
