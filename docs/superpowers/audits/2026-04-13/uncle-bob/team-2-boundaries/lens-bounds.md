# Clean Architecture Boundary Audit — Team 2 (Electron IPC Surface)

**Date:** 2026-04-13  
**Scope:** IPC surface discipline, handler responsibility, data shape leakage, context isolation  
**Repository:** BDE  
**Files Examined:**
- `src/preload/index.ts` (557 lines)
- `src/shared/ipc-channels/` (8 files, 1160 LOC total, 176 channels)
- `src/main/handlers/` (registry + 6 sample handlers examined)
- `src/renderer/src/stores/` (sprintTasks.ts, agentEvents.ts)
- `src/main/index.ts` (handler registration)

---

## F-t2-bounds-1: Dashboard Event Data Shape Leakage — Raw DB Column Names

**Severity:** High  
**Category:** Boundary Integrity  
**Location:** `src/shared/ipc-channels/ui-channels.ts:52-59`

**Evidence:**
```typescript
export interface DashboardEvent {
  id: number
  agent_id: string          // ← snake_case (DB column name)
  event_type: string        // ← snake_case (DB column name)
  payload: string           // ← raw JSON string (storage format)
  timestamp: number
  task_title: string | null
}
```

**Impact:**  
The preload bridge exposes raw database column naming conventions (snake_case) directly to the renderer. This violates the **Screaming Architecture** principle — the API surface should scream the domain, not the schema. The renderer now knows about `agent_id` (DB concept) rather than a domain term like `agentId`. The `payload` field is a serialized JSON string, exposing the internal choice to store events as JSON text rather than structured fields.

**Recommendation:**  
Transform `DashboardEvent` into a domain-aligned shape in the handler layer:

```typescript
// src/shared/ipc-channels/ui-channels.ts
export interface DashboardEvent {
  id: number
  agentId: string           // camelCase domain term
  eventType: string         // camelCase domain term
  parsedPayload: Record<string, unknown>  // parsed (not raw string)
  timestamp: number
  taskTitle: string | null
}

// src/main/data/dashboard-queries.ts — at the boundary
function transformDbEvent(row: RawDashboardEventRow): DashboardEvent {
  return {
    id: row.id,
    agentId: row.agent_id,
    eventType: row.event_type,
    parsedPayload: JSON.parse(row.payload),
    timestamp: row.timestamp,
    taskTitle: row.task_title
  }
}
```

**Effort:** S  
**Confidence:** High  

---

## F-t2-bounds-2: Presentation Logic in IPC Handler — `mapQualityResult()` 

**Severity:** Medium  
**Category:** Handler Responsibility Leakage  
**Location:** `src/main/handlers/workbench.ts:24-79`

**Evidence:**
```typescript
function mapQualityResult(result: SpecQualityResult): {
  clarity: CheckField
  scope: CheckField
  filesExist: CheckField
} {
  // --- 45 lines of business rule logic ---
  const SCOPE_CODES = new Set(['TOO_MANY_FILES', 'TOO_MANY_STEPS', 'SPEC_TOO_LONG'] as const)
  const FILES_CODES = new Set(['FILES_SECTION_NO_PATHS'] as const)
  
  const scopeIssues = result.issues.filter(i => SCOPE_CODES.has(i.code as 'TOO_MANY_FILES'))
  const filesIssues = result.issues.filter(i => FILES_CODES.has(i.code as 'FILES_SECTION_NO_PATHS'))
  const clarityIssues = result.issues.filter(
    i => !SCOPE_CODES.has(i.code as 'TOO_MANY_FILES') && !FILES_CODES.has(i.code as 'FILES_SECTION_NO_PATHS')
  )
  
  const clarityErrors = clarityIssues.filter(i => i.severity === 'error')
  const clarityWarnings = clarityIssues.filter(i => i.severity === 'warning')
  
  let clarity: CheckField
  if (clarityErrors.length > 0) {
    const messages = clarityErrors.map(i => i.message).join('; ')
    clarity = { status: 'fail', message: messages }
  }
  // ... (repeats for scope, filesExist)
}
```

**Impact:**  
This function lives in an IPC **handler**, which should be a thin orchestration layer that invokes business services. Instead, it contains:
1. **Presentation transformation logic** — mapping severity + code combinations to UI "pass/warn/fail" states
2. **Semantic rule grouping** — defining which codes map to which UI concerns (scope vs clarity vs files)
3. **String assembly** — joining error messages for display

This logic should live in a domain service so it can be:
- Unit tested independently
- Reused by CLI, agent, or other surfaces
- Reasoned about without understanding IPC plumbing

**Recommendation:**  
Extract to a new service:

