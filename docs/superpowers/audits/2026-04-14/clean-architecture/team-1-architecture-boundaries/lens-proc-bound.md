# Process Boundary Audit (2026-04-14)

## Overall Health Summary

The application demonstrates **strong process boundary discipline**. The preload surface is well-designed with minimal bloat, handlers are properly registered via a centralized registry pattern, and the IPC channel map is comprehensive and type-safe. However, there are subtle opportunities to tighten the surface and eliminate edge cases where renderer-facing APIs expose more surface area than strictly necessary.

Key strengths:
- Robust `safeHandle()` / `safeOn()` pattern with full type safety
- Solid `onBroadcast<T>()` factory pattern for main→renderer push events
- Comprehensive IPC channel map (~138 channels) with consistent naming conventions
- No direct Node.js API calls detected in renderer code
- Centralized handler registration (registry.ts) reduces coupling

Areas for tightening:
- Preload exposes some wrapper functions that add minimal abstraction value
- Minor inconsistency in tearoff API payload shapes in preload vs channel definitions
- Dashboard analytics channels live under agent namespace instead of dashboard
- A few broadcast channels with ambiguous payload types

---

## F-t1-proc-bound-1: Preload Wrapper Bloat in `api-settings` and `api-git`

**Severity:** Low  
**Category:** Process Boundary  
**Location:** `/Users/ryan/projects/BDE/src/preload/api-settings.ts:1-20`, `/Users/ryan/projects/BDE/src/preload/api-git.ts:1-53`

**Evidence:**

Pure pass-through wrappers that add no value beyond the underlying `typedInvoke()` call:

```typescript
// api-settings.ts
export const settings = {
  get: (key: string) => typedInvoke('settings:get', key),
  set: (key: string, value: string) => typedInvoke('settings:set', key, value),
  // ... 7 more similar pass-throughs
}

// api-git.ts (12 similar patterns)
export const gitStatus = (cwd: string): Promise<...> =>
  typedInvoke('git:status', cwd)
```

**Impact:** 
- Increases preload surface area needlessly (23 additional function closures)
- Makes the preload module harder to audit
- If a channel signature changes, the wrapper must be updated too
- Inconsistent patterns across the API surface

**Recommendation:**
Export `typedInvoke` directly to renderer or consolidate these wrappers into their handlers, removing the preload layer. If wrappers remain, document why they add value (parameter normalization, retry logic, validation).

**Effort:** M  
**Confidence:** Medium

---

## F-t1-proc-bound-2: Tearoff Broadcast Payload Shape Mismatch

**Severity:** Medium  
**Category:** Process Boundary  
**Location:** `/Users/ryan/projects/BDE/src/preload/api-utilities.ts:193-213`, `/Users/ryan/projects/BDE/src/shared/ipc-channels/broadcast-channels.ts:82-89`

**Evidence:**

Preload defines callback types with mismatched payload shapes:

```typescript
// api-utilities.ts (preload)
onTabRemoved: onBroadcast<{ sourcePanelId: string; sourceTabIndex: number }>(
  'tearoff:tabRemoved'
),
onDragIn: onBroadcast<{ viewKey: string; localX: number; localY: number }>(
  'tearoff:dragIn'
),
```

But broadcast-channels.ts defines:

```typescript
// broadcast-channels.ts
'tearoff:tabRemoved': { windowId: string; view: string; newWindow?: boolean }
'tearoff:dragIn': { viewKey: string; x: number; y: number }
```

The preload wrapper types do not match the actual broadcast payload shapes. This creates silent runtime type mismatches.

**Impact:**
- Type mismatch between preload and broadcast channels causes runtime errors
- Renderer code receives wrong payload shapes and crashes
- Makes the type system unreliable for critical UI flows

**Recommendation:**
Align tearoff payload shapes across broadcast-channels.ts and api-utilities.ts. Use broadcast-channels.ts as the source of truth for what main actually sends, and update preload callbacks to match exactly.

**Effort:** M  
**Confidence:** High

---

## F-t1-proc-bound-3: Dashboard Channels Namespace Violation

**Severity:** Low  
**Category:** Process Boundary  
**Location:** `/Users/ryan/projects/BDE/src/shared/ipc-channels/ui-channels.ts:88-92`, `/Users/ryan/projects/BDE/src/shared/ipc-channels/index.ts:64-66`

**Evidence:**

Channels are defined as `dashboard:*` but the naming convention documentation at index.ts admits they "use the `agent:` prefix instead of `dashboard:`":

```typescript
// ui-channels.ts
export interface DashboardChannels {
  'dashboard:completionsPerHour': { args: []; result: CompletionBucket[] }
  'dashboard:recentEvents': { args: [limit?: number]; result: DashboardEvent[] }
  'dashboard:dailySuccessRate': { args: [days?: number]; result: DailySuccessRate[] }
}
```

These are semantically agent analytics, not window management. The naming is inconsistent with both the convention and the comment.

**Impact:**
- Naming inconsistency makes channel discovery confusing
- Future maintainers may expect `agent:completionsPerHour` and miss it
- Comment is stale and misleading

**Recommendation:**
Rename to `agent:` prefix and move DashboardChannels into AgentChannels for semantic correctness, or update the comment to reflect the actual `dashboard:` prefix.

**Effort:** S  
**Confidence:** Medium

---

## F-t1-proc-bound-4: Ambiguous Broadcast Payload Type for `agent:event:batch`

**Severity:** Low  
**Category:** Process Boundary  
**Location:** `/Users/ryan/projects/BDE/src/shared/ipc-channels/broadcast-channels.ts:10`

