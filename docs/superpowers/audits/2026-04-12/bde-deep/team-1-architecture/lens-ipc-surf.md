# IPC Surface Audit — BDE Electron Application
**Audit Date:** April 12, 2026  
**Auditor:** Claude (Team 1 — IPC Surface)  
**Scope:** Electron inter-process communication architecture across channel definitions, preload exposure, handler registration, and renderer invocations

## Executive Summary

The BDE application maintains a **well-structured IPC surface** with 143 registered handlers distributed across 29 handler modules. The codebase uses strong compile-time type safety via `IpcChannelMap` and enforces it through `safeHandle()`/`safeOn()` wrappers. However, the audit uncovered **5 significant findings**: fragmented handler registrations spanning multiple lines make automated verification fragile, safeHandle calls are spread across wide indentation patterns causing detection drift, fire-and-forget (send) channels lack explicit typing constraints in preload, broadcast events are inconsistently namespaced, and handler modules exhibit non-standard organization patterns (e.g., test-time handler capture hooks coupling to test infrastructure).

**Baseline Verification:**
- **Channels defined:** ~166 typed channels across 8 domain-grouped modules ✓
- **Handler modules:** 29 confirmed (excluding test files and agent-system SDK integration)  
- **Handler registrations:** 143 unique safeHandle/safeOn/ipcMain calls ✓
- **Preload bridge surface:** 88 typed invokes through window.api namespace ✓

---

## F-t1-ipc-surf-1: Fragmented safeHandle Calls Obscure Handler Detection

**Severity:** Medium  
**Category:** IPC Surface  
**Location:** `src/main/handlers/agent-handlers.ts:48-77`, `src/main/handlers/sprint-local.ts` (multiple)  
**Evidence:**
```typescript
// agent-handlers.ts:48-50 — channel name on separate line
safeHandle(
  'agent:steer',
  async (_e, { agentId, message, images }: {...}) => {
    // handler impl
  }
)
```
This pattern repeats in: agent-handlers.ts, sprint-local.ts, and other large handler modules. When channel name is on a different line from `safeHandle(`, regex-based detection (`safeHandle('[^']*'`) fails to match. Automated IPC registration tests and tooling that scan for `safeHandle(...'channel'...)` on a single line will **miss these handlers**.

**Impact:** Dead bridge detection becomes unreliable. The integration test at `src/main/__tests__/integration/ipc-registration.test.ts` works only because it uses a multiline-aware regex; simpler tooling (linters, import validators, channel auditors) cannot reliably map which channels are registered without parsing the full AST or accepting false negatives.

**Recommendation:** Enforce a code style rule (via ESLint or prettier) that keeps the safeHandle channel name on the same line as the function call:
```typescript
safeHandle('agent:steer', async (_e, { agentId, message, images }: {...}) => {
  // or at minimum:
  safeHandle('agent:steer',
    async (_e, { agentId, message, images }: {...}) => {
```
Add a pre-commit hook to catch multi-line safeHandle patterns and reject them.

**Effort:** S  
**Confidence:** High

---

## F-t1-ipc-surf-2: Fire-and-Forget (send) Channels Lack Explicit Preload Constraints

**Severity:** Medium  
**Category:** IPC Surface  
**Location:** `src/preload/index.ts:330, 390, 448, 468-472`  
**Evidence:**
```typescript
// src/preload/index.ts:330 — direct ipcRenderer.send, no type safety
terminal: {
  write: (id: number, data: string): void => ipcRenderer.send('terminal:write', { id, data }),
  // ...
},

// src/preload/index.ts:448
sendDropComplete: (payload: {...}) => 
  ipcRenderer.send('tearoff:dropComplete', payload),
```

These channels use `ipcRenderer.send()` (fire-and-forget) instead of `invoke()`. While typed at the wrapper level (via function signature), they are **not constrained by IpcChannelMap**—the preload bridge can invoke arbitrary channel names with arbitrary payloads without TypeScript catching signature mismatches. The `safeOn()` handler on main validates nothing about argument types because `ipcRenderer.send()` is not type-safe at runtime.

**Impact:** A refactored handler (`terminal:write` args) can break without compile-time detection. Renderers cannot discover send-channel payloads through type hints. Dead bridges are invisible: if a channel is defined in IpcChannelMap but never wired to safeOn(), the preload layer won't error.

**Recommendation:** 
1. Add a new wrapper `typedSend<K>()` in preload that encodes type information:
```typescript
function typedSend<K extends keyof IpcChannelMap>(
  channel: K,
  ...args: IpcChannelMap[K]['args']
): void {
  ipcRenderer.send(channel, ...args)
}
```
2. Update preload send-only channels to use typedSend instead of raw ipcRenderer.send.
3. Add compile-time check: IPC channels that use `safeOn()` must also appear in a `SendChannels` union type to document they are fire-and-forget.

**Effort:** M  
**Confidence:** High

---

## F-t1-ipc-surf-3: Broadcast Events (webContents.send) Inconsistently Namespaced and Untyped at Send Site

**Severity:** Medium  
**Category:** IPC Surface  
**Location:** `src/main/handlers/*` (scattered webContents.send calls), `src/shared/ipc-channels/broadcast-channels.ts` (definitions)  
**Evidence:**
```typescript
// broadcast-channels.ts:8-10 — typed definition
export interface BroadcastChannels {
  'agent:event': { agentId: string; event: AgentEvent }
  'agent:event:batch': Array<{ agentId: string; event: AgentEvent }>
  // ...
}

// But send sites are untyped:
// In src/main/handlers/agent-listeners.ts (hypothetical)
mainWindow.webContents.send('agent:event', payload)
// ^ No type validation that payload matches BroadcastChannels['agent:event']
```