```typescript
// src/main/services/spec-quality-transformer.ts
export interface DisplayedCheck {
  clarity: CheckField
  scope: CheckField
  filesExist: CheckField
}

export function transformQualityResultForDisplay(result: SpecQualityResult): DisplayedCheck {
  // Move all the grouping/mapping logic here
  // Returns domain-neutral shape
}

// src/main/handlers/workbench.ts — handler becomes 2 lines
safeHandle('workbench:checkSpec', async (_e, input) => {
  const qualityResult = specQualityService.check(input)
  return transformQualityResultForDisplay(qualityResult)  // ← service owns transformation
})
```

**Effort:** M  
**Confidence:** High  

---

## F-t2-bounds-3: Payload Field as Raw JSON String — Storage Leakage

**Severity:** Medium  
**Category:** Data Shape Leakage  
**Location:** `src/main/data/dashboard-queries.ts:19-28` (and IPC channel definition)

**Evidence:**
```typescript
export function getRecentEvents(limit: number = 20): {
  id: number
  agent_id: string
  event_type: string
  payload: string  // ← renderer gets raw JSON string
  timestamp: number
  task_title: string | null
}[] {
  return _getRecentEvents(getDb(), limit)
}

// Used by IPC handler
safeHandle('agent:recentEvents', async (_e: unknown, limit?: number) => {
  return getRecentEvents(limit)  // ← returns payload as string
})
```

**Impact:**  
The renderer receives `payload` as a **raw JSON string**. This means:
- Renderer must `JSON.parse()` it (storing the parsing logic in presentation tier)
- Schema changes to the event payload break the renderer in silent, hard-to-debug ways
- The IPC contract doesn't define the shape of `payload` — it's implicit and undocumented

If the main process changes event structure (e.g., from `{ code: '...' }` to `{ errorCode: '...', details: [...] }`), the renderer silently gets malformed data.

**Recommendation:**  
Parse at the boundary, not in the renderer:

```typescript
// src/shared/ipc-channels/ui-channels.ts
export interface DashboardEvent {
  id: number
  agentId: string
  eventType: string
  payload: Record<string, unknown>  // ← always parsed
  timestamp: number
  taskTitle: string | null
}

// src/main/data/dashboard-queries.ts
export function getRecentEvents(limit: number = 20): DashboardEvent[] {
  const rows = _getRecentEvents(getDb(), limit)
  return rows.map(row => ({
    id: row.id,
    agentId: row.agent_id,
    eventType: row.event_type,
    payload: JSON.parse(row.payload),  // ← parse at boundary
    timestamp: row.timestamp,
    taskTitle: row.task_title
  }))
}
```

**Effort:** S  
**Confidence:** High  

---

## F-t2-bounds-4: Preload Surface Too Large — 176 Channels, 557 Lines

**Severity:** Medium  
**Category:** Boundary Integrity  
**Location:** `src/preload/index.ts` (entire file) and `src/shared/ipc-channels/` (all 8 files)

**Evidence:**
```
Total IPC channels:     176
Total handlers:         143
Preload LOC:            557
IPC channel LOC:        1160

Channel breakdown by domain:
- Sprint channels:      ~40
- Agent channels:       ~20
- Git channels:         ~12
- Settings channels:    ~15
- Review channels:      ~20
- System channels:      ~15
- UI/Tearoff channels:  ~14
- FS/Memory channels:   ~15
```

