# Clean Architecture Remediation — Follow-ups

**Date:** 2026-03-20
**Status:** Draft
**Effort:** 0.5-1 day total
**Dependencies:** PR #323 (clean architecture remediation) merged

## Overview

Four follow-up items from the clean architecture remediation reviews. All are small, independent code-level refactors.

---

## F1: Fix Circular Dependency (sprint-spec.ts ↔ sprint-local.ts)

### Problem

`src/main/handlers/sprint-spec.ts:10` imports `updateTask` from `./sprint-local`, while `sprint-local.ts:11` imports `generatePrompt` from `./sprint-spec`. This creates a bidirectional module dependency.

The `updateTask` call in `sprint-spec.ts:138` persists the generated spec as a side effect inside `generatePrompt`:
```typescript
updateTask(taskId, { spec: text, prompt: text })
```

### Solution

Make `generatePrompt` a pure function that returns results without persisting. Move the persistence call to the handler registration in `sprint-local.ts`.

### Changes

**`src/main/handlers/sprint-spec.ts`:**
- Remove `import { updateTask } from './sprint-local'` (line 10)
- Remove the `updateTask(taskId, { spec: text, prompt: text })` call (line 138)
- `generatePrompt` now only returns `{ taskId, spec, prompt }` — no side effects

**`src/main/handlers/sprint-local.ts`:**
- Update the `sprint:generatePrompt` handler to persist after calling `generatePrompt`:
```typescript
safeHandle('sprint:generatePrompt', async (_e, args) => {
  const result = await generatePrompt(args)
  if (result.spec) {
    updateTask(args.taskId, { spec: result.spec, prompt: result.prompt })
  }
  return result
})
```

### Verification

- `npm run typecheck` passes
- `npm test` passes
- `grep -n "from.*sprint-local" src/main/handlers/sprint-spec.ts` returns zero results

---

## F2: Further Decompose SprintCenter (500 → ~200 LOC)

### Problem

`SprintCenter.tsx` is still ~500 LOC with 11 inline callback handlers and health check polling logic. The WS6 extraction only moved 4 of 15 callbacks to `useSprintTaskActions`.

### Solution

Two extractions:

**1. Expand `useSprintTaskActions` hook**

Move these remaining inline callbacks from SprintCenter into the existing hook:
- `handleDragEnd` (lines 138-153) — Kanban drag-and-drop with WIP limit check
- `handleReorder` (lines 157-169) — within-column reorder
- `handlePushToSprint` (lines 171-177) — push backlog task to queue
- `handleViewSpec` (lines 179-182) — select task for spec drawer
- `handleSaveSpec` (lines 184-189) — save edited spec
- `handleUpdateTitle` (lines 248-253) — inline title edit
- `handleUpdatePriority` (lines 296-301) — priority change

These all follow the same pattern: call `updateTask` with a patch. They belong with the other task actions.

**2. Create `useHealthCheck` hook**

Extract from SprintCenter:
- `stuckTasks` state (currently `useState<string[]>([])`)
- `runHealthCheck` callback (lines 267-274)
- Initial load effect (line 276)
- Polling interval (line 277)

```typescript
// src/renderer/src/hooks/useHealthCheck.ts (~30 LOC)
export function useHealthCheck() {
  const [stuckTasks, setStuckTasks] = useState<string[]>([])

  const runHealthCheck = useCallback(async () => {
    try {
      const stuck = await window.api.sprint.healthCheck()
      setStuckTasks(stuck.map((t) => t.id))
    } catch { /* silent */ }
  }, [])

  useEffect(() => { runHealthCheck() }, [runHealthCheck])
  useVisibilityAwareInterval(runHealthCheck, POLL_HEALTH_CHECK_MS)

  return { stuckTasks }
}
```

**SprintCenter after extraction:** Layout shell (~200-250 LOC) with drawer state, derived filtering/partitioning, and JSX rendering. All mutation logic lives in hooks.

### Changes

**Modify:** `src/renderer/src/hooks/useSprintTaskActions.ts` — add 7 callbacks
**Create:** `src/renderer/src/hooks/useHealthCheck.ts` — extract health polling
**Modify:** `src/renderer/src/components/sprint/SprintCenter.tsx` — remove extracted code, use hooks

### Verification

- `npm run typecheck` passes
- `npm test` passes
- `wc -l src/renderer/src/components/sprint/SprintCenter.tsx` under 220
- SprintCenter has zero `updateTask` calls (all in hooks)

---

## F3: Missing Data Layer Tests + Event Queries

### Problem

Two data layer modules lack tests, and `event-store.ts` has direct DB queries that bypass the data layer.

**Missing tests:**
- `src/main/data/agent-queries.ts` — 12+ exported functions, zero tests
- `src/main/data/cost-queries.ts` — 2 exported functions, zero tests

