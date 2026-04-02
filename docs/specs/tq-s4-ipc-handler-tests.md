# TQ-S4: IPC Handler Registration Tests

**Epic:** Testing & QA
**Priority:** P0
**Estimate:** Large
**Type:** Integration Test

---

## Problem

BDE has 8 handler registration files that wire 30+ IPC channels between the renderer and main process. **None have tests.** The `safeHandle()` wrapper (`ipc-utils.ts:4-16`) is the only error boundary — if a handler registration is misconfigured, the IPC call silently fails or crashes the main process.

### Handler Inventory

| File | Channels | Risk |
|------|----------|------|
| `handlers/agent-handlers.ts` | 8 channels (spawn, list, get, tail, send, import, markDone, prune) | High — process lifecycle |
| `handlers/git-handlers.ts` | 12 channels (status, diff, log, branch, stage, unstage, commit, push, checkout, repoPaths, readSprint) | High — shell commands |
| `handlers/terminal-handlers.ts` | 4 channels (create, write, resize, kill) | High — PTY lifecycle |
| `handlers/config-handlers.ts` | 4 channels (getGatewayConfig, getGitHubToken, saveGatewayConfig, getSupabaseConfig) | Medium — auth |
| `handlers/gateway-handlers.ts` | 1 channel (gateway:invoke) | Medium — HTTP proxy |
| `handlers/window-handlers.ts` | 3 channels (open-external, kill-local-agent, set-title) | Medium — process kill |
| `fs.ts` (registerFsHandlers) | 3 channels (list-memory-files, read-memory-file, write-memory-file) | Medium — file I/O |
| `ipc-utils.ts` (safeHandle) | N/A — wrapper | Low |

### What We're Testing