**Impact:**  
A preload surface with 176 channels is difficult to reason about and audit. The boundary is no longer "minimal and typed" — it's sprawling. Large surfaces are harder to:
- Secure (more attack surface)
- Test (combinatorial explosion)
- Document (unclear what's core vs convenient)
- Change (every handler is a dependency that renderers may rely on)

The app exposes almost **every operation** the renderer might want directly as an IPC call, which suggests the preload is more of a "pass-through proxy" than a carefully curated interface.

**Recommendation:**  
Analyze call patterns to identify which channels are actually used vs. which are "just in case". Consider:

1. **Group by feature** instead of by domain:
   ```typescript
   // Instead of:
   api.sprint.list()
   api.sprint.create()
   api.sprint.update()
   
   // Compose into fewer, richer operations:
   api.sprintBoard.loadBoard()  // ← returns everything needed for board UI
   api.sprintBoard.updateCard(cardId, patch)
   ```

2. **Defer low-value operations** to the renderer (e.g., local UI state filtering):
   ```typescript
   // Remove: api.sprint.getSuccessRateBySpecType()
   // Reason: Renderer can filter api.sprint.list() locally
   ```

3. **Audit for test doubles**: Some channels (e.g., `sprint:healthCheck`) may exist only for testing. Move to a test-only preload.

**Effort:** L  
**Confidence:** Medium  
**Priority:** Lower (working system, but architectural smell)

---

## F-t2-bounds-5: Context Isolation Correctly Configured

**Severity:** N/A  
**Category:** Context Isolation (✓ PASS)  
**Location:** `src/main/tearoff-manager.ts:23-26`

**Evidence:**
```typescript
export const SHARED_WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false,
  contextIsolation: true  // ✓ Enabled
}
```

**Impact:**  
Context isolation is correctly enabled. The preload runs in its own context and cannot directly access `window.require()` or other Node APIs. Data flows through the bridge only.

**Note:** `sandbox: false` is a separate concern (allows native modules). This is reasonable for Electron apps using native dependencies (sqlite, etc.).

**Status:** No finding.

---

## F-t2-bounds-6: Type Safety at IPC Boundary — Good Pattern

**Severity:** N/A  
**Category:** Boundary Integrity (✓ PASS)  
**Location:** `src/main/ipc-utils.ts` and `src/preload/index.ts:20-25`

**Evidence:**
```typescript
// Main process
export function safeHandle<K extends keyof IpcChannelMap>(
  channel: K,
  handler: (e: Electron.IpcMainInvokeEvent, ...args: IpcChannelMap[K]['args']) 
    => IpcChannelMap[K]['result'] | Promise<IpcChannelMap[K]['result']>
): void { ... }

// Preload
function typedInvoke<K extends keyof IpcChannelMap>(
  channel: K,
  ...args: IpcChannelMap[K]['args']
): Promise<IpcChannelMap[K]['result']> {
  return ipcRenderer.invoke(channel, ...args)
}
```

**Impact:**  
Both the main process and preload use the same `IpcChannelMap` type to ensure compile-time safety. Typos in channel names, mismatched argument counts, and type mismatches are caught by TypeScript before runtime.

**Status:** No finding. This is well-designed.

---

## F-t2-bounds-7: No HTML/UI Rendering in Main Process

**Severity:** N/A  
**Category:** Presentation Logic (✓ PASS)  
**Location:** `src/main/**/*.ts` (verified via grep)

**Evidence:**
```bash
$ grep -r "innerHTML\|textContent\|createElement\|appendChild" src/main --include="*.ts"
# (no results)
```

**Impact:**  
The main process does not contain any DOM manipulation, string templating, or UI rendering logic. All presentation concerns remain in the renderer.

**Status:** No finding. Boundary is clean.

---

## F-t2-bounds-8: Data Transformation at Queries Layer — Good Pattern

**Severity:** N/A  
**Category:** Data Shape Leakage (✓ PASS — mostly)  
**Location:** `src/main/data/cost-queries.ts:61-79`

**Evidence:**
```typescript
// Internal DB row type (never exposed)
interface AgentRunCostDbRow {
  id: string
  task: string | null
  repo: string | null
  status: string
  // ... (raw DB schema)
}

// Transformation at boundary
function rowToRecord(row: AgentCostRow): AgentCostRecord {
  return {
    id: row.id,
    model: row.model,
    startedAt: row.started_at,  // ← transforms snake_case to camelCase
    finishedAt: row.finished_at,
    costUsd: row.cost_usd,       // ← meaningful domain term
    tokensIn: row.tokens_in,
    // ... camelCase, domain-aligned
  }
}

export function getAgentHistory(db: Database.Database, limit = 100, offset = 0): AgentCostRecord[] {
  const rows = db.prepare(GET_AGENT_HISTORY_SQL).all(limit, offset) as AgentCostRow[]
  return rows.map(rowToRecord)  // ← transforms every row
}
```

**Impact:**  
The cost queries correctly transform raw database rows into domain-aligned shapes before they cross the IPC boundary. The renderer never sees `cost_usd` or `tokens_in` — it sees `costUsd` and `tokensIn`.

**Status:** No finding. This is the pattern to follow for other queries.

---

## Summary

| Finding | Severity | Root Cause | Effort to Fix |
|---------|----------|-----------|---------------|
| F-t2-bounds-1 | High | DashboardEvent uses raw DB column names | S |
| F-t2-bounds-2 | Medium | Presentation logic in handler | M |
| F-t2-bounds-3 | Medium | payload field not parsed at boundary | S |
| F-t2-bounds-4 | Medium | Preload surface too large (176 channels) | L |

**Boundary Integrity Score:** 7/10

The IPC boundary is **correctly isolated** (contextIsolation: true) and **type-safe** (compile-time checks via IpcChannelMap). However, data shape discipline is inconsistent: cost queries do proper transformation, but dashboard queries don't. Handler responsibilities are mostly clean except for presentation logic in the workbench handler. The preload surface is large and could benefit from consolidation.

**Immediate Action:** Fix F-t2-bounds-1 and F-t2-bounds-3 (data shape leakage) — these are low effort and improve architectural clarity.

**Follow-up:** Extract presentation logic from handlers (F-t2-bounds-2) and conduct a surface audit to right-size the preload (F-t2-bounds-4).
