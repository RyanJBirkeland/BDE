import { BrowserWindow } from 'electron'
import { safeHandle, safeOn } from '../ipc-utils'
import { createPty, isPtyAvailable, validateShell, _setPty } from '../pty'
import type { PtyHandle } from '../pty'

export { _setPty }

const terminals = new Map<number, PtyHandle>()
const terminalWindows = new Map<number, number>() // terminalId -> BrowserWindow.id
let termId = 0

export function registerTerminalHandlers(): void {
  safeHandle('terminal:create', (
      event,
      { cols, rows, shell, cwd }: { cols: number; rows: number; shell?: string; cwd?: string }
    ) => {
      if (!isPtyAvailable()) throw new Error('Terminal unavailable: node-pty failed to load')
      const id = ++termId
      const shellPath = shell || process.env.SHELL || '/bin/zsh'
      if (!validateShell(shellPath)) {
        throw new Error(`Shell not allowed: "${shellPath}"`)
      }
      const handle = createPty({ shell: shellPath, cols, rows, cwd })
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
    }
  )

  safeOn('terminal:write', (_e, { id, data }: { id: number; data: string }) => {
    if (typeof data !== 'string' || data.length > 65_536) return
    terminals.get(id)?.write(data)
  })

  safeHandle('terminal:resize', (_e, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
      terminals.get(id)?.resize(cols, rows)
    }
  )

  safeHandle('terminal:kill', (_e, id: number) => {
    terminals.get(id)?.kill()
    terminals.delete(id)
  })
}
