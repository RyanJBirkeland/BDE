# Process Boundary Audit — BDE Electron Architecture
**Date:** April 13, 2026  
**Auditor:** Process Boundary Lens  
**Scope:** IPC surface sprawl, preload bridge discipline, main/renderer coupling, handler wrapper coverage

---

## Executive Summary

The BDE Electron application demonstrates strong process boundary discipline overall. The architecture correctly separates main and renderer processes, uses the `safeHandle`/`safeOn` wrapper pattern consistently, and maintains type-safe IPC channels via `IpcChannelMap`. The preload bridge is well-organized into logical domains.

**Findings: 8 issues identified**
- **3 Critical:** Process-level trust violations and missing wrapper coverage
- **2 High:** IPC channel sprawl and inconsistent broadcast payload typing
- **3 Medium:** Preload bridge organization, handler naming consistency

---

## F-t1-boundaries-1: Missing safeHandle Wrapper in Broadcast Listeners

**Severity:** Critical  
**Category:** Process Boundaries  
**Location:** `src/preload/api-agents.ts:43-60`, `src/preload/api-utilities.ts:102-109`  
**Evidence:**
```typescript
// api-agents.ts (lines 43-59) — manual ipcRenderer.on without wrapper
export const agentEvents = {
  onEvent: (callback: (payload: BroadcastChannels['agent:event']) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: BroadcastChannels['agent:event']): void =>
      callback(payload)
    const batchHandler = (
      _e: IpcRendererEvent,
      payloads: BroadcastChannels['agent:event:batch']
    ): void => {
      for (const p of payloads) {
        callback(p)
      }
    }
    ipcRenderer.on('agent:event', handler)
    ipcRenderer.on('agent:event:batch', batchHandler)
    // ...
  }
}

// api-utilities.ts (line 102) — terminal data broadcast with hardcoded channel names
export const terminal = {
  onData: (id: number, cb: (data: string) => void): (() => void) => {
    const listener = (_: unknown, data: string): void => cb(data)
    ipcRenderer.on('terminal:data:' + id, listener)  // ← dynamic channel name
    return () => ipcRenderer.removeListener('terminal:data:' + id, listener)
  }
}
```

**Impact:**  
Broadcast listeners bypass the type-safe broadcast wrapper. While `onBroadcast` helper exists and is used elsewhere (e.g., `onGitHubError`, `onPrListUpdated`), some high-traffic channels manually construct listeners without type safety or error handling. The `terminal:data:${id}` dynamic channel is particularly risky — it's constructed ad-hoc without validation and could be spoofed by a compromised main process.

**Recommendation:**  
1. Create a `safeBroadcast<T>()` wrapper in `ipc-helpers.ts` that enforces type safety for all broadcast listeners:
   ```typescript
   export function safeBroadcast<T>(channel: string) {
     return (callback: (payload: T) => void): (() => void) => {
       // ... with error handling
     }
   }
   ```
2. Refactor `onEvent` in `api-agents.ts` to use `safeBroadcast`.
3. For dynamic channels like `terminal:data:${id}`, either:
   - Add them to `BroadcastChannels` as a special pattern, or
   - Create a separate `safeDynamicBroadcast()` that validates the channel name against a whitelist before subscribing.

**Effort:** M  
**Confidence:** High

---

## F-t1-boundaries-2: Terminal Process Coupling — BrowserWindow Access in Handlers

**Severity:** Critical  
**Category:** Process Boundaries  
**Location:** `src/main/handlers/terminal-handlers.ts:25-42`  
**Evidence:**
```typescript
// terminal-handlers.ts (lines 25-42)
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
    const win = BrowserWindow.fromWebContents(event.sender)  // ← direct window access
    if (win) terminalWindows.set(id, win.id)
    handle.onData((data) => {
      const winId = terminalWindows.get(id)
      const targetWin = winId
        ? BrowserWindow.getAllWindows().find((w) => w.id === winId)  // ← getAllWindows scan
        : undefined
      targetWin?.webContents.send(`terminal:data:${id}`, data)  // ← sends to window by ID
    })
    // ...
  }
)
```

