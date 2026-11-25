import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getLocale, localeOf, messages, plural, setLocale } from '../src/i18n/index.ts'

test('Orca locale tags map to German or English', () => {
  assert.equal(localeOf('de'), 'de')
  assert.equal(localeOf('de-DE'), 'de')
  assert.equal(localeOf('de_AT'), 'de')
  assert.equal(localeOf('en-US'), 'en')
  assert.equal(localeOf('fr'), 'en')
  assert.equal(localeOf('dev'), 'en')
  assert.equal(localeOf(undefined), 'en')
})

test('messages answer in the language current when read', () => {
  const m = messages({
    de: { hello: 'Hallo', merged: (s: string) => `${s} gemergt.` },
    en: { hello: 'Hello', merged: (s: string) => `Merged ${s}.` }
  })
  const before = getLocale()
  try {
    setLocale('de')
    assert.equal(m.hello, 'Hallo')
    assert.equal(m.merged('feature'), 'feature gemergt.')
    setLocale('en')
    assert.equal(m.hello, 'Hello')
    assert.equal(m.merged('feature'), 'Merged feature.')
  } finally {
    setLocale(before)
  }
})

test('plural', () => {
  assert.equal(plural(1, 'file', 'files'), '1 file')
  assert.equal(plural(3, 'file', 'files'), '3 files')
})
