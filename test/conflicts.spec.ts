import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conflictsOf, countConflicts, parseConflicts, resolveConflict } from '../src/core/conflicts.ts'

const two = [
  'kopf\n',
  '<<<<<<< HEAD\n', 'meins 1\n', '=======\n', 'deins 1\n', '>>>>>>> feature\n',
  'mitte\n',
  '<<<<<<< HEAD\n', 'meins 2\n', '=======\n', 'deins 2\n', '>>>>>>> feature\n',
  'fuss\n'
].join('')

test('finds both blocks with their labels', () => {
  const c = conflictsOf(parseConflicts(two))
  assert.equal(c.length, 2)
  assert.equal(c[0].oursLabel, 'HEAD')
  assert.equal(c[0].theirsLabel, 'feature')
  assert.deepEqual(c[1].ours, ['meins 2\n'])
})

test('resolving one block keeps the other byte for byte', () => {
  const out = resolveConflict(two, 0, 'theirs')
  assert.equal(countConflicts(out), 1)
  assert.ok(out.startsWith('kopf\ndeins 1\nmitte\n<<<<<<< HEAD\n'))
  assert.equal(resolveConflict(out, 0, 'ours'), 'kopf\ndeins 1\nmitte\nmeins 2\nfuss\n')
})

test('both keeps ours then theirs', () => {
  assert.equal(
    resolveConflict(resolveConflict(two, 1, 'both'), 0, 'both'),
    'kopf\nmeins 1\ndeins 1\nmitte\nmeins 2\ndeins 2\nfuss\n'
  )
})

test('keeps CRLF line endings', () => {
  const crlf = two.replace(/\n/g, '\r\n')
  const out = resolveConflict(resolveConflict(crlf, 0, 'ours'), 0, 'theirs')
  assert.equal(out, 'kopf\r\nmeins 1\r\nmitte\r\ndeins 2\r\nfuss\r\n')
})

test('a block with empty sides keeps the file CRLF when another block is resolved', () => {
  const crlf = ['kopf', '<<<<<<< HEAD', 'meins', '=======', 'deins', '>>>>>>> f', '<<<<<<< HEAD', '=======', '>>>>>>> f', 'fuss', '']
    .join('\r\n')
  const out = resolveConflict(crlf, 0, 'ours')
  assert.equal(out, ['kopf', 'meins', '<<<<<<< HEAD', '=======', '>>>>>>> f', 'fuss', ''].join('\r\n'))
})

test('diff3 base section, label kept on re-render', () => {
  const d3 = [
    '<<<<<<< HEAD\n', 'a\n', '||||||| base\n', 'o\n', '=======\n', 'b\n', '>>>>>>> x\n',
    '<<<<<<< HEAD\n', 'c\n', '||||||| base\n', 'p\n', '=======\n', 'd\n', '>>>>>>> x\n'
  ].join('')
  assert.deepEqual(conflictsOf(parseConflicts(d3))[0].base, ['o\n'])
  assert.equal(
    resolveConflict(d3, 0, 'base'),
    'o\n<<<<<<< HEAD\nc\n||||||| base\np\n=======\nd\n>>>>>>> x\n'
  )
})

test('an unclosed block is plain text and never loses content', () => {
  const broken = 'x\n<<<<<<< HEAD\ny\n=======\nz\n'
  assert.equal(countConflicts(broken), 0)
  const back = parseConflicts(broken)
    .flatMap((s) => (s.kind === 'text' ? s.lines : []))
    .join('')
  assert.equal(back, broken)
})

test('a missing newline at file end survives', () => {
  const t = '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\nende'
  assert.equal(resolveConflict(t, 0, 'theirs'), 'b\nende')
})

test('base without diff3 is refused, an unknown index too', () => {
  assert.throws(() => resolveConflict(two, 0, 'base'), /Basis/)
  assert.throws(() => resolveConflict(two, 5, 'ours'), /gibt es/)
})
