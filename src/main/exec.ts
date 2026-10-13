import { spawn } from 'node:child_process'

export class CommandError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly code: number | null
  ) {
    super(message)
  }
}

interface RunOptions {
  input?: string
  cwd?: string
  timeoutMs?: number
}

/** Runs a binary without a shell and resolves with stdout. Rejects on non-zero exit. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: process.env })
    let stdout = ''
    let stderr = ''
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs)
      : undefined

    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      const msg = err.code === 'ENOENT' ? `\`${cmd}\` was not found on your PATH` : err.message
      reject(new CommandError(msg, stderr, null))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) return resolve(stdout)
      const why = signal ? `was stopped (${signal})` : `exited with code ${code}`
      const detail = stderr.trim() || stdout.trim()
      reject(new CommandError(`${cmd} ${why}${detail ? `: ${detail}` : ''}`, stderr, code))
    })

    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

/**
 * Apps launched from Finder or a desktop launcher get a minimal PATH, so `gh` and
 * `claude` aren't found. Borrow the PATH from the user's login shell instead.
 */
export async function adoptLoginShellPath(): Promise<void> {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const out = await run(shell, ['-ilc', 'printf "__MAILMAN__%s__MAILMAN__" "$PATH"'], {
      timeoutMs: 5000
    })
    const match = out.match(/__MAILMAN__(.*)__MAILMAN__/)
    if (match?.[1]) process.env.PATH = match[1]
  } catch {
    // Keep the inherited PATH; tool checks will report what's missing.
  }
}
