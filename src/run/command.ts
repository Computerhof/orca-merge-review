// Runs the project's own test command (a setting the person writes) in a working tree and keeps
// the exit code and the last lines of output. Orca-free, so it runs in CI.
//
// The command goes through the system shell on purpose: it is the person's command line
// (`npm test`, `pnpm -w test && cargo test`), exactly as they would type it. Nothing from Git
// or from an agent is ever spliced into it.
import { spawn } from 'node:child_process'
import { m } from '../core/messages.ts'

export interface CommandResult {
  /** Null when the process was killed (timeout or cancel) or could not start. */
  exitCode: number | null
  timedOut: boolean
  cancelled: boolean
  /** The last lines of stdout and stderr together, without terminal colour codes. */
  tail: string[]
  durationMs: number
}

export interface CommandOptions {
  timeoutMs: number
  signal?: AbortSignal
  /** How many output lines to keep (default 60). */
  tailLines?: number
  env?: NodeJS.ProcessEnv
}

// ESC [ … final byte: colours and cursor moves in test output.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

export function runCommand(command: string, cwd: string, options: CommandOptions): Promise<CommandResult> {
  const keep = options.tailLines ?? 60
  const started = Date.now()
  return new Promise((resolve) => {
    const tail: string[] = []
    let partial = ''
    const take = (chunk: Buffer | string) => {
      const lines = (partial + chunk.toString()).replace(ANSI, '').split(/\r?\n/)
      partial = lines.pop() ?? ''
      for (const line of lines) {
        tail.push(line)
        if (tail.length > keep) tail.shift()
      }
    }
    let timedOut = false
    let cancelled = false
    let settled = false

    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      // Own process group on POSIX, so a timeout stops the whole tree (npm → node → jest …).
      detached: process.platform !== 'win32',
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)

    const kill = () => {
      if (child.pid === undefined || child.exitCode !== null) return
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }
    const timer = options.timeoutMs > 0 ? setTimeout(() => ((timedOut = true), kill()), options.timeoutMs) : null
    const onAbort = () => ((cancelled = true), kill())
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (exitCode: number | null, extra?: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (partial) tail.push(partial)
      if (extra) tail.push(extra)
      while (tail.length > keep) tail.shift()
      resolve({ exitCode, timedOut, cancelled, tail, durationMs: Date.now() - started })
    }
    child.on('error', (error) => finish(null, m.commandNotStarted(error.message)))
    child.on('close', (code) => finish(timedOut || cancelled ? null : code))
  })
}