**Impact:**  
Handler reaches directly into Electron's window management to route PTY data back to the renderer. This creates a hidden coupling: if a second renderer window exists, the handler must track which window "owns" each terminal. The `BrowserWindow.getAllWindows()` scan on every PTY data event is inefficient and fragile — window IDs can be reused. A tear-off window closing while data is flowing could cause data to be routed to the wrong (or newly created) window.

**Recommendation:**  
1. Introduce a `TerminalManager` service that decouples window routing from handler logic:
   ```typescript
   class TerminalManager {
     registerTerminal(id: number, windowId: number, onData: (data: string) => void)
     onWindowClosed(windowId: number)
     sendData(id: number, data: string)
   }
   ```
2. Have the handler only register the terminal; let the manager handle window tracking and sending via a stable, renderer-initiated subscription model (e.g., the renderer subscribes to `terminal:data:${id}` and the manager broadcasts to the subscription, not directly to a window).
3. Consider moving terminal routing to tearoff-manager.ts where window lifecycle is already being tracked.

**Effort:** M  
**Confidence:** High

---

## F-t1-boundaries-3: IDE Root Path Global State Without Renderer Isolation

**Severity:** Critical  
**Category:** Process Boundaries  
**Location:** `src/main/handlers/ide-fs-handlers.ts:11, 47-49`  
**Evidence:**
```typescript
// ide-fs-handlers.ts (lines 11, 47-49)
let ideRootPath: string | null = null
let watcher: fs.FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// ... later, in handler ...
export function getIdeRootPath(): string | null {
  return ideRootPath
}

// In registry.ts, all IDE fs handlers share this global state
registerIdeFsHandlers()  // No window context passed
```

**Impact:**  
The IDE root path is stored in module-level state without window/renderer context. If two renderer windows (main + tear-off) call `fs:watchDir` simultaneously, they will share the same `ideRootPath` and `watcher`. This means:
- Window A sets `ideRootPath = "/path/to/repo-a"`
- Window B then sets `ideRootPath = "/path/to/repo-b"`
- Window A's subsequent calls operate on repo-b
- Only one watcher is active, so filesystem changes in repo-a are missed

**Recommendation:**  
1. Refactor IDE root tracking to be per-window or per-invocation:
   ```typescript
   safeHandle('fs:watchDir', async (event, dirPath: string) => {
     const windowId = BrowserWindow.fromWebContents(event.sender)?.id
     if (!windowId) throw new Error('No window context')
     return watchDirForWindow(windowId, dirPath)
   })
   ```
2. Or, store watches in a `Map<windowId, { ideRoot, watcher, timer }>` structure.
3. Add a handler to clean up watches when a window closes:
   ```typescript
   app.on('browser-window-closed', (event, window) => {
     cleanupWatchesForWindow(window.id)
   })
   ```

**Effort:** M  
**Confidence:** High

---

## F-t1-boundaries-4: IPC Channel Sprawl — Oversized / Undifferentiated Channels

**Severity:** High  
**Category:** Process Boundaries  
**Location:** `src/shared/ipc-channels/sprint-channels.ts`, `src/shared/ipc-channels/system-channels.ts`  
**Evidence:**
```typescript
// sprint-channels.ts — review channels are interleaved with sprint CRUD
export interface ReviewChannels {
  'review:getDiff': { /* ... */ }
  'review:getCommits': { /* ... */ }
  'review:getFileDiff': { /* ... */ }
  'review:mergeLocally': { /* ... */ }
  // ... 10 more review operations ...
}

// These are exported alongside:
export interface SprintChannels {
  'sprint:list': { /* ... */ }
  'sprint:create': { /* ... */ }
  'sprint:update': { /* ... */ }
  // ... and more ...
}

// system-channels.ts — workbench is oversized with 7 channels
export interface WorkbenchChannels {
  'workbench:generateSpec': { /* ... */ }
  'workbench:checkSpec': { /* ... */ }
  'workbench:checkOperational': { /* ... */ }
  'workbench:researchRepo': { /* ... */ }
  'workbench:chatStream': { /* ... */ }
  'workbench:cancelStream': { /* ... */ }
  'workbench:extractPlan': { /* ... */ }
}
```

