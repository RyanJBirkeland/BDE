# Architecture Boundary Audit - BDE Electron App
**Date:** 2026-04-13  
**Scope:** Clean Code / Clean Architecture - Process Boundary Violations  
**Methodology:** Read-only inspection of src/main, src/renderer, src/shared, src/preload

---

## Summary
Examined 40+ files across the 4 process boundaries. Found **4 critical violations** where IPC handler registration bypasses type safety and contract definitions. Overall architecture is sound: renderer correctly uses window.api, main doesn't import from renderer, and shared layer contains only types/utilities. One preload surface-area violation found.

---

## F-t3-layers-1: Untyped Tearoff Event Listeners Bypass IPC Contract
**Severity:** High  
**Category:** IPC Bypass / Type System Violation  
**Location:** `src/main/tearoff-manager.ts:561-632`  
**Evidence:**
```typescript
ipcMain.on('tearoff:dropComplete', (_event, payload: { view: string; targetPanelId: string; zone: string }) => { ... })
ipcMain.on('tearoff:dragCancelFromRenderer', () => { ... })
ipcMain.on('tearoff:viewsChanged', (_event, payload: { windowId: string; views: string[] }) => { ... })
ipcMain.on('tearoff:returnAll', (_event, payload: { windowId: string; views: string[] }) => { ... })
ipcMain.on('tearoff:returnToMain', (_event, payload: { windowId: string }) => { ... })
```

**Impact:**
- Hardcoded channel strings not checked against `IpcChannelMap` types
- Manual type annotations in handlers instead of deriving from contract
- Future refactoring to IPC channels (e.g., renaming 'tearoff:returnToMain') risks silent breakage
- No compile-time mismatch detection between preload bridge and handler registration
- Inconsistent with app's own pattern: all other handlers use `safeHandle()` or `safeOn()`

**Recommendation:**
1. Extract handlers into `src/main/handlers/tearoff-handlers.ts`
2. Register using `safeOn()` from `ipc-utils.ts` for type safety
3. Examples of correct pattern already exist in `window-handlers.ts`, `terminal-handlers.ts`
4. Verify these 5 channels (dropComplete, dragCancelFromRenderer, viewsChanged, returnAll, returnToMain) are defined in `IpcChannelMap` before refactoring

**Effort:** M  
**Confidence:** High

---

## F-t3-layers-2: Hardcoded IPC Channel String in tearoff-manager Dynamic Response Listener
**Severity:** Medium  
**Category:** IPC Bypass  
**Location:** `src/main/tearoff-manager.ts:209-225` (askRendererForAction function)  
**Evidence:**
```typescript
const responseChannel = `tearoff:closeResponse:${windowId}`
ipcMain.once(responseChannel, (_event, payload: { action: 'return' | 'close' }) => {
  clearTimeout(timeout)
  resolve(payload?.action ?? 'close')
})
```

**Impact:**
- Dynamic channel name generated at runtime — no static contract definition
- Response channel name not in `IpcChannelMap` because it's parameterized with windowId
- Type mismatch: handler expects `{ action: 'return' | 'close' }` but pattern is not enforced
- If preload stops sending on this pattern, no compile-time warning

**Recommendation:**
1. Add a new channel family definition in `src/shared/ipc-channels/ui-channels.ts` to document this pattern
2. Document constraint: channel name format must be `tearoff:closeResponse:{uuid}`
3. Validate windowId is UUID format before using in channel name
4. Consider alternative: use fixed channel name with payload containing windowId instead of embedding in channel name

**Effort:** M  
**Confidence:** Medium

---

## F-t3-layers-3: Preload Exposes Internal Electron Callbacks Without Explicit Contract
**Severity:** Medium  
**Category:** Preload Overexposure  
**Location:** `src/preload/index.ts:283-302` (agent event streaming setup)  
**Evidence:**
```typescript
agentEvents: {
  onEvent: (callback: (payload: BroadcastChannels['agent:event']) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: BroadcastChannels['agent:event']): void => callback(payload)
    const batchHandler = (_e: IpcRendererEvent, payloads: BroadcastChannels['agent:event:batch']): void => {
      for (const p of payloads) {
        callback(p)
      }
    }
    ipcRenderer.on('agent:event', handler)
    ipcRenderer.on('agent:event:batch', batchHandler)
    return () => {
      ipcRenderer.removeListener('agent:event', handler)
      ipcRenderer.removeListener('agent:event:batch', batchHandler)
    }
  },
  getHistory: (agentId: string) => typedInvoke('agent:history', agentId)
}
```