**Evidence:**

```typescript
'agent:event:batch': Array<{ agentId: string; event: AgentEvent }>
```

This is defined as a bare array type, breaking the pattern used by all other broadcasts which wrap payloads in objects:

```typescript
'agent:event': { agentId: string; event: AgentEvent }
'github:error': { kind: '...'; message: string; status?: number }
```

**Impact:**
- Inconsistent broadcast payload shape across the app
- Harder to reason about what each broadcast sends
- Difficult to add metadata (timestamp, batch ID) in the future

**Recommendation:**
Define as an object type:

```typescript
'agent:event:batch': {
  events: Array<{ agentId: string; event: AgentEvent }>
}
```

Update broadcast calls in main and preload listeners accordingly.

**Effort:** S  
**Confidence:** Medium

---

## F-t1-proc-bound-5: `safeOn()` Handler Type Mismatch for Tearoff One-Way Events

**Severity:** Medium  
**Category:** Process Boundary  
**Location:** `/Users/ryan/projects/BDE/src/preload/api-utilities.ts:192, 204, 210-211`, `/Users/ryan/projects/BDE/src/shared/ipc-channels/ui-channels.ts:35-62`

**Evidence:**

Preload sends one-way events but they're typed as request/reply in IPC channels:

```typescript
// api-utilities.ts (one-way sends)
returnToMain: (windowId: string) => ipcRenderer.send('tearoff:returnToMain', { windowId }),
sendDropComplete: (payload: { ... }) => ipcRenderer.send('tearoff:dropComplete', payload),

// ui-channels.ts (typed as request/reply with result: void)
'tearoff:returnToMain': {
  args: [{ windowId: string }]
  result: void
}
'tearoff:dropComplete': {
  args: [{ view: string; targetPanelId: string; zone: string }]
  result: void
}
```

These should be registered with `safeOn()` in handlers, but the channel type suggests `safeHandle()` (invoke pattern). Type definition does not match usage.

**Impact:**
- Type mismatch between channel definition and actual usage
- Future maintainers may try to `await` results on one-way sends
- Unclear handler registration pattern in registry.ts

**Recommendation:**
Either create separate `TearoffEvents` interface for one-way channels and register with `safeOn()`, or refactor to use `ipcRenderer.invoke()` consistently. Update registry to match.

**Effort:** M  
**Confidence:** High

---

## F-t1-proc-bound-6: `WorkflowTemplate` Type Scope Misplacement

**Severity:** Low  
**Category:** Process Boundary  
**Location:** `/Users/ryan/projects/BDE/src/shared/workflow-types.ts`, `/Users/ryan/projects/BDE/src/shared/ipc-channels/sprint-channels.ts:42-48`

**Evidence:**

`WorkflowTemplate` is defined in shared and used only in one sprint IPC channel:

```typescript
// workflow-types.ts (shared)
export interface WorkflowTemplate {
  name: string
  description: string
  steps: WorkflowStep[]
}

// sprint-channels.ts
'sprint:createWorkflow': {
  args: [template: WorkflowTemplate]
  result: { ... }
}
```

This is a pure input DTO with no cross-process validation logic. If only the handler constructs and validates this type, it shouldn't be in shared.

**Impact:**
- Shared types should represent genuine cross-boundary contracts
- Simple input DTOs add coupling without benefit
- Complicates the shared surface area unnecessarily

**Recommendation:**
Move `WorkflowTemplate` and `WorkflowStep` to the handler file unless renderer code constructs and validates these objects. If kept shared, document why.

**Effort:** S  
**Confidence:** Low (requires understanding renderer usage)

---

## F-t1-proc-bound-7: Inconsistent Return Type for `agent:latestCacheTokens`

**Severity:** Low  
**Category:** Process Boundary  
**Location:** `/Users/ryan/projects/BDE/src/shared/ipc-channels/agent-channels.ts:63-71`

**Evidence:**

```typescript
'agent:latestCacheTokens': {
  args: [runId: string]
  result: {
    cacheTokensRead: number
    cacheTokensCreated: number
    tokensIn: number
    tokensOut: number
  } | null
}
```

This returns `| null` while similar lookup channels either return empty objects or throw errors. No other channels use null-union for "not found" semantics.

**Impact:**
- Renderer code must always check for null even with valid input
- Inconsistent error handling across the IPC boundary
- Silent failures if renderer forgets null check

**Recommendation:**
Either return a default object `{ cacheTokensRead: 0, ... }` or throw an error if the cache token record doesn't exist. Add a comment explaining when null can occur.

**Effort:** S  
**Confidence:** Medium

---

## Summary of Recommendations

| Finding | Priority | Effort | Impact |
|---------|----------|--------|--------|
| F-t1-proc-bound-1: Preload wrapper bloat | Nice-to-have | M | Low |
| F-t1-proc-bound-2: Tearoff payload mismatch | High | M | High |
| F-t1-proc-bound-3: Dashboard namespace | Nice-to-have | S | Low |
| F-t1-proc-bound-4: Agent event batch type | Nice-to-have | S | Low |
| F-t1-proc-bound-5: Tearoff one-way handlers | High | M | High |
| F-t1-proc-bound-6: WorkflowTemplate scope | Nice-to-have | S | Low |
| F-t1-proc-bound-7: Cache tokens null union | Nice-to-have | S | Low |

**Critical Path:**
1. **Fix F-t1-proc-bound-2** (tearoff payload mismatch) — runtime correctness
2. **Audit F-t1-proc-bound-5** (tearoff one-way handlers) — handler registration clarity
3. Establish a preload surface review checklist for future changes