**Impact:**  
- **Review sprawl:** Review operations (getDiff, getCommits, mergeLocally, shipIt, etc.) are logically distinct from sprint task CRUD but exported from `SprintChannels`. The preload bridge groups them (`review:` namespace), but the type definitions scatter them across files. A renderer component using only review actions must still import `SprintChannels`.
- **Workbench oversizing:** The workbench has 7 channels covering spec generation, validation, chat, and plan extraction. These could be split into `SpecGeneration` (generate, revise), `SpecValidation` (checkSpec, checkOperational), and `WorkbenchChat` (chatStream, cancelStream). Current organization conflates three distinct concerns.
- **Discovery sprawl:** `RepoDiscoveryChannels` mixes local scanning, GitHub listing, and clone streaming — should perhaps be `RepoScan`, `GithubDiscovery`, and `CloneProgress`.

**Recommendation:**  
1. In `sprint-channels.ts`, separate `ReviewChannels` into its own export and create a separate file `review-channels.ts`.
2. In `system-channels.ts`, split `WorkbenchChannels` into:
   - `WorkbenchSpecChannels` (generateSpec, checkSpec, checkOperational, researchRepo)
   - `WorkbenchStreamChannels` (chatStream, cancelStream)
   - `WorkbenchPlanChannels` (extractPlan)
3. In `system-channels.ts`, split `RepoDiscoveryChannels` into:
   - `RepoScanChannels` (scanLocal, listGithub)
   - `RepoCloneChannels` (clone) + broadcast `repos:cloneProgress`
4. Update `ipc-channels/index.ts` to re-export these granular types.

**Effort:** M  
**Confidence:** Medium

---

## F-t1-boundaries-5: Broadcast Channels Lack Payload Type Safety

**Severity:** High  
**Category:** Process Boundaries  
**Location:** `src/shared/ipc-channels/broadcast-channels.ts:82-89`  
**Evidence:**
```typescript
// broadcast-channels.ts (lines 82-89)
export interface BroadcastChannels {
  // Tearoff window events
  'tearoff:confirmClose': { windowId: string }  // ← expects windowId in payload
  'tearoff:tabReturned': { windowId: string; view: string }
  'tearoff:tabRemoved': { windowId: string; view: string; newWindow?: boolean }
  'tearoff:dragIn': { viewKey: string; x: number; y: number }
  'tearoff:dragMove': { x: number; y: number }  // ← inconsistent: no sourceWindowId
  'tearoff:dragDone': void
  'tearoff:dragCancel': void
  'tearoff:crossWindowDrop': { viewKey: string; x: number; y: number; sourceWindowId: string }
}
```

Also, some handlers send via `webContents.send()` directly instead of using typed infrastructure:

```typescript
// In terminal-handlers.ts (line 32)
targetWin?.webContents.send(`terminal:data:${id}`, data)  // ← not in BroadcastChannels

// In ide-fs-handlers.ts (line ???)
win.webContents.send('fs:dirChanged', dirPath)  // ← IS in BroadcastChannels but no IPC wrapper
```

**Impact:**  
1. Tearoff drag/drop events are inconsistent: `dragMove` omits `sourceWindowId` while `crossWindowDrop` includes it. This suggests unclear ownership semantics — if a drag moves across windows, how does the renderer know which window initiated the drag?
2. `terminal:data:${id}` is never defined in `BroadcastChannels`, so it's an undocumented IPC channel. A renderer listening to `terminal:data:1` has no type safety; the event could carry any payload.
3. `fs:dirChanged` is in `BroadcastChannels` but the handler sends it via `webContents.send()` without going through a typed broadcast helper, making it easy to mistype the channel name.

**Recommendation:**  
1. Add terminal data broadcasts to `BroadcastChannels`:
   ```typescript
   export interface BroadcastChannels {
     'terminal:data': { id: number; data: string }
     'terminal:exit': { id: number }
   }
   ```
2. Standardize tearoff drag/drop by including `sourceWindowId` in all drag events:
   ```typescript
   'tearoff:dragIn': { viewKey: string; x: number; y: number; sourceWindowId: string }
   'tearoff:dragMove': { x: number; y: number; sourceWindowId: string }
   ```
