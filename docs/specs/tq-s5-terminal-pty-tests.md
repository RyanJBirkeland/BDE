# TQ-S5: Terminal PTY Lifecycle Tests

**Epic:** Testing & QA
**Priority:** P1
**Estimate:** Medium
**Type:** Unit Test

---

## Problem

`src/main/handlers/terminal-handlers.ts` (52 LOC) manages the full PTY lifecycle — create, write, resize, kill — with zero tests. The code has several architectural risks:

1. **Lazy-loaded native module:** `node-pty` is required at import time with a try-catch. If it fails, `pty` is null and `terminal:create` throws. This failure mode is invisible until a user tries to open a terminal.
2. **Unbounded terminal Map:** `terminals` Map grows without limit. No maximum terminal count.
3. **Single-window broadcast:** `BrowserWindow.getAllWindows()[0]` sends data to the first window only. Multi-window scenarios get no terminal output.
4. **Global mutable counter:** `termId` is a module-scope counter (starts at 0, never resets). Not a bug per se, but makes test isolation harder.
5. **Fire-and-forget write:** `terminal:write` uses `ipcMain.on()` (not `handle()`), so write errors are silently lost.

### Terminal Handler API

| Channel           | Method       | Args                     | Returns                |
| ----------------- | ------------ | ------------------------ | ---------------------- |
| `terminal:create` | `safeHandle` | `{ cols, rows, shell? }` | `number` (terminal ID) |
| `terminal:write`  | `ipcMain.on` | `{ id, data }`           | void (fire-and-forget) |
| `terminal:resize` | `safeHandle` | `{ id, cols, rows }`     | void                   |
| `terminal:kill`   | `safeHandle` | `id`                     | void                   |

### Data Flow

```
terminal:create → pty.spawn() → terminals.set(id, pty)
                               → pty.onData → BrowserWindow.send(terminal:data:{id})
                               → pty.onExit → terminals.delete(id)
                                             → BrowserWindow.send(terminal:exit:{id})
terminal:write → terminals.get(id)?.write(data)
terminal:resize → terminals.get(id)?.resize(cols, rows)
terminal:kill → terminals.get(id)?.kill() + terminals.delete(id)
```

---

## Test Plan

**File to create:** `src/main/__tests__/terminal-handlers.test.ts`

### Mocking Strategy

```ts
// Mock node-pty with controllable PTY instances
const mockPtyInstance = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 12345
}

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPtyInstance)
}))

// Mock Electron
const mockSend = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: { send: mockSend } }])
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}))

vi.mock('../ipc-utils', () => ({
  safeHandle: vi.fn((channel, handler) => {
    // Capture handler for direct invocation
  })
}))
```

### Test Cases

#### PTY Creation

```
✓ terminal:create spawns PTY with correct shell, cols, rows
✓ terminal:create uses process.env.SHELL as default when shell not provided
✓ terminal:create falls back to /bin/zsh when SHELL env var missing
✓ terminal:create returns incrementing terminal ID
✓ terminal:create stores PTY instance in terminals Map
✓ terminal:create sets TERM=xterm-256color in PTY environment
✓ terminal:create sets cwd to HOME directory
✓ terminal:create throws when node-pty is unavailable (pty === null)
```

#### PTY Data Streaming

```
✓ PTY onData callback sends data to renderer via BrowserWindow.send
✓ data is sent on channel "terminal:data:{id}" with correct ID
✓ does not crash when no BrowserWindow exists (getAllWindows returns [])
```

#### PTY Exit Handling

```
✓ PTY onExit removes terminal from Map
✓ PTY onExit sends "terminal:exit:{id}" to renderer
✓ terminal is cleaned up and no longer writable after exit
```

#### Terminal Write

```
✓ terminal:write calls pty.write() with data for correct terminal ID
✓ terminal:write silently ignores writes to non-existent terminal ID
✓ terminal:write is registered via ipcMain.on (not handle)
```

#### Terminal Resize

```
✓ terminal:resize calls pty.resize(cols, rows) for correct terminal ID
✓ terminal:resize silently ignores resize for non-existent terminal ID
```

#### Terminal Kill

```
✓ terminal:kill calls pty.kill() for correct terminal ID
✓ terminal:kill removes terminal from Map
✓ terminal:kill on non-existent ID does not throw
✓ killed terminal is no longer writable
```

#### Lifecycle Integration

```
✓ create → write → resize → kill full lifecycle
✓ create multiple terminals → each gets unique ID
✓ killing one terminal does not affect others
✓ exit callback fires after kill (cleanup order)
```

---

## Files to Create

| File                                           | Purpose                      | Estimated LOC |
| ---------------------------------------------- | ---------------------------- | ------------- |
| `src/main/__tests__/terminal-handlers.test.ts` | Terminal PTY lifecycle tests | ~180          |

## Files to Modify

None — tests only.

---

## Implementation Notes

- **node-pty is a native module** — it cannot run in jsdom. These tests must use `vitest.node.config.ts`.
- **The `pty` variable is set at module load time** via `require('node-pty')`. To test the "pty unavailable" path, you may need to:
  - (a) Mock the require to throw, then re-import the module
  - (b) Or test the throw path in `terminal:create` by setting `pty = null` (requires module access)
- **onData and onExit callbacks** are registered during `terminal:create`. The mock needs to capture these callbacks so tests can invoke them manually to simulate PTY events.
- **BrowserWindow.getAllWindows()** returns an array — mock it to return `[]` for the "no window" edge case.
- **termId is module-scope** — consider re-importing the module in `beforeEach` for isolation, or accept that IDs increment across tests.

### Mock PTY Factory

```ts
function createMockPty() {
  let dataCallback: ((data: string) => void) | null = null
  let exitCallback: (() => void) | null = null

  return {
    onData: vi.fn((cb) => {
      dataCallback = cb
    }),
    onExit: vi.fn((cb) => {
      exitCallback = cb
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => {
      exitCallback?.()
    }),
    pid: Math.floor(Math.random() * 99999),
    // Helpers for tests
    _simulateData: (data: string) => dataCallback?.(data),
    _simulateExit: () => exitCallback?.()
  }
}
```

## Acceptance Criteria

- [ ] Full PTY lifecycle tested (create → write → resize → kill)
- [ ] Data streaming from PTY to renderer verified
- [ ] PTY exit cleanup verified (Map removal + renderer notification)
- [ ] Edge cases tested (no window, non-existent terminal, pty unavailable)
- [ ] Multiple concurrent terminals do not interfere with each other
- [ ] Tests run via `npm run test:main`
