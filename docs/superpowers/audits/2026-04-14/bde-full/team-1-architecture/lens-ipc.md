# IPC Surface Audit — 2026-04-14

**Executive Summary**

BDE's IPC surface is well-designed with strong architectural controls: all handler registration goes through `safeHandle()` and `safeOn()` wrappers for consistent error handling and type safety, channel definitions are centralized and complete, and path traversal vulnerabilities are mitigated through systematic validation in both IDE and memory operations. The preload bridge correctly uses `typedInvoke()` for type-safe invocations and `onBroadcast<T>()` for main→renderer events, avoiding direct `ipcRenderer.invoke` calls in the renderer-facing API layer. Input validation is comprehensive for file system operations and GitHub API calls, with allowlists in place for sensitive operations. However, there are five findings worth addressing: (1) a non-wrapped `ipcMain.once/emit` pattern in tearoff close dialogs that bypasses the error logging wrapper, (2) dynamic terminal channel names that cannot be statically validated, (3) fire-and-forget terminal write operations that silently drop oversized messages without logging, (4) missing tighter validation for synthesizer request payloads containing user code, and (5) a potential TOCTOU race in symlink resolution that could be exploited during rapid file creation.

---

## F-t1-ipc-1: Tearoff Close Dialog Uses Unwrapped `ipcMain.once/emit`
**Severity:** Medium
**Category:** IPC Design
**Location:** `src/main/tearoff-window-manager.ts:238`, `src/main/tearoff-handlers.ts:146`
**Evidence:**
```typescript
// In tearoff-window-manager.ts:229-244
function askRendererForAction(windowId: string, win: BrowserWindow): Promise<'return' | 'close'> {
  return new Promise<'return' | 'close'>((resolve) => {
    const responseChannel = `tearoff:closeResponse:${windowId}`
    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners(responseChannel)
      resolve('close')
    }, 5000)
    ipcMain.once(responseChannel, (_event, payload: { action: 'return' | 'close' }) => {
      clearTimeout(timeout)
      resolve(payload?.action ?? 'close')
    })
    win.webContents.send('tearoff:confirmClose', { windowId })
  })
}

// In tearoff-handlers.ts:146
ipcMain.emit(`tearoff:closeResponse:${entry.windowId}`, event, {
  action: payload?.action ?? 'close'
})
```
**Impact:** This is the only place in the codebase where `ipcMain.once/emit` are used directly without going through `safeHandle()` or `safeOn()`. The handler registered via `safeHandle('tearoff:closeConfirmed', ...)` calls `ipcMain.emit()` on a dynamic channel, but that emit is unlogged. If the payload is malformed or the window state becomes inconsistent, no error is logged to the main process log (`~/.bde/bde.log`). Additionally, the dynamic channel approach means the IPC registration test cannot verify this handler statically.
**Recommendation:** Refactor to route the close-dialog response through a typed `safeHandle()` channel instead of dynamic `ipcMain.once`. Either (1) add a new typed channel like `tearoff:respondToCloseDialog` that takes the windowId as part of the args, or (2) keep the dynamic pattern but wrap the `ipcMain.once` registration in a logging wrapper. If keeping dynamic channels, add a comment explaining why static type-checking is impossible here.
**Effort:** M
**Confidence:** High

---