3. In ide-fs-handlers.ts, use a broadcast helper instead of direct `webContents.send()`:
   ```typescript
   function broadcastDirChanged(dirPath: string): void {
     for (const win of BrowserWindow.getAllWindows()) {
       win.webContents.send('fs:dirChanged', dirPath)
     }
   }
   ```
4. Create a broadcast utility to send typed events:
   ```typescript
   export function broadcast<K extends keyof BroadcastChannels>(
     channel: K,
     payload: BroadcastChannels[K]
   ): void {
     for (const win of BrowserWindow.getAllWindows()) {
       win.webContents.send(channel, payload)
     }
   }
   ```

**Effort:** M  
**Confidence:** High

---

## F-t1-boundaries-6: Preload Bridge Organization — Mixed Domains in api-utilities.ts

**Severity:** Medium  
**Category:** Process Boundaries  
**Location:** `src/preload/api-utilities.ts` (entire file)  
**Evidence:**
The file exports 35+ top-level exports covering 15+ domains:
```typescript
// Clipboard + window (2 exports)
export const readClipboardImage = ...
export const openExternal = ...

// GitHub (2 exports)
export const github = { ... }

// Cost (1 export)
export const cost = { ... }

// PR (3 exports)
export const pollPrStatuses = ...
export const checkConflictFiles = ...
export const planner = { ... }

// File system (13 exports)
export const openFileDialog = ...
export const readFileAsBase64 = ...
// ... 11 more

// Workbench (7 exports, complex object)
export const workbench = { ... }

// Tearoff (18 sub-exports)
export const tearoff = { ... }

// Review (7 exports)
export const review = { ... }

// Spec Synthesizer (4 exports)
export const synthesizeSpec = ...
// ... 3 more
```

Compared to `api-sprint.ts`, which is focused and ~80 lines, `api-utilities.ts` is 223 lines of mixed concerns.

**Impact:**  
- **Cognitive load:** A renderer component importing from `api-utilities` to use tearoff APIs must parse through 200+ lines of unrelated code.
- **Bundle size:** Tree-shaking doesn't distinguish between utilities; importing one function imports all type definitions.
- **Discoverability:** New developers don't know whether their IPC need belongs in `api-utilities`, `api-agents`, or `api-sprint`.

**Recommendation:**  
Reorganize the preload bridge into focused files:
1. Split `api-utilities.ts` into:
   - `api-clipboard.ts` (readClipboardImage, openExternal)
   - `api-window.ts` (setTitle) — or fold into tearoff
   - `api-fs.ts` (all fs:* operations)
   - `api-pr.ts` (github, pollPrStatuses, checkConflictFiles)
   - `api-planner.ts` (planner, synthesizeSpec, reviseSpec, cancelSynthesis)
   - `api-workbench.ts` (workbench.*)
   - `api-tearoff.ts` (tearoff.*)
   - `api-review.ts` (review.*)
   - `api-dashboard.ts` (dashboard, system, cost)
   - `api-terminal.ts` (terminal.*)

2. Update `index.ts` to re-export from the new modules:
   ```typescript
   export { readClipboardImage, openExternal } from './api-clipboard'
   export { tearoff } from './api-tearoff'
   // ...
   ```

3. This keeps the preload surface cohesive while improving internal organization.

**Effort:** M  
**Confidence:** High

---

## F-t1-boundaries-7: Inconsistent Handler Naming — Function vs. Event Semantics

**Severity:** Medium  
**Category:** Process Boundaries  
**Location:** `src/main/handlers/`, channel names across multiple files  
**Evidence:**
```typescript
// Some channels use verb + noun pattern (implies action/query)
'sprint:list'              // query operation
'git:status'               // query operation
'agent:steer'              // action
'pr:pollStatuses'          // action

// Others use prefix as domain + verb (mixes query/action/event)
'terminal:create'          // action
'terminal:write'           // action (but uses safeOn, not safeHandle!)
'terminal:data:${id}'      // event (main → renderer broadcast)
'terminal:exit:${id}'      // event (main → renderer broadcast)

// Review handlers also mix patterns
'review:getDiff'           // action (query)
'review:mergeLocally'      // action (state mutation)
'review:shipIt'            // action (side effect: push, mark done)
'review:chatStream'        // action (returns streamId, followed by broadcast)
'review:chatAbort'         // action (stops stream)

// Compare to settings, which is purely query
'settings:get'
'settings:set'
```

