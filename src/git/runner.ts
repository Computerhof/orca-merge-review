// The one seam between the plugin and Git. Everything else talks to `GitRunner`, never to a
// process API, so another transport (an SSH host, a test double) is a new implementation.
import { execFile } from 'node:child_process'

export interface GitResult {
  /** Process exit code; 0 is success. Some commands (merge-tree, merge) use 1 for "conflicts". */
  code: number
  stdout: string
  stderr: string
}

export interface GitRunner {
  /** Runs `git <args>` in `cwd`. Never throws for a non-zero exit; it reports `code`. */
  run(cwd: string, args: readonly string[], options?: RunOptions): Promise<GitResult>
}

export interface RunOptions {
  stdin?: string
  /** Milliseconds before the process is killed; 0 waits forever. Default 60 s. */
  timeoutMs?: number
}

/** Long enough for merge and commit, whose Git hooks (lint, typecheck) may run for minutes. */
export const LONG_RUNNING_MS = 15 * 60_000

/** Runs the local `git` executable. Arguments go straight to the process, never through a shell. */
export class LocalGitRunner implements GitRunner {
  private readonly gitPath: string

  constructor(gitPath = 'git') {
    this.gitPath = gitPath
  }

  run(cwd: string, args: readonly string[], options: RunOptions = {}): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.gitPath,
        // Never let Git open an editor or a pager inside a worker with no terminal. Paths are
        // literal: a file named `src/[id].ts` must never match `src/i.ts` as a glob would.
        ['--literal-pathspecs', '-c', 'core.editor=true', '-c', 'core.pager=cat', ...args],
        {
          cwd,
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
          timeout: options.timeoutMs ?? 60_000,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' }
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== 'number') {
            // Not an exit code: output too large, killed after the timeout, or git missing.
            const e = error as NodeJS.ErrnoException & { killed?: boolean }
            const reason =
              e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                ? `git ${args[0]}: Ausgabe zu groß (über 32 MB)`
                : e.killed
                  ? `git ${args[0]} hat zu lange gebraucht und wurde abgebrochen`
                  : `git konnte nicht gestartet werden: ${error.message}`
            reject(new Error(reason))
            return
          }
          resolve({ code: error ? (error.code as number) : 0, stdout, stderr })
        }
      )
      child.stdin?.end(options.stdin)
    })
  }
}

export class GitError extends Error {
  readonly result: GitResult

  constructor(message: string, result: GitResult) {
    super(message)
    this.result = result
  }
}

/** Runs and throws a `GitError` unless the exit code is in `ok` (default: only 0). */
export async function git(
  runner: GitRunner,
  cwd: string,
  args: readonly string[],
  ok: readonly number[] = [0],
  options?: RunOptions
): Promise<GitResult> {
  const result = await runner.run(cwd, args, options)
  if (!ok.includes(result.code)) {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(0, 8).join('\n')
    throw new GitError(`git ${args[0]} fehlgeschlagen (Exit ${result.code}): ${detail}`, result)
  }
  return result
}
