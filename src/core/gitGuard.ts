// Reads an agent's tool call and decides whether it touches Git, and whether it would destroy an
// ongoing merge, rebase or cherry-pick. Pure and synchronous: Orca gives a hook 2 s, so the
// decision never waits on Git.
//
// The command is split like a shell would (quotes, escapes, `;` `&&` `||` `|` `&`, newlines,
// parentheses), so text inside quotes ("git rebase" in a commit message) is never read as a
// command, while `git -C . reset --hard`, `/usr/bin/git`, `git.exe` and `bash -c "…"` are.
// A guard rail, not a security boundary: a determined process can still get around it.

import { m } from './messages.ts'
import type { OperationKind } from '../types.ts'

/** The command text of a shell-like tool call, whatever shape the agent uses; null otherwise. */
export function commandOf(input: unknown): string | null {
  if (typeof input === 'string') return input
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  for (const key of ['command', 'cmd', 'script', 'commandLine']) {
    const v = o[key]
    if (typeof v === 'string') return v
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.map(quoteArg).join(' ')
  }
  return null
}

function quoteArg(a: string): string {
  return /[\s"'\\;&|()]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a
}

/** One `git …` call found in a command: its subcommand and the arguments after it. */
export interface GitCall {
  sub: string
  args: string[]
}

const SEPARATORS = new Set([';', '&&', '||', '|', '&', '\n', '(', ')'])

/** Shell-like split into simple commands (token lists). Quotes are removed, their text kept as one token. */
export function splitCommands(command: string): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let tok = ''
  let has = false
  const endTok = () => {
    if (has) cur.push(tok)
    tok = ''
    has = false
  }
  const endCmd = () => {
    endTok()
    if (cur.length) out.push(cur)
    cur = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === "'") {
      const j = command.indexOf("'", i + 1)
      tok += j < 0 ? command.slice(i + 1) : command.slice(i + 1, j)
      has = true
      i = j < 0 ? command.length : j
    } else if (c === '"') {
      let j = i + 1
      for (; j < command.length && command[j] !== '"'; j++) {
        // Inside double quotes a backslash escapes only $ ` " and \ (POSIX); Windows paths stay intact.
        if (command[j] === '\\' && '$`"\\'.includes(command[j + 1] ?? '')) j++
        tok += command[j]
      }
      has = true
      i = j
    } else if (c === '\\' && i + 1 < command.length && command[i + 1] !== '\n') {
      tok += command[++i]
      has = true
    } else if (c === '`' || c === '$' && command[i + 1] === '(') {
      endCmd() // a command substitution starts a command of its own
      if (c === '$') i++
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endTok()
    } else {
      const two = command.slice(i, i + 2)
      if (two === '&&' || two === '||') {
        endCmd()
        i++
      } else if (SEPARATORS.has(c)) {
        endCmd()
      } else {
        tok += c
        has = true
      }
    }
  }
  endCmd()
  return out
}

const WRAPPERS = new Set(['sudo', 'command', 'env', 'time', 'nohup', 'exec', 'xargs', 'nice'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'fish', 'pwsh', 'powershell', 'cmd'])
/** Git's global options that take the next token as their value. */
const GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix'])

function baseName(token: string): string {
  const name = token.split(/[\\/]/).pop() ?? token
  return name.toLowerCase().replace(/\.(exe|cmd|bat)$/, '')
}

/** Every git call in the command, including those inside `bash -c "…"`. */
export function gitCalls(command: string, depth = 0): GitCall[] {
  const calls: GitCall[] = []
  for (const tokens of splitCommands(command)) {
    let i = 0
    // Skip VAR=value prefixes and wrappers such as sudo/env.
    while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || WRAPPERS.has(baseName(tokens[i])))) i++
    if (i >= tokens.length) continue
    const prog = baseName(tokens[i])
    if (SHELLS.has(prog) && depth < 3) {
      const flag = tokens.findIndex((t, k) => k > i && /^(-c|-command|\/c)$/i.test(t))
      if (flag > 0 && tokens[flag + 1] !== undefined) calls.push(...gitCalls(tokens.slice(flag + 1).join(' '), depth + 1))
      continue
    }
    if (prog !== 'git') continue
    i++
    while (i < tokens.length && tokens[i].startsWith('-')) {
      if (GLOBAL_WITH_VALUE.has(tokens[i])) i++
      i++
    }
    if (i < tokens.length) calls.push({ sub: tokens[i], args: tokens.slice(i + 1) })
  }
  return calls
}

