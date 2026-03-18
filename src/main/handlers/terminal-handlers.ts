import { BrowserWindow, ipcMain } from 'electron'
import { safeHandle } from '../ipc-utils'

// node-pty loaded lazily to avoid crashing main process if native module fails
let pty: typeof import('node-pty') | null = null
try { pty = require('node-pty') } catch { /* terminal unavailable */ }

const terminals = new Map<number, ReturnType<NonNullable<typeof pty>['spawn']>>()
const terminalWindows = new Map<number, number>() // terminalId -> BrowserWindow.id
let termId = 0

export function registerTerminalHandlers(): void {
  safeHandle(
    'terminal:create',
    (event, { cols, rows, shell }: { cols: number; rows: number; shell?: string }) => {
      if (!pty) throw new Error('Terminal unavailable: node-pty failed to load')
      const id = ++termId
      const shellPath = shell || process.env.SHELL || '/bin/zsh'
      const p = pty.spawn(shellPath, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.env.HOME || '/',
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
      })
      terminals.set(id, p)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) terminalWindows.set(id, win.id)
      p.onData((data) => {
        const winId = terminalWindows.get(id)
        const targetWin = winId ? BrowserWindow.getAllWindows().find(w => w.id === winId) : undefined
        targetWin?.webContents.send(`terminal:data:${id}`, data)
      })
      p.onExit(() => {
        const winId = terminalWindows.get(id)
        const targetWin = winId ? BrowserWindow.getAllWindows().find(w => w.id === winId) : undefined
        targetWin?.webContents.send(`terminal:exit:${id}`)
        terminals.delete(id)
        terminalWindows.delete(id)
      })
      return id
    }
  )

  ipcMain.on('terminal:write', (_e, { id, data }: { id: number; data: string }) => {
    terminals.get(id)?.write(data)
  })

  // TODO: AX-S1 — add 'terminal:resize', 'terminal:kill' to IpcChannelMap
  safeHandle(
    'terminal:resize',
    (_e, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
      terminals.get(id)?.resize(cols, rows)
    }
  )

  safeHandle('terminal:kill', (_e, id: number) => {
    terminals.get(id)?.kill()
    terminals.delete(id)
  })
}
