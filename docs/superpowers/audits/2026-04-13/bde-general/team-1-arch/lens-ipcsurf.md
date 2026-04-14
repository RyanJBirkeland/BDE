# IPC Surface Audit: 2026-04-13

## Executive Summary

The IPC surface exhibits systematic **type definition gaps** that compromise compile-time safety. Two critical patterns emerge:

1. **Broadcast channels (one-way main→renderer sends) are underrepresented** in `broadcast-channels.ts`, forcing preload listeners to operate without type safety for tearoff, watch errors, and mutation events.

2. **Channel definition duplication** exists for `agent:event`, registered in both `AgentEventChannels` (incorrectly as invoke) and `BroadcastChannels` (correctly as broadcast), creating ambiguity.

3. **Fire-and-forget tearoff handlers** bypass `safeOn()` wrapper, using raw `ipcMain.on()` directly without type coverage. Five send-only channels lack type definitions entirely.

4. **Business logic inline in safeHandle wrappers** is present but generally contained; handler modules properly delegate to services.

All 143 safeHandle registrations are accounted for in the registry, but the **broadcast channel registry is incomplete** (8 channels missing from type definitions).

---

## F-t1-ipcsurf-1: Missing Tearoff Broadcast Channel Definitions
**Severity:** High  
**Category:** IPC Surface  
**Location:** `src/shared/ipc-channels/broadcast-channels.ts:1-81`  
**Evidence:** Eight tearoff channels are sent via `webContents.send()` but not defined:
- `tearoff:confirmClose` (sent at src/main/tearoff-manager.ts:223)
- `tearoff:dragCancel` (sent at src/main/tearoff-manager.ts:337)
- `tearoff:dragDone` (sent at src/main/tearoff-manager.ts:432)
- `tearoff:dragIn` (sent at src/main/tearoff-manager.ts:342)
- `tearoff:dragMove` (sent at src/main/tearoff-manager.ts:350)
- `tearoff:tabRemoved` (sent at src/main/tearoff-manager.ts:517)
- `tearoff:tabReturned` (sent at src/main/tearoff-manager.ts:193)
- `tearoff:crossWindowDrop` (sent at src/main/tearoff-manager.ts:437)

Preload listeners exist (src/preload/index.ts:391-460) but receive untyped payloads.  
**Impact:** Renderer cannot use `BroadcastChannels['tearoff:*']` to type its event handlers. Payload shape is undocumented, increasing brittleness when refactoring tearoff event structure.  
**Recommendation:** Add all eight tearoff channels to `BroadcastChannels` interface with exact payload shapes:
```typescript
'tearoff:dragIn': { viewKey: string; localX: number; localY: number }
'tearoff:dragMove': { localX: number; localY: number }
'tearoff:dragCancel': void
'tearoff:dragDone': void
'tearoff:confirmClose': { windowId: string }
'tearoff:crossWindowDrop': { view: string; targetPanelId: string; zone: string }
'tearoff:tabRemoved': { sourcePanelId: string; sourceTabIndex: number }
'tearoff:tabReturned': { windowId: string; view: string }
```
**Effort:** S  
**Confidence:** High

---

## F-t1-ipcsurf-2: Agent:Event Dual Registration (Type Confusion)
**Severity:** High  
**Category:** IPC Surface  
**Location:** `src/shared/ipc-channels/agent-channels.ts:73-77` + `src/shared/ipc-channels/broadcast-channels.ts:9`  
**Evidence:**
```typescript
// In agent-channels.ts (WRONG — defines as invoke)
export interface AgentEventChannels {
  'agent:event': {
    args: [payload: { agentId: string; event: AgentEvent }]
    result: void
  }
}

// In broadcast-channels.ts (CORRECT — defines as broadcast)
export interface BroadcastChannels {
  'agent:event': { agentId: string; event: AgentEvent }
}
```

Actual usage is broadcast-only (main calls `broadcast('agent:event', {...})` at src/main/agent-manager/run-agent.ts:130), never invoked.  
**Impact:** Type checker sees `agent:event` as an invoke channel (with args/result), yet code only uses it as broadcast. This creates silent inconsistency. The AgentEventChannels version is never registered via safeHandle.  
**Recommendation:** Remove `'agent:event'` from `AgentEventChannels` interface entirely. Keep only the `BroadcastChannels` definition. Verify no handler calls `safeHandle('agent:event', ...)`.  
**Effort:** S  
**Confidence:** High

---

## F-t1-ipcsurf-3: Untyped Fire-and-Forget Tearoff Handlers
**Severity:** High  
**Category:** IPC Surface  
**Location:** `src/main/tearoff-manager.ts:567-626`  
**Evidence:** Five send-only tearoff channels registered via raw `ipcMain.on()` instead of `safeOn()`:
- `tearoff:dropComplete` (line 567-572)
- `tearoff:dragCancelFromRenderer` (line 575-577)
- `tearoff:viewsChanged` (line 580-586)
- `tearoff:returnAll` (line 589-611)
- `tearoff:returnToMain` (line 614-625)