**Missing module:**
- `src/main/agents/event-store.ts` calls `getDb().prepare(...)` directly for `appendEvent`, `getHistory`, and `pruneOldEvents`

### Solution

**1. Create `src/main/data/__tests__/agent-queries.test.ts`**

Test with in-memory SQLite:
- `insertAgentRecord` — insert and verify
- `getAgentMeta` — found + not found
- `listAgents` — ordering, status filter
- `updateAgentMeta` — update fields
- `findAgentByPid` — found + not found
- `updateAgentRunCost` — insert cost data
- `rowToMeta` — column mapping

**2. Create `src/main/data/__tests__/cost-queries.test.ts`**

Test with in-memory SQLite:
- `getCostSummary` — with and without data
- `getRecentAgentRunsWithCost` — pagination, ordering

**3. Create `src/main/data/event-queries.ts`**

Extract from `src/main/agents/event-store.ts`:
```typescript
export function appendEvent(db: Database, agentId: string, eventType: string, payload: string, timestamp: number): void {
  db.prepare('INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)').run(agentId, eventType, payload, timestamp)
}

export function getEventHistory(db: Database, agentId: string): { payload: string }[] {
  return db.prepare('SELECT payload FROM agent_events WHERE agent_id = ? ORDER BY timestamp ASC').all(agentId) as { payload: string }[]
}

export function pruneOldEvents(db: Database, agentId: string, keepCount: number): void {
  // Move pruneOldEvents logic from event-store.ts, parameterize with db
}
```

**4. Update `src/main/agents/event-store.ts`**

Delegate to event-queries with `getDb()`:
```typescript
import { appendEvent as _appendEvent, getEventHistory } from '../data/event-queries'
import { getDb } from '../db'

export function appendEvent(agentId: string, event: AgentEvent): void {
  _appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
}

export function getHistory(agentId: string): AgentEvent[] {
  return getEventHistory(getDb(), agentId).map((r) => JSON.parse(r.payload) as AgentEvent)
}
```

### Verification

- `npm run typecheck` passes
- `npm test` passes
- All 4 data layer modules have companion test files
- `grep -n "getDb()" src/main/agents/event-store.ts` calls go through data layer

---

## F4: Fix `as never` Type Escape in sprintEvents

### Problem

`src/renderer/src/stores/sprintEvents.ts:46,50` uses `as never` to cast `AgentEvent` into `TaskOutputEvent` fields:

```typescript
[agentId]: [...(s.taskEvents[agentId] ?? []), event as never],
// ...
[agentId]: event as never,
```

This is a dual-write migration pattern where the agent event stream feeds into legacy task event fields. `AgentEvent` and `TaskOutputEvent` have different shapes.

### Solution

The root issue is that `AgentEvent` and `TaskOutputEvent` are structurally incompatible — `AgentEvent.timestamp` is `number` while `TaskOutputEvent.timestamp` is `string` (ISO 8601), and the type discriminants don't align (`AgentEventType` vs `TaskOutputEventType`).

**Two-part fix:**

**Part 1: Widen the store's event type to accept both**

Instead of forcing `AgentEvent` into `TaskOutputEvent`, accept a union type for the dual-write fields:

```typescript
// In sprintEvents.ts
type AnyTaskEvent = TaskOutputEvent | AgentEvent

interface SprintEventsState {
  taskEvents: Record<string, AnyTaskEvent[]>  // was TaskOutputEvent[]
  latestEvents: Record<string, AnyTaskEvent>  // was TaskOutputEvent
  // ...
}
```

This eliminates both `as never` casts because `AgentEvent` is now a valid member of the union. Components consuming these events already use loose field access patterns (checking `event.type` discriminants), so the wider type is safe.

**Part 2: Update consuming components to narrow the type**

Any component that reads `taskEvents` or `latestEvents` should use type narrowing:

```typescript
function isTaskOutputEvent(e: AnyTaskEvent): e is TaskOutputEvent {
  return typeof e.timestamp === 'string' // TaskOutputEvent uses ISO string
}
```

This is a stepping stone. When the dual-write migration completes and the legacy `TaskOutputEvent` path is removed, the union collapses back to `AgentEvent` only.

**Alternative considered:** A full adapter mapping `AgentEvent` → `TaskOutputEvent` was rejected because the types are too different (timestamp number vs string, mismatched discriminants). The adapter would just move the `as` casts into a function without achieving actual type safety.

Read the actual `TaskOutputEvent` type from `src/shared/queue-api-contract.ts` during implementation to confirm the union approach works.

### Verification

- `npm run typecheck` passes
- `npm test` passes
- `grep -n "as never" src/renderer/src/stores/sprintEvents.ts` returns zero results
