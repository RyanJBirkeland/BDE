# WS8: Terminal Decoupling

**Date:** 2026-03-20
**Status:** Draft
**Effort:** 1 day
**Dependencies:** None

## Problem

Terminal/PTY logic in `terminal-handlers.ts` is tightly coupled to Electron's `BrowserWindow`. PTY processes are created, data listeners are attached, and events are forwarded to renderer all within a single handler registration. This makes the terminal logic untestable without mocking Electron. `node-pty` is lazy-loaded via CJS `require()`, adding another testing obstacle.

## Solution

Extract PTY lifecycle management into pure functions that don't know about Electron. Wire them to BrowserWindow only in the handler registration layer. **Preserve the existing IPC contract exactly** — integer IDs, `ipcMain.on` for writes, no-payload exit events.

## Architecture

```
src/main/
  pty.ts                        — PTY process management (pure, no Electron)
  handlers/
    terminal-handlers.ts        — Thin IPC handler registration (Electron wiring)
```

### `pty.ts` — Pure PTY Management

```typescript
// src/main/pty.ts
import type { IPty } from 'node-pty'

let pty: typeof import('node-pty') | null = null
try { pty = require('node-pty') } catch { /* node-pty not available */ }

// Preserve existing shell allowlist from terminal-handlers.ts
const ALLOWED_SHELLS = new Set(['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/bin/zsh', '/usr/bin/bash'])

export function isPtyAvailable(): boolean {
  return pty !== null
}

export function validateShell(shell: string): boolean {
  return ALLOWED_SHELLS.has(shell)
}

export interface PtyHandle {
  process: IPty
  onData: (cb: (data: string) => void) => void
  onExit: (cb: () => void) => void  // No exit code — matches existing IPC contract
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}

export function createPty(opts: {
  shell: string
  cols: number
  rows: number
  cwd?: string
  env?: Record<string, string>
}): PtyHandle {
  if (!pty) throw new Error('node-pty is not available')
  if (!validateShell(opts.shell)) throw new Error(`Shell not allowed: ${opts.shell}`)

  const proc = pty.spawn(opts.shell, [], {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd ?? process.env.HOME,
    env: { ...process.env, ...opts.env } as Record<string, string>,
  })

  return {
    process: proc,
    onData: (cb) => { proc.onData(cb) },
    onExit: (cb) => { proc.onExit(() => cb()) },  // Strip exit code to match contract
    write: (data) => { proc.write(data) },
    resize: (cols, rows) => { proc.resize(cols, rows) },
    kill: () => { proc.kill() },
  }
}
```

### `terminal-handlers.ts` — Thin Electron Wiring

Preserves the existing IPC contract:
- Integer IDs (auto-incrementing counter)
- `ipcMain.on` for `terminal:write` (fire-and-forget, payload is `{ id, data }`)
- `terminal:exit:${id}` sends no payload

```typescript
// src/main/handlers/terminal-handlers.ts
import { BrowserWindow, ipcMain } from 'electron'
import { createPty, isPtyAvailable, validateShell, type PtyHandle } from '../pty'

let termId = 0  // Preserve integer ID scheme
const terminals = new Map<number, PtyHandle>()

export function registerTerminalHandlers(): void {
  safeHandle('terminal:create', (event, { cols, rows, shell, cwd }) => {
    if (!isPtyAvailable()) return { error: 'Terminal not available' }
    if (!validateShell(shell)) return { error: `Shell not allowed: ${shell}` }

    const id = ++termId
    const handle = createPty({ shell, cols, rows, cwd })

    terminals.set(id, handle)

    // Wire PTY output → renderer (Electron-specific)
    const win = BrowserWindow.fromWebContents(event.sender)
    handle.onData((data) => {
      win?.webContents.send(`terminal:data:${id}`, data)
    })
    handle.onExit(() => {
      win?.webContents.send(`terminal:exit:${id}`)  // No payload — matches existing contract
      terminals.delete(id)
    })

    return { id }
  })

  // terminal:write uses ipcMain.on (fire-and-forget), NOT safeHandle
  ipcMain.on('terminal:write', (_e, { id, data }: { id: number; data: string }) => {
    terminals.get(id)?.write(data)
  })

  safeHandle('terminal:resize', (_e, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
    terminals.get(id)?.resize(cols, rows)
  })

  safeHandle('terminal:kill', (_e, id: number) => {
    const handle = terminals.get(id)
    if (handle) {
      handle.kill()
      terminals.delete(id)
    }
  })
}
```