This story tests the **wiring layer** — that each handler:
1. Registers on the correct IPC channel name
2. Calls the correct underlying function with the correct arguments
3. Returns the expected result shape
4. Handles errors via `safeHandle` (doesn't crash main process)

We are NOT re-testing the underlying logic (that's TQ-S2, TQ-S3, TQ-S5). We're testing the glue.

---

## Test Plan

**File to create:** `src/main/__tests__/handlers.test.ts`

### Mocking Strategy

Mock every underlying module and test that the handler calls it correctly:

```ts
// Mock all underlying modules
vi.mock('../local-agents', () => ({
  getAgentProcesses: vi.fn().mockResolvedValue([]),
  spawnClaudeAgent: vi.fn().mockResolvedValue({ pid: 123, logPath: '/tmp/log', id: 'abc' }),
  tailAgentLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
  sendToAgent: vi.fn().mockReturnValue({ ok: true }),
  isAgentInteractive: vi.fn().mockReturnValue(true),
  cleanupOldLogs: vi.fn(),
}))

vi.mock('../agent-history', () => ({
  listAgents: vi.fn().mockResolvedValue([]),
  getAgentMeta: vi.fn().mockResolvedValue(null),
  readLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
  importAgent: vi.fn().mockResolvedValue({}),
  updateAgentMeta: vi.fn(),
  pruneOldAgents: vi.fn(),
}))

vi.mock('../git', () => ({
  gitStatus: vi.fn().mockReturnValue({ files: [] }),
  gitDiffFile: vi.fn().mockReturnValue(''),
  getDiff: vi.fn().mockReturnValue(''),
  getLog: vi.fn().mockReturnValue(''),
  // ... etc
}))

vi.mock('../config', () => ({
  getGatewayConfig: vi.fn().mockReturnValue({ url: 'ws://localhost:18789', token: 'test' }),
  getGitHubToken: vi.fn().mockReturnValue('gh-token'),
  saveGatewayConfig: vi.fn(),
  getSupabaseConfig: vi.fn().mockReturnValue(null),
}))
```

**IPC testing approach:** Mock `ipcMain.handle` and `ipcMain.on` to capture registered handlers, then invoke them directly:

```ts
const handlers = new Map<string, Function>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    on: vi.fn((channel, handler) => handlers.set(channel, handler)),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: { send: vi.fn() } }]),
  },
  shell: { openExternal: vi.fn() },
  dialog: { showErrorBox: vi.fn() },
  app: { quit: vi.fn() },
}))
```

### Test Cases

#### safeHandle wrapper

```
✓ registers handler on ipcMain.handle with given channel name
✓ returns handler result on success
✓ logs error to console on handler throw (does not crash)
✓ re-throws the error to the renderer (error propagation)
```

#### agent-handlers.ts

```
✓ registers all 8 expected channel names
✓ "agents:list" calls listAgents with (limit, status) args
✓ "agents:get" calls getAgentMeta with id
✓ "local:spawnClaudeAgent" calls spawnClaudeAgent with args
✓ "local:tailAgentLog" calls tailAgentLog with args
✓ "local:sendToAgent" calls sendToAgent with (pid, message)
✓ "local:isAgentInteractive" calls isAgentInteractive with pid
✓ "agents:import" calls importAgent with (meta, content)
✓ "agents:markDone" calls updateAgentMeta with (id, { status: 'done' })
✓ calls cleanupOldLogs() during registration (startup cleanup)
✓ calls pruneOldAgents() during registration (startup cleanup)
```

#### git-handlers.ts

```
✓ registers all 12 expected channel names
✓ "git:status" passes cwd to gitStatus
✓ "git:diff-file" passes (cwd, filePath) to gitDiffFile
✓ "git:diff" passes (repoPath, base) to getDiff
✓ "git:log" passes (cwd, count) to getLog
✓ "git:branches" passes cwd to gitBranches
✓ "git:stage" passes (cwd, files) to gitStage
✓ "git:unstage" passes (cwd, files) to gitUnstage
✓ "git:commit" passes (cwd, message) to gitCommit
✓ "git:push" passes cwd to gitPush
✓ "git:checkout" passes (cwd, branch) to gitCheckout
✓ "git:repo-paths" calls getRepoPaths
✓ "git:read-sprint-md" passes repoPath to readSprintMd
```

#### config-handlers.ts

```
✓ registers all 4 expected channel names
✓ "get-gateway-config" returns cached gateway config
✓ "save-gateway-config" calls saveGatewayConfig and refreshes cache
✓ "get-github-token" calls getGitHubToken
✓ "get-supabase-config" calls getSupabaseConfig
✓ handles getGatewayConfig() throw gracefully (doesn't crash registration)
```

#### gateway-handlers.ts

```
✓ registers "gateway:invoke" channel
✓ proxies HTTP POST to gateway URL with Bearer token
✓ converts ws:// to http:// in URL
✓ passes request body as JSON
✓ returns parsed JSON response
```

#### window-handlers.ts

```
✓ registers "open-external" channel
✓ registers "kill-local-agent" channel
✓ "open-external" calls shell.openExternal with URL
✓ "kill-local-agent" calls process.kill with PID and SIGTERM
✓ "set-title" sets window title via ipcMain.on listener
```

#### fs handlers (in fs.ts)

```
✓ registers all 3 expected channel names
✓ "list-memory-files" calls listMemoryFiles
✓ "read-memory-file" passes path to readMemoryFile
✓ "write-memory-file" passes (path, content) to writeMemoryFile
```

---

## Files to Create

| File | Purpose | Estimated LOC |
|------|---------|---------------|
| `src/main/__tests__/handlers.test.ts` | IPC handler wiring tests | ~250 |

## Files to Modify

None — tests only.

---

## Implementation Notes

- **Handler registration is side-effectful** — calling `registerAgentHandlers()` registers handlers on the mocked `ipcMain`. The test should call the registration function, then verify the captured handlers.
- **gateway-handlers.ts uses `fetch()`** — mock global `fetch` for the HTTP proxy test.
- **agent-handlers.ts calls `cleanupOldLogs()` and `pruneOldAgents()` during registration** — these are startup side effects that need mocking.
- **terminal-handlers.ts is covered by TQ-S5** — only include basic channel registration checks here, not PTY lifecycle.
- Keep handler tests thin — verify wiring and argument passing, not business logic.

## Acceptance Criteria

- [ ] All 30+ IPC channel names verified to be registered
- [ ] Each handler calls the correct underlying function with correct args
- [ ] Error handling via safeHandle verified (no main process crash)
- [ ] gateway:invoke HTTP proxy verified with mocked fetch
- [ ] Tests run via `npm run test:main`