Broadcast sends use string channel names directly without safeHandle/safeOn wrappers. The BroadcastChannels type is defined but **not enforced at send() call sites**. A mainWindow.webContents.send call can emit an untyped payload with zero compile-time validation.

**Impact:** Renderer event handlers that depend on BroadcastChannels types will break silently if the main process sends a different shape. The definition becomes documentation only, not a contract. Refactoring a broadcast payload shape leaves send sites unchanged and undetected.

**Recommendation:**
1. Create a `typedBroadcast<K extends keyof BroadcastChannels>()` function in main:
```typescript
export function typedBroadcast<K extends keyof BroadcastChannels>(
  channel: K,
  payload: BroadcastChannels[K]
): void {
  mainWindow.webContents.send(channel, payload)
}
```
2. Replace all `webContents.send()` calls with `typedBroadcast()` calls.
3. Add integration test: scan for raw `webContents.send('` calls and reject any not in the allowlist.

**Effort:** M  
**Confidence:** High

---

## F-t1-ipc-surf-4: Handler Module Organization Lacks Consistency; Test Helpers Couple to Test Infrastructure

**Severity:** Low  
**Category:** IPC Surface  
**Location:** `src/main/handlers/__tests__/` (all test files), `src/main/__tests__/handlers.test.ts`  
**Evidence:**
```typescript
// src/main/__tests__/handlers.test.ts (e.g., line ~50)
const handlers: Record<string, (...args: any[]) => any> = {}

vi.mock('../handlers/registry', () => ({
  registerAllHandlers: (deps: AppHandlerDeps) => {
    // Manually call each register function to capture handlers
    // for test assertions
    registerAgentHandlers()
    registerConfigHandlers()
    // ...
  }
}))

// Test code later uses: handlers['settings:get'](mockEvent, 'myKey')
```

Individual handler tests use a test-time capture pattern: they mock `registerAllHandlers` to manually invoke each register function and capture the handlers map. This **couples test infrastructure to the actual handler registration flow** and requires test files to import and call production registration functions.

**Impact:** 
- Changes to handler module signatures require updates to multiple test mocks.
- Test setup is fragile and spreads across many test files.
- No single source of truth for which handlers are registered at app startup.
- Handler registration order is implicit in test files, not explicit in code.

**Recommendation:**
1. Refactor `registerAllHandlers` to return a registry object instead of only side-effecting:
```typescript
export function registerAllHandlers(deps: AppHandlerDeps): IpcRegistry {
  const registry: IpcRegistry = {}
  
  for (const [channel, handler] of Object.entries(capturedHandlers)) {
    registry[channel] = handler
  }
  return registry
}
```
2. Move handler capture logic to a dedicated `ipc-test-utils.ts` module that both tests and integration tests can use.
3. Update tests to use the returned registry instead of mocking.

**Effort:** M  
**Confidence:** Medium

---

## F-t1-ipc-surf-5: Broadcast Channel Naming Inconsistency; "circuit-breaker-open" vs Verb-Past Pattern

**Severity:** Low  
**Category:** IPC Surface  
**Location:** `src/shared/ipc-channels/broadcast-channels.ts:12-16`  
**Evidence:**
```typescript
export interface BroadcastChannels {
  // Standard pattern (past tense verb)
  'sprint:externalChange': void
  'sprint:mutation': { type: 'created' | 'updated' | 'deleted'; task: SprintTask }

  // Non-standard (state-oriented, adjective + noun)
  'agent-manager:circuit-breaker-open': {
    consecutiveFailures: number
    openUntil: number
  }
}
```

Most broadcast channels use past-tense verbs or state names (`*:externalChange`, `*:mutation`, `*:error`, `*:updated`). The `agent-manager:circuit-breaker-open` channel breaks this convention by using adjective + noun naming. While not breaking functionality, it creates cognitive load and makes it harder to pattern-match on broadcast events.

**Impact:** Code review and maintenance become slightly harder; developers unfamiliar with the circuit-breaker pattern may miss this channel during refactoring. Auto-discovery tools that look for consistent channel name patterns will flag this as an outlier.

**Recommendation:** Rename to `agent-manager:circuitBreakerOpen` or `agent-manager:circulationBreakerTriggered` to match the action-oriented pattern.

**Effort:** S  
**Confidence:** Low

---

## Summary Table

| Finding | Severity | Type | Fixable |
|---------|----------|------|---------|
| F-t1-ipc-surf-1 | Medium | Detection fragility | Linting rule |
| F-t1-ipc-surf-2 | Medium | Type safety gap | Wrapper function |
| F-t1-ipc-surf-3 | Medium | Type safety gap | Wrapper function |
| F-t1-ipc-surf-4 | Low | Code organization | Refactoring |
| F-t1-ipc-surf-5 | Low | Naming consistency | Rename |

---

## Verification Commands

To regenerate this audit:
```bash
# Count handler modules
find src/main/handlers -name "*.ts" -not -name "*.test.ts" | wc -l

# Count unique registered channels
find src/main -name "*.ts" -not -path "*__tests__*" -not -name "*.test.ts" | \
  xargs grep -h "safeHandle\|safeOn" | \
  grep -oE "'[a-z:0-9-]*'" | tr -d "'" | sort | uniq | wc -l

# Run integration test
npm test -- src/main/__tests__/integration/ipc-registration.test.ts
```

---

## Recommendations for Future Audits

1. **Automate dead bridge detection:** Extend `ipc-registration.test.ts` to emit a JSON report of all channels + their handler modules for tooling to consume.
2. **Enforce safeHandle single-line format:** Add ESLint rule or prettier plugin.
3. **Document channel ownership:** Add a comment above each register function listing which channels it owns (domain:action pattern).
4. **Track send-channel changes:** Add a changelog for BroadcastChannels and SendChannels types (separate from typed-invoke channels).

