import type { IPty } from 'node-pty'

// node-pty loaded lazily to avoid crashing main process if native module fails
let pty: typeof import('node-pty') | null = null
try {
  pty = require('node-pty')
} catch {
  /* terminal unavailable */
}

/** @internal — inject mock pty for testing (vi.mock cannot intercept CJS require) */
export function _setPty(mock: typeof import('node-pty') | null): void {
  pty = mock
}

const ALLOWED_SHELLS = new Set([
  '/bin/bash',
  '/bin/zsh',
  '/bin/sh',
  '/bin/dash',
  '/bin/fish',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  '/usr/bin/sh',
  '/usr/bin/dash',
  '/usr/bin/fish',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/usr/local/bin/fish',
  '/opt/homebrew/bin/bash',
  '/opt/homebrew/bin/zsh',
  '/opt/homebrew/bin/fish'
])

export function isPtyAvailable(): boolean {
  return pty !== null
}

export function validateShell(shell: string): boolean {
  return ALLOWED_SHELLS.has(shell)
}

export interface PtyHandle {
  process: IPty
  onData: (cb: (data: string) => void) => void
  onExit: (cb: () => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}

export function createPty(opts: {
  shell: string
  cols: number
  rows: number
  cwd?: string
}): PtyHandle {
  if (!pty) throw new Error('Terminal unavailable: node-pty failed to load')
  if (!validateShell(opts.shell)) throw new Error(`Shell not allowed: "${opts.shell}"`)
  const proc = pty.spawn(opts.shell, [], {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd ?? process.env.HOME ?? '/',
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
  })
  return {
    process: proc,
    onData: (cb) => {
      proc.onData(cb)
    },
    onExit: (cb) => {
      proc.onExit(() => cb())
    },
    write: (data) => {
      proc.write(data)
    },
    resize: (cols, rows) => {
      proc.resize(cols, rows)
    },
    kill: () => {
      proc.kill()
    }
  }
}