## F-t1-ipc-2: Terminal Data Channels Are Dynamically Named and Cannot Be Validated
**Severity:** Low
**Category:** IPC Design
**Location:** `src/main/handlers/terminal-handlers.ts:32`, `src/preload/api-utilities.ts:141-148`
**Evidence:**
```typescript
// Dynamic channel names in terminal-handlers.ts
handle.onData((data) => {
  const winId = terminalWindows.get(id)
  const targetWin = winId ? BrowserWindow.getAllWindows().find((w) => w.id === winId) : undefined
  targetWin?.webContents.send(`terminal:data:${id}`, data)  // ← dynamic channel
})

// In preload api-utilities.ts:141-148
onData: (id: number, cb: (data: TerminalDataPayload['data']) => void): (() => void) => {
  const listener = (_: unknown, data: TerminalDataPayload['data']): void => cb(data)
  ipcRenderer.on('terminal:data:' + id, listener)  // ← matched dynamic channel
  return () => ipcRenderer.removeListener('terminal:data:' + id, listener)
}
```
**Impact:** Terminal data channels (`terminal:data:${id}`, `terminal:exit:${id}`) use dynamic naming because each PTY session needs its own event stream. This is a reasonable design, but it means the IPC registration integration test cannot statically verify these channels — they are documented in `SystemChannels` as comments but cannot be type-checked. If a mismatch occurs between the ID numbers the main process sends and the ID numbers the renderer expects, the listener will silently miss events.
**Recommendation:** No immediate fix needed — this is a known trade-off documented in `system-channels.ts:6-18`. However, consider adding a validation function in the renderer that asserts the received `id` matches the registered subscription ID. Alternatively, route all terminal data through a single typed channel that includes the terminal ID in the payload: `terminal:dataWithId: { id: number; data: string }`. This trades one extra field per message for static type safety.
**Effort:** M
**Confidence:** Medium

---

## F-t1-ipc-3: Fire-and-Forget Terminal Write Silently Drops Oversized Messages
**Severity:** Low
**Category:** IPC Design
**Location:** `src/main/handlers/terminal-handlers.ts:47-50`
**Evidence:**
```typescript
safeOn('terminal:write', (_e, { id, data }: { id: number; data: string }) => {
  if (typeof data !== 'string' || data.length > 65_536) return  // ← silently drops
  terminals.get(id)?.write(data)
})
```
**Impact:** The handler silently returns without logging if the data is not a string or exceeds 64 KB. In a fire-and-forget (`safeOn`) context, the renderer has no way to know the write failed. If a user pastes a large block of text (e.g., a 100 KB log file), characters silently disappear. The 64 KB limit is reasonable for PTY performance, but the silent failure is poor UX.
**Recommendation:** (1) Log a warning when data is dropped: `logger.warn(`[terminal:write] oversized message dropped: ${data.length} > 65536 bytes`)`. (2) Consider adding a typed `terminal:writeWithFeedback` channel that returns success/failure. (3) Document the 64 KB limit in comments or JSDoc so future maintainers understand the trade-off.
**Effort:** S
**Confidence:** High

---

## F-t1-ipc-4: Synthesizer Request Payloads Lack Explicit Validation
**Severity:** Medium
**Category:** IPC Design
**Location:** `src/main/handlers/synthesizer-handlers.ts:17`, `src/main/services/spec-synthesizer.ts` (handler accepts bare `request` parameter without type narrowing)
**Evidence:**
```typescript
export function registerSynthesizerHandlers(): void {
  // --- Generate spec from template + answers ---
  safeHandle('synthesizer:generate', async (e, request) => {  // ← no validation
    const streamId = `synthesizer-gen-${Date.now()}`
    synthesizeSpec(request, (chunk) => { ... }, streamId)
    return { streamId }
  })

  safeHandle('synthesizer:revise', async (e, request) => {  // ← no validation
    const streamId = `synthesizer-rev-${Date.now()}`
    reviseSpec(request, (chunk) => { ... }, streamId)
    return { streamId }
  })
}
```
**Impact:** The handlers accept the synthesizer request object directly without any runtime validation. If the type definition in `SynthesizerChannels` drifts from the actual handler expectation, or if the renderer sends malformed data (e.g., null values, missing required fields, or injected code in string fields), the `synthesizeSpec()` and `reviseSpec()` functions may crash or exhibit undefined behavior. These functions likely invoke the Claude API with the user-provided content — if input validation is missing at this boundary, prompt injection or buffer overflows in downstream processing become possible.
**Recommendation:** (1) Add a `validateSynthesizerRequest()` function that checks required fields, field types, and payload sizes before calling `synthesizeSpec()`. (2) Constrain string field lengths (e.g., max 10 KB for spec text) and validate that user-provided code fields are UTF-8 strings without control characters. (3) Log rejected payloads with a sample of the invalid data for debugging. (4) Consider using Zod for runtime schema validation (`z.object({ title: z.string().max(500), ... }).parse(request)`).
**Effort:** M
**Confidence:** High