**Impact:**  
- **Semantic confusion:** It's unclear from the channel name whether the operation is query-only, mutating, or event-driven.
- **Handler consistency:** `terminal:write` uses `safeOn` (one-way) while other action channels use `safeHandle` (invoke/response). This is correct per semantics, but the naming doesn't hint at it.
- **Streaming operations:** Operations like `review:chatStream` and `synthesizer:generate` initiate a stream and return a `streamId`, but then send data via a separate broadcast channel (`review:chatChunk`). The relationship is implicit, not explicit in naming.

**Recommendation:**  
1. Adopt a clearer naming convention:
   - **Queries (safeHandle):** `${domain}:get${Entity}` or `${domain}:list`  
     Example: `review:getDiff`, `sprint:list`, `agents:list`
   - **Mutations (safeHandle):** `${domain}:${action}`  
     Example: `sprint:create`, `review:mergeLocally`, `task:update`
   - **One-way events (safeOn):** `${domain}:send${Verb}` or keep as-is if already clear (e.g., `terminal:write`)  
   - **Streaming (safeHandle, returns streamId):** `${domain}:start${Stream}` or `${domain}:${action}Stream`  
     Example: `review:startChatStream`, `synthesizer:startGenerate`  
   - **Stream broadcasts (main → renderer):** `${domain}:${stream}Chunk` or `${domain}:on${Stream}Chunk`  
     Example: `review:chatChunk` (OK as-is), `workbench:chatChunk` (OK as-is)

2. Document the convention in a README or in comments at the top of channel definition files.

3. No code changes needed for existing channels (backward compatibility), but apply convention to new channels going forward.

**Effort:** S (documentation only, low-lift adoption rule)  
**Confidence:** Medium

---

## F-t1-boundaries-8: Git Handler Validates Repo Before Allowlist, Violating Principle of Least Privilege

**Severity:** Medium  
**Category:** Process Boundaries  
**Location:** `src/main/handlers/git-handlers.ts:143-148, 255-268`  
**Evidence:**
```typescript
// git-handlers.ts (lines 145-147)
safeHandle('github:isConfigured', () => {
  return getGitHubToken() !== null  // No validation; exposes token existence
})

// git-handlers.ts (lines 255-268) — detectRemote intentionally skips validateRepoPath
safeHandle('git:detectRemote', async (_e, cwd: string) => {
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) {
    return { isGitRepo: false, remoteUrl: null, owner: null, repo: null }
  }
  // Defense in depth: reject anything that doesn't normalize to itself or
  // contains parent-traversal segments. The operation is read-only via
  // execFile (no shell, no writes), so blast radius is small — this just
  // closes traversal tricks.
  const resolved = path.resolve(cwd)
  if (resolved !== cwd || cwd.includes('..')) {
    return { isGitRepo: false, remoteUrl: null, owner: null, repo: null }
  }
  return detectGitRemote(cwd)
})

// Comment explains why validateRepoPath is NOT used:
// "NOTE: validateRepoPath is intentionally NOT used here — this is called
//  BEFORE a repo is configured in settings (e.g. Settings > Add Repository
//  or the onboarding inline repo form), so the path is not yet on the
//  allowlist."
```

**Impact:**  
- **Token exposure:** `github:isConfigured` reveals whether a token exists. While not sensitive information per se, it exposes the authentication state to any renderer, which could be abused (e.g., UI showing "you're authenticated" before token is actually valid).
- **Two-path validation:** `detectRemote` uses a custom path validation instead of the standard `validateRepoPath`, which means two separate validation routines must be kept in sync. If `validateRepoPath` is updated to block a new attack vector (e.g., symlink escape), `detectRemote` won't benefit.
- **Intent confusion:** The comment says "not yet on allowlist," but the handler still performs ad-hoc validation. This makes it unclear whether the path should be constrained to known repos or not. A future developer might assume _all_ paths are fair game and relax validation further.

