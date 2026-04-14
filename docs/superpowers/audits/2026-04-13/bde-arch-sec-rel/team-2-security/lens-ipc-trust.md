# IPC Trust Boundary Security Audit
**Date:** 2026-04-13  
**Auditor:** Claude (IPC Trust Boundary Auditor)  
**Scope:** Main process IPC handlers and renderer-supplied data validation

---

## F-t2-ipc-trust-1: Untyped One-Way IPC Messages in Tearoff Handlers
**Severity:** High  
**Category:** IPC Trust Boundary  
**Location:** `/Users/ryan/projects/BDE/src/main/tearoff-handlers.ts:161-229`

**Evidence:**
Lines 161-171, 174-180, 183-205, 208-229 register four IPC handlers using raw `ipcMain.on()` without type safety or the `safeOn()` wrapper:

```typescript
// Line 161-166: No safeOn wrapper, no type definition
ipcMain.on(
  'tearoff:dropComplete',
  (_event, payload: { view: string; targetPanelId: string; zone: string }) => {
    handleDropComplete(payload)
  }
)

// Line 174-180: Direct ipcMain.on without safeOn
ipcMain.on('tearoff:viewsChanged', (_event, payload: { windowId: string; views: string[] }) => {
  const entry = getEntry(payload.windowId)
  if (entry) {
    entry.views = payload.views
    persistTearoffStateNow()
  }
})

// Line 183-205: Direct manipulation of window state based on renderer-supplied windowId
ipcMain.on('tearoff:returnAll', (_event, payload: { windowId: string; views: string[] }) => {
  const entry = getEntry(windowId)
  if (!entry) {
    logger.warn(`[tearoff] returnAll: unknown windowId ${windowId}`)
    return
  }
  // ... direct call to entry.win.destroy()
})

// Line 208-229: Same pattern
ipcMain.on('tearoff:returnToMain', (_event, payload: { windowId: string }) => {
  const { windowId } = payload ?? {}
  // ... direct window destruction
})
```

These channels are NOT defined in `/Users/ryan/projects/BDE/src/shared/ipc-channels/ui-channels.ts` alongside other tearoff handlers (`tearoff:create`, `tearoff:closeConfirmed`, `tearoff:startCrossWindowDrag`), meaning they exist outside the type-safe IPC contract.

**Impact:**  
1. **No error wrapping:** Unlike `safeOn()` which provides try-catch and logging, these handlers have zero error instrumentation. A crash in payload handling is silent.
2. **No type safety:** TypeScript cannot validate these payloads at compile time. The renderer could send arbitrary data (e.g., windowId as a number, views as a string, missing fields).
3. **State manipulation without validation:** `tearoff:returnAll` and `tearoff:returnToMain` destructively close windows based on a windowId string supplied by the renderer with only a Map lookup (no format validation).
4. **Inconsistent pattern:** Three of the four tearoff handlers (`create`, `closeConfirmed`, `startCrossWindowDrag`) correctly use `safeHandle()` with type definitions. These four violate the established pattern.

**Recommendation:**  
1. Move all four channels to the IPC channel map in `/Users/ryan/projects/BDE/src/shared/ipc-channels/ui-channels.ts` with explicit type definitions.
2. Replace all `ipcMain.on()` calls with `safeOn()` to enable error logging and try-catch wrapping.
3. Add format validation for `windowId` (must match UUID pattern or a small allowlist of active tearoff IDs).
4. Consider refactoring `tearoff:dropComplete` and `tearoff:dragCancelFromRenderer` to use `ipcMain.handle()` (synchronous acknowledgment) rather than one-way messages if they involve state mutations.

```typescript
// Proposed fix:
export interface TearoffChannels {
  'tearoff:dropComplete': {
    args: [{ view: string; targetPanelId: string; zone: string }]
    result: void
  }
  'tearoff:dragCancelFromRenderer': {
    args: []
    result: void
  }
  'tearoff:viewsChanged': {
    args: [{ windowId: string; views: string[] }]
    result: void
  }
  'tearoff:returnAll': {
    args: [{ windowId: string; views: string[] }]
    result: void
  }
  'tearoff:returnToMain': {
    args: [{ windowId: string }]
    result: void
  }
}

// In tearoff-handlers.ts:
safeOn('tearoff:dropComplete', (_event, payload) => {
  handleDropComplete(payload)
})
```

**Effort:** M  
**Confidence:** High

---

## F-t2-ipc-trust-2: Missing Runtime Type Validation on GitHub API Proxy Request Body
**Severity:** Medium  
**Category:** IPC Trust Boundary  
**Location:** `/Users/ryan/projects/BDE/src/main/handlers/git-handlers.ts:77-91, 150-210`

**Evidence:**
The `github:fetch` handler accepts an optional `body` parameter typed as `string?` in the IPC channel definition, but the handler does not validate that the renderer actually sent a string:

```typescript
// Line 150-210: github:fetch handler
safeHandle('github:fetch', async (_e, path: string, init?: GitHubFetchInit) => {
  // ... path validation ...
  const method = init?.method ?? 'GET'
  // Line 182: body is passed directly without type assertion
  if (!isGitHubRequestAllowed(method, apiPath, init?.body)) {
    // ...
  }
  // Line 198-203: body is passed to githubFetch without validation
  const res = await githubFetch(url, {
    method: init?.method,
    headers: { ...safeHeaders, Authorization: `Bearer ${token}` },
    body: init?.body,  // <-- unvalidated
    timeoutMs: 30_000
  })
})

// Line 77-91: validatePatchBody assumes body is a string or undefined
function validatePatchBody(body: string | undefined): boolean {
  if (!body) return true
  try {
    const parsed = JSON.parse(body)  // <-- if body is e.g. a number, this succeeds! JSON.parse(42) = 42
    // ...
  } catch {
    return false
  }
}
```

**Issue:** While TypeScript declares `body?: string` in the interface, at runtime the renderer could send `body: 123` or `body: true` or `body: {}`. JavaScript's `JSON.parse(123)` succeeds and returns `123`, which is then type-coerced to a string in network operations. The `validatePatchBody` check would then reject it, but this is defensive coding that masks the real problem: **the handler should explicitly validate that the body is a string before use.**

**Impact:**  
1. **Type confusion:** Renderer can bypass the type contract by sending non-string bodies.
2. **Silent failures:** `JSON.parse(123)` doesn't error; it succeeds. The validation function catches this case, but only because it checks `Object.keys(parsed)` on a number (which returns `[]`).
3. **Fragility:** Future code changes in `githubFetch` or the validation function might not handle non-string inputs gracefully.

**Recommendation:**  
Add explicit runtime type validation in the handler:

```typescript
safeHandle('github:fetch', async (_e, path: string, init?: GitHubFetchInit) => {
  const token = getGitHubToken()
  if (!token) { /* ... */ }

  // Validate body type immediately
  if (init?.body !== undefined && typeof init.body !== 'string') {
    logger.warn(`github:fetch rejected: body must be a string, got ${typeof init.body}`)
    return {
      ok: false,
      status: 0,
      body: { error: 'Invalid request body type' },
      linkNext: null
    }
  }

  // ... rest of handler ...
})
```

**Effort:** S  
**Confidence:** High

---

## F-t2-ipc-trust-3: Missing safeOn Wrapper on Tearoff Window Drag Cancel Handler
**Severity:** Medium  
**Category:** IPC Trust Boundary  
**Location:** `/Users/ryan/projects/BDE/src/main/tearoff-handlers.ts:169-171`

**Evidence:**
The `tearoff:dragCancelFromRenderer` handler is registered with raw `ipcMain.on()` without the `safeOn()` error wrapper:

```typescript
ipcMain.on('tearoff:dragCancelFromRenderer', () => {
  cancelActiveDrag()
})
```

Unlike the other tearoff handlers that use `safeHandle()` (which wraps error logging), this one has no try-catch. If `cancelActiveDrag()` throws an exception, it will crash silently without logging.

**Impact:**  
1. **Silent failures:** Unhandled exceptions in `cancelActiveDrag()` are not logged.
2. **Inconsistent error handling:** Three tearoff channels (`create`, `closeConfirmed`, `startCrossWindowDrag`) use `safeHandle()` with error wrapping; this one doesn't.
3. **Debugging difficulty:** If users experience drag issues, there's no error log to diagnose.

**Recommendation:**  
Replace with `safeOn()`:

```typescript
safeOn('tearoff:dragCancelFromRenderer', () => {
  cancelActiveDrag()
})
```

This requires moving the channel to the IPC type definition as well (see F-t2-ipc-trust-1).

**Effort:** S  
**Confidence:** High

---

## F-t2-ipc-trust-4: Unvalidated windowId in Tearoff returnAll Handler Allows Invalid State Mutations
**Severity:** Medium  
**Category:** IPC Trust Boundary  
**Location:** `/Users/ryan/projects/BDE/src/main/tearoff-handlers.ts:183-205`

**Evidence:**
The `tearoff:returnAll` handler accepts a `windowId` string from the renderer and uses it directly to look up and destroy a window:

```typescript
ipcMain.on('tearoff:returnAll', (_event, payload: { windowId: string; views: string[] }) => {
  const { windowId, views } = payload ?? {}
  const entry = getEntry(windowId)  // <-- Map.get(windowId), no format validation
  if (!entry) {
    logger.warn(`[tearoff] returnAll: unknown windowId ${windowId}`)
    return
  }
  // ... 
  deleteEntry(windowId)  // <-- deletes from tearoffWindows Map
  entry.win.destroy()    // <-- closes the window
})
```

While the handler gracefully handles a nonexistent `windowId` (it logs a warning and returns), there is no validation that `windowId` is in a valid format. A UUIDBv4 (as generated on line 74 of the same file) should match `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`, but the handler accepts any string.

