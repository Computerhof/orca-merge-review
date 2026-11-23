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
  run(cwd: string, args: readonly string[], options?: { stdin?: string }): Promise<GitResult>
}

/** Runs the local `git` executable. Arguments go straight to the process, never through a shell. */
export class LocalGitRunner implements GitRunner {
  private readonly gitPath: string

  constructor(gitPath = 'git') {
    this.gitPath = gitPath
  }

  run(cwd: string, args: readonly string[], options: { stdin?: string } = {}): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.gitPath,
        // Never let Git open an editor or a pager inside a worker with no terminal.
        ['-c', 'core.editor=true', '-c', 'core.pager=cat', ...args],
        {
          cwd,
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
          timeout: 60_000,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' }
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== 'number') {
            // Spawn failure (git missing, cwd gone, timeout): a real error, not an exit code.
            reject(new Error(`git konnte nicht gestartet werden: ${error.message}`))
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
  ok: readonly number[] = [0]
): Promise<GitResult> {
  const result = await runner.run(cwd, args)
  if (!ok.includes(result.code)) {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(0, 8).join('\n')
    throw new GitError(`git ${args[0]} fehlgeschlagen (Exit ${result.code}): ${detail}`, result)
  }
  return result
}