/** True when the command runs git at all (any position in a pipeline, chain or `bash -c`). */
export function runsGit(command: string): boolean {
  return gitCalls(command).length > 0
}

/** Short flags may be bundled: `-fd` holds `f`. */
function hasFlag(args: readonly string[], long: string[], short?: string): boolean {
  return args.some(
    (a) => long.includes(a) || long.some((l) => a.startsWith(l + '=')) || (!!short && /^-[a-zA-Z]+$/.test(a) && a.includes(short))
  )
}

const WHOLE_TREE = new Set(['.', './', ':/', ':/.', ':(top)', '*', ':(top).'])
const RESOLVING = ['--ours', '--theirs', '--merge', '-m', '--conflict']
/** Options that steer a running rebase, cherry-pick, revert or `git am`: the human's call (E12). */
const CONTROL = ['--abort', '--continue', '--skip', '--quit', '--edit-todo']

/**
 * The rules while a merge, rebase or cherry-pick is under way (E12: the same for all three).
 * Resolving stays possible: `git add`, `git checkout --ours <file>`, `git rebase --show-current-patch`.
 */
function duringOperation({ sub, args }: GitCall, op: OperationKind): string | null {
  const options = args.filter((a) => a.startsWith('-'))
  const sep = args.indexOf('--')
  const plain = (sep >= 0 ? args.slice(0, sep) : args).filter((a) => !a.startsWith('-'))
  const paths = sep >= 0 ? args.slice(sep + 1) : plain
  if (args.includes('--help') || args.includes('-h')) return null
  const control = CONTROL.find((c) => hasFlag(args, [c]))
  switch (sub) {
    case 'reset':
      if (hasFlag(args, ['--hard'])) return m.guardResetHard(op)
      if (hasFlag(args, ['--merge', '--keep'])) return m.guardResetMerge(op)
      return null
    case 'merge':
      if (hasFlag(args, ['--abort', '--quit'])) return op === 'merge' ? m.guardMergeAbort : m.guardOpControl(`git merge ${control ?? '--abort'}`, op)
      return null
    case 'checkout':
      if (hasFlag(args, ['--force'], 'f')) return m.guardCheckoutForce
      if (paths.some((p) => WHOLE_TREE.has(p))) return m.guardWholeTree
      if (hasFlag(args, ['-b', '-B', '--orphan', '--detach'])) return m.guardSwitchBranch(op)
      if (sep < 0 && plain.length === 1 && !options.some((o) => RESOLVING.includes(o))) return m.guardSwitchBranch(op)
      return null
    case 'restore':
      if (paths.some((p) => WHOLE_TREE.has(p))) return m.guardWholeTree
      return null
    case 'switch':
      return m.guardSwitchBranch(op)
    case 'clean':
      if (hasFlag(args, ['--force'], 'f')) return m.guardCleanForce
      return null
    case 'stash':
      if (plain[0] === 'list' || plain[0] === 'show') return null
      return m.guardStash(op)
    case 'rebase':
      if (control) return m.guardOpControl(`git rebase ${control}`, op)
      // Shows the commit being replayed: reading, and exactly what a conflict agent needs.
      if (op === 'rebase' && hasFlag(args, ['--show-current-patch'])) return null
      return m.guardRebase(op)
    case 'cherry-pick':
      if (control) return m.guardOpControl(`git cherry-pick ${control}`, op)
      return m.guardCherryPick(op)
    case 'revert':
    case 'am':
      if (control) return m.guardOpControl(`git ${sub} ${control}`, op)
      return null
    default:
      return null
  }
}

function always({ sub, args }: GitCall): string | null {
  if (sub !== 'push') return null
  const lease = hasFlag(args, ['--force-with-lease'])
  const force = hasFlag(args, ['--force'], 'f') || args.some((a) => !a.startsWith('-') && a.startsWith('+'))
  if (force && (!lease || hasFlag(args, ['--force']))) return m.guardForcePush
  return null
}

export interface GuardContext {
  /** Something is under way in the agent's workspace: a merge, rebase or cherry-pick. */
  merging: boolean
  /** What is under way; without it, `merging` means a merge. */
  operation?: OperationKind | null
}

/** Null when the call may run; otherwise the reason it is refused, for the agent to read. */
export function guardDecision(command: string, ctx: GuardContext): string | null {
  const op: OperationKind | null = ctx.operation ?? (ctx.merging ? 'merge' : null)
  for (const call of gitCalls(command)) {
    const why = always(call) ?? (op ? duringOperation(call, op) : null)
    if (why) {
      return m.guardBlocked(why, op)
    }
  }
  return null
}