**Impact:**  
1. **No format validation:** Renderer could send `windowId: "'.."` or `windowId: "/etc/passwd"` (though the Map lookup would fail harmlessly).
2. **Incomplete security posture:** If tearoffWindows were keyed by any other mechanism (e.g., window title, process ID), format validation would prevent injection attacks.
3. **Defense-in-depth gap:** The handler should validate that windowId looks like a UUID before attempting lookup, as a regression protection.

**Recommendation:**  
Add windowId format validation:

```typescript
const VALID_WINDOW_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

ipcMain.on('tearoff:returnAll', (_event, payload: { windowId: string; views: string[] }) => {
  const { windowId, views } = payload ?? {}
  
  // Validate windowId format
  if (!windowId || !VALID_WINDOW_ID_PATTERN.test(windowId)) {
    logger.warn(`[tearoff] returnAll: invalid windowId format ${windowId}`)
    return
  }
  
  const entry = getEntry(windowId)
  if (!entry) {
    logger.warn(`[tearoff] returnAll: unknown windowId ${windowId}`)
    return
  }
  // ... rest of handler ...
})
```

Apply the same validation to `tearoff:returnToMain` (line 208).

**Effort:** S  
**Confidence:** Medium

---

## F-t2-ipc-trust-5: Tearoff viewsChanged Handler Mutates State Without Validation
**Severity:** Low  
**Category:** IPC Trust Boundary  
**Location:** `/Users/ryan/projects/BDE/src/main/tearoff-handlers.ts:174-180`

**Evidence:**
The `tearoff:viewsChanged` handler directly assigns `payload.views` to the entry's state without validation:

```typescript
ipcMain.on('tearoff:viewsChanged', (_event, payload: { windowId: string; views: string[] }) => {
  const entry = getEntry(payload.windowId)
  if (entry) {
    entry.views = payload.views  // <-- direct assignment
    persistTearoffStateNow()
  }
})
```

The handler:
1. Does not validate that `entry` is non-null before accessing it (has a guard check, so this is okay).
2. Does not validate the views array (could be empty, contain duplicates, or non-string items).
3. Does not validate that the windowId in the payload matches the windowId in the entry (though the Map lookup prevents this).

**Impact:**  
1. **State corruption risk:** If `payload.views` contains invalid values (e.g., `null`, object, number), the entry's views state is corrupted.
2. **No persistence validation:** The persisted state file could be corrupted if views is invalid.

**Recommendation:**  
Add views validation:

```typescript
safeOn('tearoff:viewsChanged', (_event, payload: { windowId: string; views: string[] }) => {
  // Validate input
  if (!payload?.windowId || !Array.isArray(payload.views)) {
    logger.warn('[tearoff] viewsChanged: invalid payload')
    return
  }
  
  // Validate all views are strings
  if (!payload.views.every(v => typeof v === 'string')) {
    logger.warn('[tearoff] viewsChanged: views must be array of strings')
    return
  }
  
  const entry = getEntry(payload.windowId)
  if (!entry) {
    logger.warn(`[tearoff] viewsChanged: unknown windowId ${payload.windowId}`)
    return
  }
  
  entry.views = payload.views
  persistTearoffStateNow()
})
```

**Effort:** S  
**Confidence:** Medium

---

## Summary

### Critical Findings
- **F-t2-ipc-trust-1:** Four tearoff handlers use untyped raw `ipcMain.on()` without `safeOn()`, missing error instrumentation and type safety.

### High-Impact Findings
- **F-t2-ipc-trust-2:** GitHub API proxy accepts renderer-supplied request body without explicit runtime type validation.
- **F-t2-ipc-trust-3:** One tearoff drag handler missing error wrapper.
- **F-t2-ipc-trust-4:** Tearoff returnAll/returnToMain handlers accept unvalidated windowId strings.

### Medium-Impact Findings
- **F-t2-ipc-trust-5:** Tearoff viewsChanged handler mutates state without validating array contents.

### Positive Findings
- **Strengths:**
  - All 29 handlers in `/src/main/handlers/` correctly use `safeHandle()` for error wrapping and type safety.
  - Sprint task mutation handlers (`sprint:update`, `sprint:delete`) properly filter and validate patches against allowlists.
  - IDE file system handlers implement comprehensive symlink resolution and path traversal prevention.
  - GitHub API handlers enforce strict method/endpoint allowlists.
  - Task ID lookups use prepared statements, preventing SQL injection.
  - Git operations (`execFileAsync`) use non-shell command execution, preventing shell injection.

### Remediation Priority
1. **Immediate:** Move tearoff handlers to IPC type map and replace `ipcMain.on()` with `safeOn()` (F-t2-ipc-trust-1).
2. **High:** Add runtime type validation to github:fetch body parameter (F-t2-ipc-trust-2).
3. **Medium:** Add windowId format validation and views array validation to tearoff handlers (F-t2-ipc-trust-4, F-t2-ipc-trust-5).

---
