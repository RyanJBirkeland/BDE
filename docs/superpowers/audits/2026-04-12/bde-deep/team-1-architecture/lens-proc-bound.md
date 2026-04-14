# Process Boundary Architecture Audit — BDE

## Executive Summary

The BDE codebase demonstrates **exceptional discipline** in maintaining Electron process boundaries. The renderer, main process, and preload layer are cleanly separated with virtually no violations. All IPC communication flows through a well-designed type-safe bridge (`safeHandle` wrappers on main, `window.api` on renderer). The shared modules are strictly isomorphic—they import neither Node.js built-ins nor DOM APIs, making them safe for both processes. Context isolation is properly enabled, all windows use consistent `webPreferences`, and the preload bridge contains no business logic.

**Result: No critical or high-severity findings.**

Three medium-severity observations are documented below for completeness and to enable proactive maintenance as the codebase evolves.

---

## F-t1-proc-bound-1: Type-Safe IPC Handler Wrapper Minimally Typed

**Severity:** Medium  
**Category:** Process Boundary / Type Safety  
**Location:** `src/main/ipc-utils.ts:11-43`  
**Evidence:**
```typescript
export function safeHandle<K extends keyof IpcChannelMap>(
  channel: K,
  handler: (
    e: Electron.IpcMainInvokeEvent,
    ...args: IpcChannelMap[K]['args']
  ) => IpcChannelMap[K]['result'] | Promise<IpcChannelMap[K]['result']>
): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await handler(e, ...(args as IpcChannelMap[K]['args']))  // <-- type assertion here
    } catch (err) {
      logger.error(`[${channel}] unhandled error: ${err}`)
      throw err
    }
  })
}
```

**Impact:** The `as IpcChannelMap[K]['args']` type assertion on line 20 bypasses TypeScript's type guard. If an IPC channel is invoked with mismatched arguments at runtime (e.g., if a malicious renderer or a compromised preload sends garbage), the type assertion will not catch it. The handler will receive untrusted data and may behave unexpectedly. This is a subtle but real trust boundary issue.

**Recommendation:** Either (a) validate the args tuple shape at runtime using a discriminator or schema (e.g., `superstruct`, `zod`), or (b) document that all handlers **must** validate their inputs independently before using them. The first option is more robust; the second is a lightweight alternative if payload validation is already done per-channel.

**Effort:** M  
**Confidence:** Medium

---

## F-t1-proc-bound-2: Preload Uses `import()` for Types from Shared; Could Leak at Build Time if Misconfigured

**Severity:** Medium  
**Category:** Process Boundary / Import Hygiene  
**Location:** `src/preload/index.ts:320` (and others)  
**Evidence:**
```typescript
save: (template: import('../shared/types').TaskTemplate) =>
  typedInvoke('templates:save', template),
```

Inline `import()` syntax is used to reference types from shared without creating top-level imports. While this pattern is type-safe (the import is eliminated at compile time), it creates a subtle **implicit dependency** on the shared module being available in the preload's resolve chain.

