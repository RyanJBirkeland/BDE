import { resolve } from 'path'
import { BrowserWindow } from 'electron'
import { safeHandle, safeOn } from '../ipc-utils'
import { createPty, isPtyAvailable, validateShell, _setPty } from '../pty'
import type { PtyHandle } from '../pty'
import { getRepoPaths, ADHOC_WORKTREE_BASE } from '../paths'
import { getWorktreeBase } from '../lib/review-paths'

export { _setPty }

export function validateTerminalCwd(cwd: string): void {
  const resolved = resolve(cwd)
  const safeRoots = [
    ...Object.values(getRepoPaths()),
    getWorktreeBase(),
    resolve(ADHOC_WORKTREE_BASE)
  ]
  const isAllowed = safeRoots.some(
    (root) => resolved === root || resolved.startsWith(root + '/')
  )
  if (!isAllowed) {
    throw new Error(
      `terminal:create cwd "${cwd}" is not inside an allowed directory. ` +
        `Allowed roots: ${safeRoots.join(', ')}`
    )
  }
}

function parseTerminalCreateArgs(args: unknown[]): [{ cols: number; rows: number; shell?: string; cwd?: string }] {
  const [opts] = args
  if (opts === null || typeof opts !== 'object') {
    throw new Error('terminal:create argument must be an object')
  }
  const o = opts as Record<string, unknown>
  if (typeof o.cwd === 'string' && o.cwd.length > 0) {
    validateTerminalCwd(o.cwd)
  }
  return [o as { cols: number; rows: number; shell?: string; cwd?: string }]
}

const terminals = new Map<number, PtyHandle>()
const terminalWindows = new Map<number, number>() // terminalId -> BrowserWindow.id
let termId = 0

export function registerTerminalHandlers(): void {
  type CreatePtyArgs = {
    cols: number
    rows: number
    shell?: string | undefined
    cwd?: string | undefined
  }
  safeHandle('terminal:create', (event, { cols, rows, shell, cwd }: CreatePtyArgs) => {
    if (!isPtyAvailable()) throw new Error('Terminal unavailable: node-pty failed to load')
    const id = ++termId
    const shellPath = shell || process.env.SHELL || '/bin/zsh'
    if (!validateShell(shellPath)) {
      throw new Error(`Shell not allowed: "${shellPath}"`)
    }
    const handle = createPty({
      shell: shellPath,
      cols,
      rows,
      ...(cwd !== undefined ? { cwd } : {})
    })
    terminals.set(id, handle)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) terminalWindows.set(id, win.id)
    handle.onData((data) => {
      const winId = terminalWindows.get(id)
      const targetWin = winId
        ? BrowserWindow.getAllWindows().find((w) => w.id === winId)
        : undefined
      targetWin?.webContents.send(`terminal:data:${id}`, data)
    })
    handle.onExit(() => {
      const winId = terminalWindows.get(id)
      const targetWin = winId
        ? BrowserWindow.getAllWindows().find((w) => w.id === winId)
        : undefined
      targetWin?.webContents.send(`terminal:exit:${id}`)
      terminals.delete(id)
      terminalWindows.delete(id)
    })
    return id
  }, parseTerminalCreateArgs)

  safeOn('terminal:write', (_e, { id, data }: { id: number; data: string }) => {
    if (typeof data !== 'string' || data.length > 65_536) return
    terminals.get(id)?.write(data)
  })

  type ResizeArgs = { id: number; cols: number; rows: number }
  safeHandle('terminal:resize', (_e, { id, cols, rows }: ResizeArgs) => {
    terminals.get(id)?.resize(cols, rows)
  })

  safeHandle('terminal:kill', (_e, id: number) => {
    terminals.get(id)?.kill()
    terminals.delete(id)
  })
}