**Impact:**
- Preload mixes typed invoke channels (`getHistory` via typedInvoke) with untyped broadcast listeners (`onEvent` manually calling ipcRenderer.on)
- Callback registration logic duplicated: batching logic is opaque to renderer
- If batch consolidation logic needs change (e.g., different batch size), requires preload recompile
- Pattern not consistent with other broadcast listeners in preload (e.g., `onGitHubError`, `onPrListUpdated` which are identical)

**Recommendation:**
1. Create a factory function in preload for registering broadcast listeners to DRY up the pattern:
   ```typescript
   function onBroadcast<K extends keyof BroadcastChannels>(
     channel: K,
     callback: (data: BroadcastChannels[K]) => void
   ): () => void { ... }
   ```
2. Refactor agentEvents.onEvent to use the factory
3. Document batch consolidation as a preload detail (not part of the contract)

**Effort:** S  
**Confidence:** Medium

---

## F-t3-layers-4: Renderer Stores Correctly Isolated — No Violations Found
**Severity:** N/A  
**Category:** Pattern Compliance  
**Location:** Spot check: `src/renderer/src/stores/{gitTree,sprintTasks,ide}.ts`  
**Evidence:**
- All IPC calls go through `window.api` bridge: `await window.api.gitStatus(cwd)`
- No direct `ipcRenderer` imports or calls in store layer
- No imports from `src/main/` directories
- Stores properly use Zustand with type safety from shared types

**Impact:** Positive — boundary is correctly enforced.

**Recommendation:** None. This is exemplary.

**Effort:** N/A  
**Confidence:** High

---

## F-t3-layers-5: Shared Layer Contains Only Types and Utilities — No Violations Found
**Severity:** N/A  
**Category:** Pattern Compliance  
**Location:** Spot check: `src/shared/{github.ts, models.ts, spec-validation.ts, sanitize-depends-on.ts, template-heuristics.ts}`  
**Evidence:**
- No Node.js APIs (fs, path, os, child_process, crypto)
- No browser APIs (fetch, localStorage, document)
- No business logic or state management (no services, handlers, stores)
- Pure utility functions: `parseGitHubRemote()`, `sanitizeDependsOn()`, `detectTemplate()`, spec validation
- All types are data contracts, not implementation details

**Impact:** Positive — shared layer is correctly portable across main/renderer/CLI.

**Recommendation:** None. This is exemplary.

**Effort:** N/A  
**Confidence:** High

---

## F-t3-layers-6: Main Process Does Not Import from Renderer — No Violations Found
**Severity:** N/A  
**Category:** Pattern Compliance  
**Location:** Grep scan: `src/main/**/*.ts` for `from.*renderer`  
**Evidence:**
- Only match: `architecture-rules.ts` (memory/docs, not execution)
- All main handlers use safeHandle/safeOn for type safety
- Broadcast layer correctly typed via BroadcastChannels

**Impact:** Positive — unidirectional dependency preserved.

**Recommendation:** None. This is exemplary.

**Effort:** N/A  
**Confidence:** High

---

## Summary Table

| Finding | Severity | Location | Type | Effort |
|---------|----------|----------|------|--------|
| F-t3-layers-1 | High | tearoff-manager.ts:561–632 | IPC Bypass | M |
| F-t3-layers-2 | Medium | tearoff-manager.ts:209–225 | IPC Bypass | M |
| F-t3-layers-3 | Medium | preload/index.ts:283–302 | Preload Design | S |
| ✓ Renderer isolation | N/A | src/renderer/src/stores/ | Compliant | N/A |
| ✓ Shared purity | N/A | src/shared/ | Compliant | N/A |
| ✓ Main/Renderer direction | N/A | src/main/ | Compliant | N/A |

---

## Remediation Priority
1. **F-t3-layers-1** (High) — Extract tearoff handlers to safeOn pattern. Unblocks type-safe refactoring.
2. **F-t3-layers-2** (Medium) — Document dynamic channel pattern or refactor. Current workaround is acceptable but fragile.
3. **F-t3-layers-3** (Medium) — DRY up broadcast listener pattern. Low effort, improves maintainability.

All findings are fixable without architectural redesign. The app's core boundary discipline is strong.