**Impact:** If the TypeScript compiler or bundler is misconfigured (e.g., `skipLibCheck: true`, or if electron-vite's preload config is changed), these inline imports could accidentally be resolved at runtime, leaking shared module code into the preload bundle. The preload should only export the API surface; all business logic should live in main or shared.

**Recommendation:** Extract all `import()` type references to top-level imports in a dedicated `.d.ts` file, or use explicit `import type` statements at the top of `index.ts`. This makes the dependency graph explicit and easier to audit.

**Effort:** S  
**Confidence:** Medium

---

## F-t1-proc-bound-3: LocalStorage Used Directly in Renderer Without Fallback for Non-Persistent Contexts

**Severity:** Medium  
**Category:** Process Boundary / Data Persistence  
**Location:** `src/renderer/src/stores/` (12+ files); example: `theme.ts:60-62`  
**Evidence:**
```typescript
const stored = localStorage.getItem('bde-theme')
if (!stored) {
  localStorage.setItem('bde-theme', 'dark')
}
```

LocalStorage is used throughout the renderer to persist UI state (theme, command palette history, drafts, notifications, etc.). While LocalStorage is available in Electron renderer contexts, there are edge cases where it can fail or be unavailable:
- Context isolation in process-less renderer contexts
- Incognito/private window mode
- Storage quota exhausted
- SecurityError thrown in some sandbox contexts

The code has try-catch blocks in some stores (e.g., `pendingReview.ts:85`), but not in others (e.g., `theme.ts`). This inconsistency can lead to unhandled storage errors crashing the UI.

**Impact:** If `localStorage.setItem` fails silently or throws, and the calling code doesn't catch it, the application state diverges from persisted state. The user's preferences are lost on next launch. In the theme store, this could cause the UI to reset to a default theme on startup, which is jarring.

**Recommendation:** 
1. Wrap all localStorage access in try-catch blocks, even reads.
2. Provide a fallback in-memory store (Zustand state) when localStorage is unavailable.
3. Consider adding a `useLocalStorage` hook that centralizes this logic and provides a consistent API.

**Effort:** M  
**Confidence:** High

---

## Positive Findings (No Issues)

The following architectural practices are **exemplary** and should be maintained:

1. **Process Isolation**: Renderer never imports from `src/main/`. Main never imports from `src/renderer/`. Type-only imports from preload `.d.ts` are safe and allowed.

2. **Shared Module Purity**: All 40+ files in `src/shared/` contain only isomorphic utilities (parsing, validation, type definitions). No Node.js built-ins (`fs`, `path`, `child_process`, etc.) and no DOM APIs (`window`, `document`, `localStorage`) are imported—only used passively via the bridge.

3. **Type-Safe IPC**: The `IpcChannelMap` pattern in `src/shared/ipc-channels/` provides compile-time guarantees that renderer and main process agree on channel names and argument/return types. All 40+ handlers use `safeHandle()` or `safeOn()` wrappers, eliminating magic strings and typos.

4. **Context Isolation & Preload**: `contextIsolation: true` is enabled in all windows (`tearoff-manager.ts:26`, `index.ts:55`). The preload bridge (`src/preload/index.ts:545-557`) correctly exposes the API via `contextBridge.exposeInMainWorld()`.

5. **No Dynamic Requires in Renderer**: Dynamic `import()` statements in the renderer only load modules from `src/renderer/` (test mocks) and never from `src/main/`. Legitimate dynamic imports in main (e.g., `src/main/adhoc-agent.ts:98`) are for lazy-loading Node.js modules and SDK code.

6. **Preload Minimalism**: The preload is purely a bridge—it contains no business logic, no database queries, no file I/O. It only wraps `ipcRenderer.invoke()` calls and registers event listeners.

---

## Recommendations for Future Maintenance

1. **Linter Rule**: Add an ESLint rule to forbid `import` (not `import type`) from `src/main/` in renderer files, and vice versa. This catches refactoring mistakes early.

2. **Type-Safe Error Propagation**: Define a discriminated union type for IPC errors (e.g., `{ type: 'validation', message: string }`) to distinguish client errors from server errors.

3. **Preload .d.ts Generation**: Auto-generate `src/preload/index.d.ts` from the API object shape in `index.ts` to reduce manual synchronization burden.

4. **Storage Contract**: Formalize localStorage (and future state persistence) as a **stable contract** by documenting which stores use it and what the fallback behavior is when storage is unavailable.

---

## Audit Methodology

- Searched for forbidden cross-process imports (`src/main/` in renderer, `src/renderer/` in main).
- Audited shared module imports for environment-specific APIs.
- Verified preload is purely a bridge with no business logic.
- Checked electron-vite config for alias or resolve misconfigurations.
- Reviewed TypeScript configs for type safety violations.
- Spot-checked IPC handler implementations for type safety.
- Verified context isolation and webPreferences in all windows.
- Searched for dynamic `require()` in renderer and dangerous globals (eval, Function, etc.).

**Files examined:**
- `src/renderer/src/**/*.{ts,tsx}` (150+ files) — no main imports found
- `src/main/**/*.{ts,tsx}` (100+ files) — no renderer imports found
- `src/shared/**/*.{ts,tsx}` (40+ files) — no Node.js or DOM imports found
- `src/preload/index.ts` — bridge-only, no business logic
- `electron.vite.config.ts`, `tsconfig.*.json` — no problematic aliases
- IPC handler registry and implementations — all use safe wrappers

**Confidence:** High. The codebase's strong discipline and explicit architecture rules make violations obvious and maintainers are aware of the boundaries.