All five channels are called from preload via `ipcRenderer.send()` (src/preload/index.ts) but **are NOT in the IpcChannelMap type definition** at all. Main process handlers receive untyped payloads.  
**Impact:** When refactoring tearoff drag payload shape, there is no compile-time check to ensure preload/main payloads match. Payload destructuring is unguarded.  
**Recommendation:** Add these five channels to an appropriate IPC channel interface (likely new `TearoffHandlerChannels` in system-channels.ts or extend `TearoffChannels`):
```typescript
export interface TearoffHandlerChannels {
  'tearoff:dropComplete': { view: string; targetPanelId: string; zone: string }
  'tearoff:dragCancelFromRenderer': void
  'tearoff:viewsChanged': { windowId: string; views: string[] }
  'tearoff:returnAll': { windowId: string; views: string[] }
  'tearoff:returnToMain': { windowId: string }
}
```
Then replace raw `ipcMain.on()` with `safeOn()` calls.  
**Effort:** M  
**Confidence:** High

---

## F-t1-ipcsurf-4: Missing fs:watchError Broadcast Channel
**Severity:** Medium  
**Category:** IPC Surface  
**Location:** `src/main/handlers/ide-fs-handlers.ts:256` + `src/shared/ipc-channels/broadcast-channels.ts`  
**Evidence:** IDE file system handler sends `fs:watchError` without type definition:
```typescript
// src/main/handlers/ide-fs-handlers.ts:256
win.webContents.send('fs:watchError', err.message)
```

Channel not in `BroadcastChannels` interface. Preload has no typed listener for it.  
**Impact:** Error payloads are untyped strings with no structure documentation. Renderer code listening for `fs:watchError` (if any) has no TypeScript guidance.  
**Recommendation:** Add to `BroadcastChannels`:
```typescript
'fs:watchError': string
```
**Effort:** S  
**Confidence:** Medium

---

## F-t1-ipcsurf-5: Broadcast Channel Map Composite Missing Broadcast-Only Channels
**Severity:** Medium  
**Category:** IPC Surface  
**Location:** `src/shared/ipc-channels/index.ts:73-99` (IpcChannelMap composite)  
**Evidence:** The `IpcChannelMap` is used for type-safe `safeHandle()` and `typedInvoke()`, but **broadcast-only channels do not belong in it**. However, `BroadcastChannels` is exported separately for preload listeners. Some broadcast channels appear in both (e.g., `agent:event`, `sprint:mutation`) creating ambiguity about whether they're invoke or broadcast.  
**Impact:** Preload code distinguishes between `IpcChannelMap` (invoke) and `BroadcastChannels` (listen), but the separation is not enforced. Missing broadcast channels force preload to use untyped `ipcRenderer.on()`.  
**Recommendation:** Audit and clearly separate:
1. **Invoke channels** (request-response): Only in `IpcChannelMap` (derive from domain channel interfaces)
2. **Broadcast channels** (one-way push): Only in `BroadcastChannels`
Add a compile-time check or doc comment stating: "No channel should appear in both IpcChannelMap and BroadcastChannels."  
**Effort:** M  
**Confidence:** Medium

---

## F-t1-ipcsurf-6: Handler Registration Complete but Broadcast Registration Unverified
**Severity:** Low  
**Category:** IPC Surface  
**Location:** `src/main/handlers/registry.ts:51-104`  
**Evidence:** Registry function `registerAllHandlers()` calls 26 handler registration functions, each wrapping channels via `safeHandle()`. All 143 safeHandle registrations are accounted for. However, **broadcast sends are not centralized** — they're scattered across service modules (broadcast.ts, agent-manager/, handlers/) with no registry.  
**Impact:** No single place to audit which broadcast channels are active. Adding a new broadcast channel requires grepping the codebase.  
**Recommendation:** Consider creating a `registerBroadcastChannels()` audit function (non-functional) that documents all broadcast sends in one place for visibility.  
**Effort:** L  
**Confidence:** Low

---

## F-t1-ipcsurf-7: safeHandle Coverage Consistent But safeOn Coverage Minimal
**Severity:** Low  
**Category:** IPC Surface  
**Location:** `src/main/handlers/` (all modules) + `src/main/tearoff-manager.ts`  
**Evidence:** All 143 safeHandle registrations use the typed wrapper. However, only 2 modules use `safeOn()` (terminal-handlers.ts, window-handlers.ts for 2 channels: 'terminal:write', 'window:setTitle'). Tearoff manager uses raw `ipcMain.on()` for 5 channels.  
**Impact:** Asymmetry in type safety. Some send-only channels are protected, others are not. Developer intent unclear.  
**Recommendation:** Document when `safeOn()` vs raw `ipcMain.on()` is appropriate. Add `safeOn()` support to more send-only handler patterns in tearoff-manager.ts.  
**Effort:** M  
**Confidence:** Low

---

## Summary Table

| Finding | Issue | Type | Effort |
|---------|-------|------|--------|
| F-t1-ipcsurf-1 | Tearoff broadcast channels untyped | Missing Type Def | S |
| F-t1-ipcsurf-2 | agent:event dual registration | Type Confusion | S |
| F-t1-ipcsurf-3 | Untyped tearoff handlers (5 channels) | No safeOn | M |
| F-t1-ipcsurf-4 | fs:watchError missing type | Missing Type Def | S |
| F-t1-ipcsurf-5 | Broadcast/invoke separation unclear | Architecture | M |
| F-t1-ipcsurf-6 | Broadcast sends scattered | Discoverability | L |
| F-t1-ipcsurf-7 | Inconsistent safeOn usage | Coverage | M |

**Total actionable findings: 7**  
**Critical (High severity): 3** — F-t1-ipcsurf-1, F-t1-ipcsurf-2, F-t1-ipcsurf-3  
**Estimated total effort to resolve: 2-3 days** (mostly type definitions + handler refactoring)
