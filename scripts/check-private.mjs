#!/usr/bin/env node
// Privacy and secret guard for a public repository.
//   node scripts/check-private.mjs --staged   (pre-commit hook: staged files + commit identity)
//   node scripts/check-private.mjs --all      (CI and `npm run check:private`: every tracked file)
//
// Generic rules live here (public). Personal markers (names, company domains, internal hosts)
// belong in `.private-patterns` (git-ignored, one regular expression per line, # comments), so
// the list of what must stay private is itself never published.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const mode = process.argv.includes('--all') ? 'all' : 'staged'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/** Paths that must never be committed, whatever they contain. */
const FORBIDDEN_PATHS = [
  /(^|\/)TASKS\.md$/,
  /(^|\/)NOTES\.md$/,
  /(^|\/)\.env(\..*)?$/,
  /(^|\/)\.private-patterns$/,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)\.claude\//,
  /(^|\/)CLAUDE\.local\.md$/,
  /(^|\/)\.orca\//,
  /(^|\/)\.merge-review\//,
  /(^|\/)node_modules\//
]
const ALLOWED_ENV = /(^|\/)\.env\.example$/

/** Content that looks like a secret or a personal path. */
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, 'GitHub token'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/\bsk-[A-Za-z0-9]{32,}\b/, 'API key'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/[A-Za-z]:\\+Users\\+(?!<|\{|USER|USERNAME|runneradmin)[A-Za-z0-9._-]+/, 'personal Windows path'],
  [/\/(?:Users|home)\/(?!<|\{|user\b|runner\b|USER)[A-Za-z0-9._-]+\//, 'personal home path']
]

function privatePatterns() {
  if (!existsSync('.private-patterns')) return []
  return readFileSync('.private-patterns', 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => [new RegExp(l, 'i'), 'private marker (.private-patterns)'])
}

const files =
  mode === 'all'
    ? git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean)
    : git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean)

const read = (path) =>
  mode === 'all' ? (existsSync(path) ? readFileSync(path, 'utf8') : '') : git('show', `:${path}`)

const rules = [...SECRET_PATTERNS, ...privatePatterns()]
const problems = []

for (const path of files) {
  const norm = path.replace(/\\/g, '/')
  if (FORBIDDEN_PATHS.some((r) => r.test(norm)) && !ALLOWED_ENV.test(norm)) {
    problems.push(`${path}: darf nicht ins Repository`)
    continue
  }
  if (norm === 'scripts/check-private.mjs') continue // holds the patterns themselves
  let text
  try {
    text = read(path)
  } catch {
    continue
  }
  if (text.includes('\0')) continue // binary
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [re, what] of rules) {
      if (re.test(line)) problems.push(`${path}:${i + 1}: ${what}`)
    }
  })
}

if (mode === 'staged') {
  // The commit identity becomes public with the history.
  const ident = `${git('config', 'user.name').trim()} <${git('config', 'user.email').trim()}>`
  for (const [re, what] of privatePatterns()) {
    if (re.test(ident)) {
      problems.push(
        `Commit-Identität enthält einen ${what}. Für dieses Repo eine öffentliche Adresse setzen, z. B.\n` +
          `    git config user.email "<id>+<login>@users.noreply.github.com"`
      )
    }
  }
}

if (problems.length) {
  console.error('check-private: blockiert\n  ' + problems.join('\n  '))
  console.error('\nBewusst gewollt? Muster in .private-patterns anpassen oder die Stelle umformulieren.')
  process.exit(1)
}
console.log(`check-private: ${files.length} Datei(en) sauber (${mode}).`)