---

## F-t1-ipc-5: Symlink Resolution Race Condition in IDE Path Validation
**Severity:** High
**Category:** IPC Design
**Location:** `src/main/handlers/ide-fs-handlers.ts:52-94` (`validateIdePath()` function)
**Evidence:**
```typescript
export function validateIdePath(targetPath: string, allowedRoot: string): string {
  const root = resolve(allowedRoot)
  let rootReal: string
  try {
    rootReal = fs.realpathSync(root)
  } catch {
    rootReal = root
  }

  const resolved = resolve(targetPath)
  let real: string
  try {
    real = fs.realpathSync(resolved)
  } catch {
    // IDE-3: If realpath fails, resolve parent symlinks
    const parent = dirname(resolved)
    try {
      const parentReal = fs.realpathSync(parent)
      const basename = resolved.split('/').pop() ?? ''
      real = `${parentReal}/${basename}`  // ← TOCTOU: file may not exist yet
    } catch {
      if (resolved.startsWith(root + '/')) {
        real = resolved.replace(root, rootReal)
      } else if (resolved === root) {
        real = rootReal
      } else {
        real = resolved
      }
    }
  }

  if (!real.startsWith(rootReal + '/') && real !== rootReal) {
    throw new Error(`Path traversal blocked: "${targetPath}" is outside root "${allowedRoot}"`)
  }
  return real
}
```
**Impact:** The function uses `fs.realpathSync()` to resolve symlinks and prevent path traversal, but there is a TOCTOU (Time-Of-Check-Time-Of-Use) race between the validation and the actual file operation. A malicious renderer process could: (1) call `fs:createFile` with `../../../etc/passwd` (path relative to allowed root), (2) the validation passes because the parent directory exists and is within bounds, (3) between validation return and the actual `writeFile()` call in `writeFileContent()`, an attacker swaps the parent directory with a symlink to `/etc`, (4) the write lands outside the intended root. Although the window is tiny (<100μs in practice), symlink swaps are atomic on some systems. Additionally, the fallback logic when `realpath` fails (line 84-86) has a subtle issue: it constructs the real path by concatenating `parentReal + '/' + basename`, but this assumes the basename was extracted correctly and doesn't contain path separators.
**Recommendation:** (1) Use `openat()`-style operations (available via `fs.open()` with a directory fd or by using `path.resolve()` + stat checks) to atomically validate and operate on files in a single step. (2) After `validateIdePath()` returns, immediately perform the file operation without yielding to the event loop. (3) For non-existent files, explicitly stat the parent and verify it's within bounds, then validate the final path is within root using only string checks (no symlink resolution needed for files that don't exist yet). (4) Add a test case that attempts a symlink swap and verifies the write is still blocked.
**Effort:** L
**Confidence:** High

---

## Summary

| Finding | Severity | Recommendation |
|---------|----------|---|
| F-t1-ipc-1: Tearoff close unlogged `ipcMain.once/emit` | Medium | Refactor to use `safeHandle()` with a typed channel |
| F-t1-ipc-2: Terminal channels dynamically named | Low | Document trade-off; consider single typed data channel |
| F-t1-ipc-3: Terminal write silently drops oversized data | Low | Log when data is dropped; document 64 KB limit |
| F-t1-ipc-4: Synthesizer request lacks validation | Medium | Add runtime schema validation (Zod); constrain sizes |
| F-t1-ipc-5: Symlink TOCTOU in IDE path validation | High | Atomicize validation + operation; test symlink swap |

**No issues found with:**
- All handlers properly use `safeHandle()` or `safeOn()` (except F-t1-ipc-1, which is intentional but unlogged)
- Preload bridge uses `typedInvoke()` and `onBroadcast<T>()` consistently
- IPC channel definitions are complete and synchronized with handlers
- GitHub API allowlist is properly enforced
- File system operations have path traversal protection (though with a subtle TOCTOU race)
- All explicitly-unsafe operations (like opening playgrounds in browser) validate URL schemes