**Recommendation:**  
1. For `github:isConfigured`, defer token availability checks to the renderer. Instead, have the renderer attempt an operation and handle 401/403 responses, or:
   - Create an `auth:checkStatus` handler that returns detailed token state (valid, expired, missing), and cache it on the renderer side.

2. For `detectRemote`, codify the intent:
   - Option A: Require the path to be within the home directory (already done):
     ```typescript
     function validateNewRepoPath(cwd: string): string {
       const resolved = path.resolve(cwd)
       if (!resolved.startsWith(homedir() + '/')) {
         throw new Error('Must be in home directory')
       }
       // reuse validateRepoPath-style symlink checks
     }
     ```
   - Option B: Create a separate allowlist for discovery paths and add them after detection.
   
3. Extract common path validation logic into a shared utility:
   ```typescript
   // validation.ts
   export function validatePathWithinRoot(path: string, root: string): string {
     // shared symlink + traversal checks
   }
   export function validateConfiguredRepoPath(path: string): string {
     return validatePathWithinRoot(path, getConfiguredRepos())
   }
   export function validateDiscoveryPath(path: string): string {
     return validatePathWithinRoot(path, homedir())
   }
   ```

**Effort:** S  
**Confidence:** Medium

---

## Summary Table

| ID | Title | Severity | Category | Effort | Status |
|----|-------|----------|----------|--------|--------|
| F-t1-boundaries-1 | Missing safeHandle Wrapper in Broadcast Listeners | Critical | Boundaries | M | Open |
| F-t1-boundaries-2 | Terminal Process Coupling — BrowserWindow Access in Handlers | Critical | Boundaries | M | Open |
| F-t1-boundaries-3 | IDE Root Path Global State Without Renderer Isolation | Critical | Boundaries | M | Open |
| F-t1-boundaries-4 | IPC Channel Sprawl | High | Boundaries | M | Open |
| F-t1-boundaries-5 | Broadcast Channels Lack Payload Type Safety | High | Boundaries | M | Open |
| F-t1-boundaries-6 | Preload Bridge Organization | Medium | Boundaries | M | Open |
| F-t1-boundaries-7 | Inconsistent Handler Naming | Medium | Boundaries | S | Open |
| F-t1-boundaries-8 | Git Handler Validation Strategy | Medium | Boundaries | S | Open |

---

## Recommendations (Prioritized)

### Phase 1 (Critical — blocks stable multi-window support)
1. **F-t1-boundaries-3:** Refactor IDE root path to be per-window
2. **F-t1-boundaries-2:** Decouple terminal handler from window management
3. **F-t1-boundaries-1:** Add `safeBroadcast` wrapper for all broadcast listeners

### Phase 2 (High — improves type safety and discoverability)
4. **F-t1-boundaries-5:** Add terminal data and exit events to `BroadcastChannels`; create `broadcast()` utility
5. **F-t1-boundaries-4:** Split oversized channel interfaces into focused domains

### Phase 3 (Medium — improves maintainability and DX)
6. **F-t1-boundaries-6:** Reorganize preload API files by domain
7. **F-t1-boundaries-7:** Document and adopt handler naming convention
8. **F-t1-boundaries-8:** Consolidate path validation utilities

---

## Positive Observations

- ✅ **Consistent safeHandle usage:** All 29 handler modules use `safeHandle` or `safeOn` wrapper; no raw `ipcMain.handle()` calls
- ✅ **Type-safe channel map:** `IpcChannelMap` provides end-to-end compile-time safety for invoke/handle pairs
- ✅ **Renderer process boundary:** No renderer imports from `src/main`; clean separation
- ✅ **Preload bridge cohesion:** Grouped into logical domains (agents, git, sprint, fs, etc.); minimal cross-domain imports
- ✅ **GitHub API proxy discipline:** Strict allowlist prevents arbitrary API calls (security-first design)
- ✅ **Path traversal mitigations:** Review handlers, IDE fs, and git handlers all validate paths against configured roots

---

**End of Audit**