## Changes

### 1. Create `src/main/pty.ts`

Extract from terminal-handlers.ts:
- PTY creation logic
- `PtyHandle` interface wrapping `IPty`
- `isPtyAvailable()` check
- `validateShell()` with the existing `ALLOWED_SHELLS` set
- Lazy `node-pty` require

The module exports pure functions that return `PtyHandle` objects. No Electron imports. No ID management (IDs are handler-scope).

### 2. Rewrite `src/main/handlers/terminal-handlers.ts`

Keep only IPC handler registration. Import `createPty` from `../pty`. Wire `PtyHandle.onData` to `BrowserWindow.webContents.send`.

Key contract preservation:
- **Integer IDs**: `let termId = 0; const id = ++termId` (not UUID)
- **`terminal:write` uses `ipcMain.on`**: Fire-and-forget with `{ id, data }` payload object
- **`terminal:exit` sends no payload**: `win?.webContents.send(\`terminal:exit:${id}\`)`
- **Shell allowlist**: Validated in both `createPty` (for direct callers) and handler (for IPC callers)

### 3. Create `src/main/__tests__/pty.test.ts`

Test PTY creation and lifecycle without Electron. Use async/await pattern (consistent with rest of test suite):

```typescript
import { createPty, isPtyAvailable, validateShell } from '../pty'

describe('pty', () => {
  it('reports availability', () => {
    expect(typeof isPtyAvailable()).toBe('boolean')
  })

  it('validates allowed shells', () => {
    expect(validateShell('/bin/zsh')).toBe(true)
    expect(validateShell('/bin/bash')).toBe(true)
    expect(validateShell('/usr/bin/evil')).toBe(false)
  })

  // Only run PTY tests if node-pty is available
  const describeWithPty = isPtyAvailable() ? describe : describe.skip

  describeWithPty('createPty', () => {
    it('creates a PTY process', () => {
      const handle = createPty({ shell: '/bin/sh', cols: 80, rows: 24 })
      expect(typeof handle.write).toBe('function')
      handle.kill()
    })

    it('rejects disallowed shells', () => {
      expect(() => createPty({ shell: '/usr/bin/evil', cols: 80, rows: 24 }))
        .toThrow('Shell not allowed')
    })

    it('receives data from PTY', async () => {
      const handle = createPty({ shell: '/bin/sh', cols: 80, rows: 24 })
      const data = await new Promise<string>((resolve) => {
        handle.onData((d) => resolve(d))
        handle.write('echo hello\n')
      })
      expect(data.length).toBeGreaterThan(0)
      handle.kill()
    })

    it('supports resize', () => {
      const handle = createPty({ shell: '/bin/sh', cols: 80, rows: 24 })
      expect(() => handle.resize(120, 40)).not.toThrow()
      handle.kill()
    })
  })
})
```

### 4. Update existing terminal handler tests

Simplify — they now only test wiring between `PtyHandle` callbacks and IPC send. Pure PTY logic tested in `pty.test.ts`.

## File Size Targets

| File | Target LOC |
|------|-----------|
| `pty.ts` | ~70 |
| `terminal-handlers.ts` | ~80 (down from current size) |
| `pty.test.ts` | ~60 |

## Verification

- `npm run typecheck` passes
- `npm test` passes
- `pty.test.ts` passes (with skip guard for environments without node-pty)
- Terminal functionality works end-to-end in dev (`npm run dev`)
- `grep -n "BrowserWindow" src/main/pty.ts` returns zero results
- `grep -n "ALLOWED_SHELLS" src/main/pty.ts` returns results (security control preserved)
- IPC contract unchanged: integer IDs, `ipcMain.on` for writes, no-payload exits

## Risk

Medium. PTY lifecycle management involves OS resources (child processes). The refactor changes how process handles are stored and accessed. Test carefully that:
- PTY processes are properly killed on window close
- Resize events reach the correct PTY
- Multiple terminals don't cross-wire data streams
- `terminal:kill` cleanup removes the handle from the Map
- Shell allowlist is enforced (security control)
