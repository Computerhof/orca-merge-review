// Reads an agent's tool call and decides whether it touches Git, and whether it would destroy an
// ongoing merge. Pure and synchronous: Orca gives a hook 2 s, so the decision never waits on Git.

/** The command text of a shell-like tool call, whatever shape the agent uses; null otherwise. */
export function commandOf(input: unknown): string | null {
  if (typeof input === 'string') return input
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  for (const key of ['command', 'cmd', 'script', 'commandLine']) {
    const v = o[key]
    if (typeof v === 'string') return v
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(' ')
  }
  return null
}

/** True when the command runs git at all (any position in a pipeline or chain). */
export function runsGit(command: string): boolean {
  return /(^|[\s;&|(`])git(\.exe)?\s/.test(command)
}

interface Rule {
  pattern: RegExp
  why: string
}

const DESTRUCTIVE_DURING_MERGE: Rule[] = [
  { pattern: /\bgit\s+reset\b[^;&|]*--hard\b/, why: 'git reset --hard verwirft den Merge und alle Auflösungen' },
  { pattern: /\bgit\s+merge\s+--abort\b/, why: 'git merge --abort bricht den Merge ab' },
  { pattern: /\bgit\s+reset\s+--merge\b/, why: 'git reset --merge bricht den Merge ab' },
  { pattern: /\bgit\s+(checkout|restore)\b[^;&|]*\s(--\s+)?\.(\s|$)/, why: 'Zurücksetzen des ganzen Arbeitsbaums verwirft Auflösungen' },
  { pattern: /\bgit\s+clean\b[^;&|]*-[a-zA-Z]*f/, why: 'git clean -f löscht Dateien' },
  { pattern: /\bgit\s+stash\b(?!\s+(list|show))/, why: 'git stash während eines Merges verliert den Merge-Zustand' },
  { pattern: /\bgit\s+(checkout|switch)\s+(?!--)(-[bBc]\s+)?[^\s.-][^\s;&|]*\s*($|[;&|])/, why: 'Branch-Wechsel mitten im Merge' },
  { pattern: /\bgit\s+rebase\b/, why: 'Rebase mitten im Merge' }
]

const ALWAYS_DESTRUCTIVE: Rule[] = [
  { pattern: /\bgit\s+push\b[^;&|]*(--force(?!-with-lease)|\s-f\b)/, why: 'Force-Push überschreibt fremde Arbeit' }
]

export interface GuardContext {
  /** A merge is in progress in the agent's workspace. */
  merging: boolean
}

/** Null when the call may run; otherwise the reason it is refused, for the agent to read. */
export function guardDecision(command: string, ctx: GuardContext): string | null {
  if (!runsGit(command)) return null
  const rules = ctx.merging ? [...DESTRUCTIVE_DURING_MERGE, ...ALWAYS_DESTRUCTIVE] : ALWAYS_DESTRUCTIVE
  for (const rule of rules) {
    if (rule.pattern.test(command)) {
      return `Merge & Review hat diesen Befehl blockiert: ${rule.why}.${
        ctx.merging ? ' Es läuft ein Merge; der Mensch schließt ihn im Merge-&-Review-Panel ab oder bricht ihn dort ab.' : ''
      }`
    }
  }
  return null
}
