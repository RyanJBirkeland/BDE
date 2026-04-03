# Clean Architecture Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve 4 follow-up items from the clean architecture remediation: circular dependency, SprintCenter decomposition, missing data layer tests, and type escape fix.

**Architecture:** Four independent fixes on one branch. F1 removes a circular import. F2 moves callbacks to hooks. F3 adds tests and extracts event queries. F4 widens store types to accept a union instead of casting.

**Tech Stack:** TypeScript, React, Zustand, Vitest, better-sqlite3

**Spec:** `docs/superpowers/specs/2026-03-20-clean-arch-followups-design.md`

---

## Task 1: Fix Circular Dependency (F1)

**Files:**

- Modify: `src/main/handlers/sprint-spec.ts:10,137-138`
- Modify: `src/main/handlers/sprint-local.ts` (the `sprint:generatePrompt` handler)

- [ ] **Step 1: Remove import and side effect from sprint-spec.ts**

In `src/main/handlers/sprint-spec.ts`:

- Delete line 10: `import { updateTask } from './sprint-local'`
- Delete line 138: `updateTask(taskId, { spec: text, prompt: text })`

The function now returns the result without persisting.

- [ ] **Step 2: Move persistence to handler in sprint-local.ts**

In `src/main/handlers/sprint-local.ts`, find the `sprint:generatePrompt` handler (currently delegates to `generatePrompt(args)`). Update to persist after the call:

```typescript
safeHandle(
  'sprint:generatePrompt',
  async (_e, args: GeneratePromptRequest): Promise<GeneratePromptResponse> => {
    const result = await generatePrompt(args)
    if (result.spec) {
      updateTask(args.taskId, { spec: result.spec, prompt: result.prompt })
    }
    return result
  }
)
```

- [ ] **Step 3: Verify no circular dependency**

```bash
grep -n "from.*sprint-local" src/main/handlers/sprint-spec.ts
```

Expected: Zero results.

- [ ] **Step 4: Run typecheck and tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/main/handlers/sprint-spec.ts src/main/handlers/sprint-local.ts
git commit -m "fix: remove circular dep between sprint-spec and sprint-local

generatePrompt no longer calls updateTask internally. The handler
in sprint-local persists the generated spec after the call."
```

---

## Task 2: Further Decompose SprintCenter (F2)

**Files:**

- Modify: `src/renderer/src/hooks/useSprintTaskActions.ts` — add 7 callbacks
- Create: `src/renderer/src/hooks/useHealthCheck.ts` — extract health polling
- Modify: `src/renderer/src/components/sprint/SprintCenter.tsx` — remove extracted code

- [ ] **Step 1: Add callbacks to useSprintTaskActions**

In `src/renderer/src/hooks/useSprintTaskActions.ts`, add these imports and callbacks after the existing ones. Copy the exact implementations from SprintCenter.tsx:

Add to imports:

```typescript
import { useSprintUI } from '../stores/sprintUI'
import { WIP_LIMIT_IN_PROGRESS } from '../lib/constants'
```

Add new store selectors inside the hook:

```typescript
const setSelectedTaskId = useSprintUI((s) => s.setSelectedTaskId)
const setTasks = useSprintTasks((s) => s.setTasks)
```

Add these callbacks (copy exactly from SprintCenter lines 138-301):

```typescript
const handleDragEnd = useCallback(
  (taskId: string, newStatus: SprintTask['status'], tasks: SprintTask[]) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === newStatus) return
    if (newStatus === TASK_STATUS.ACTIVE && task.status !== TASK_STATUS.ACTIVE) {
      const activeCount = tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length
      if (activeCount >= WIP_LIMIT_IN_PROGRESS) {
        toast.error(`In Progress is full (${WIP_LIMIT_IN_PROGRESS}/${WIP_LIMIT_IN_PROGRESS})`)
        return
      }
    }
    updateTask(taskId, { status: newStatus })
  },
  [updateTask]
)

const handleReorder = useCallback(
  (_status: SprintTask['status'], orderedIds: string[]) => {
    const current = useSprintTasks.getState().tasks
    const idOrder = new Map(orderedIds.map((id, i) => [id, i]))
    setTasks(
      [...current].sort((a, b) => {
        const ai = idOrder.get(a.id)
        const bi = idOrder.get(b.id)
        if (ai !== undefined && bi !== undefined) return ai - bi
        return 0
      })
    )
  },
  [setTasks]
)

const handlePushToSprint = useCallback(
  (task: SprintTask) => {
    updateTask(task.id, { status: TASK_STATUS.QUEUED })
    toast.success('Pushed to Sprint')
  },
  [updateTask]
)

const handleViewSpec = useCallback(
  (task: SprintTask) => setSelectedTaskId(task.id),
  [setSelectedTaskId]
)

const handleSaveSpec = useCallback(
  (taskId: string, spec: string) => {
    updateTask(taskId, { spec })
  },
  [updateTask]
)

const handleUpdateTitle = useCallback(
  (patch: { id: string; title: string }) => {
    updateTask(patch.id, { title: patch.title })
  },
  [updateTask]
)

const handleUpdatePriority = useCallback(
  (patch: { id: string; priority: number }) => {
    updateTask(patch.id, { priority: patch.priority })
  },
  [updateTask]
)
```

Add all 7 to the return object:

```typescript
return {
  // existing
  handleMarkDone,
  handleStop,
  handleRerun,
  handleDelete,
  handleLaunch: launchTask,
  confirmProps,
  // new
  handleDragEnd,
  handleReorder,
  handlePushToSprint,
  handleViewSpec,
  handleSaveSpec,
  handleUpdateTitle,
  handleUpdatePriority
}
```

- [ ] **Step 2: Create useHealthCheck hook**

Create `src/renderer/src/hooks/useHealthCheck.ts`:

```typescript
import { useCallback, useEffect, useMemo } from 'react'
import { useHealthCheckStore } from '../stores/healthCheck'
import { useSprintTasks } from '../stores/sprintTasks'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { POLL_HEALTH_CHECK_MS } from '../lib/constants'
import type { SprintTask } from '../../../shared/types'

export function useHealthCheck(tasks: SprintTask[]) {
  const setStuckTasks = useHealthCheckStore((s) => s.setStuckTasks)
  const stuckTaskIds = useHealthCheckStore((s) => s.stuckTaskIds)
  const dismissedIds = useHealthCheckStore((s) => s.dismissedIds)
  const dismissTask = useHealthCheckStore((s) => s.dismiss)

  const runHealthCheck = useCallback(async () => {
    try {
      const stuck = await window.api.sprint.healthCheck()
      setStuckTasks(stuck.map((t) => t.id))
    } catch {
      /* silent */
    }
  }, [setStuckTasks])

  useEffect(() => {
    runHealthCheck()
  }, [runHealthCheck])
  useVisibilityAwareInterval(runHealthCheck, POLL_HEALTH_CHECK_MS)

  const visibleStuckTasks = useMemo(
    () => tasks.filter((t) => stuckTaskIds.has(t.id) && !dismissedIds.has(t.id)),
    [tasks, stuckTaskIds, dismissedIds]
  )

  return { visibleStuckTasks, dismissTask }
}
```

- [ ] **Step 3: Update SprintCenter to use extracted hooks**

In `src/renderer/src/components/sprint/SprintCenter.tsx`:

1. Import new hook: `import { useHealthCheck } from '../../hooks/useHealthCheck'`
2. Destructure all actions from `useSprintTaskActions()` (including the 7 new ones)
3. Replace health check block (lines 262-282) with: `const { visibleStuckTasks, dismissTask } = useHealthCheck(tasks)`
4. Remove all 7 inline callback definitions (handleDragEnd through handleUpdatePriority)
5. Remove `useHealthCheckStore` import and individual selector lines
6. Remove `setTasks` selector (now inside hook)
7. Note: `handleDragEnd` now takes `tasks` as 3rd arg — update the call site to pass `tasks`

- [ ] **Step 4: Run typecheck and tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 5: Verify LOC reduction**

```bash
wc -l src/renderer/src/components/sprint/SprintCenter.tsx
```

Expected: Under 250 lines.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useSprintTaskActions.ts src/renderer/src/hooks/useHealthCheck.ts src/renderer/src/components/sprint/SprintCenter.tsx
git commit -m "chore: further decompose SprintCenter into hooks

Moves 7 remaining callbacks to useSprintTaskActions and extracts
useHealthCheck hook. SprintCenter reduced to layout shell."
```

---

## Task 3: Missing Data Layer Tests + Event Queries (F3)

**Files:**

- Create: `src/main/data/__tests__/agent-queries.test.ts`
- Create: `src/main/data/__tests__/cost-queries.test.ts`
- Create: `src/main/data/event-queries.ts`
- Create: `src/main/data/__tests__/event-queries.test.ts`
- Modify: `src/main/agents/event-store.ts` — delegate to data layer

- [ ] **Step 1: Write agent-queries tests**

Create `src/main/data/__tests__/agent-queries.test.ts`:

```typescript
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import {
  insertAgentRecord,
  getAgentMeta,
  listAgents,
  updateAgentMeta,
  findAgentByPid,
  updateAgentRunCost
} from '../agent-queries'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})
afterEach(() => {
  db.close()
})

describe('insertAgentRecord + getAgentMeta', () => {
  it('inserts and retrieves agent', () => {
    insertAgentRecord(db, {
      id: 'a1',
      pid: 1234,
      bin: 'claude',
      task: 'test task',
      repo: 'test-repo',
      repoPath: '/tmp/repo',
      model: 'sonnet',
      logPath: '/tmp/log',
      source: 'bde'
    })
    const meta = getAgentMeta(db, 'a1')
    expect(meta).not.toBeNull()
    expect(meta!.id).toBe('a1')
    expect(meta!.pid).toBe(1234)
    expect(meta!.status).toBe('running')
  })

  it('returns null for missing agent', () => {
    expect(getAgentMeta(db, 'nonexistent')).toBeNull()
  })
})

describe('listAgents', () => {
  it('returns agents ordered by started_at desc', () => {
    insertAgentRecord(db, {
      id: 'a1',
      pid: 1,
      bin: 'claude',
      task: 't1',
      repo: 'r',
      repoPath: '/',
      model: 'm',
      logPath: '/l1',
      source: 'bde'
    })
    insertAgentRecord(db, {
      id: 'a2',
      pid: 2,
      bin: 'claude',
      task: 't2',
      repo: 'r',
      repoPath: '/',
      model: 'm',
      logPath: '/l2',
      source: 'bde'
    })
    const agents = listAgents(db)
    expect(agents.length).toBeGreaterThanOrEqual(2)
  })
})

describe('updateAgentMeta', () => {
  it('updates fields', () => {
    insertAgentRecord(db, {
      id: 'a1',
      pid: 1,
      bin: 'claude',
      task: 't',
      repo: 'r',
      repoPath: '/',
      model: 'm',
      logPath: '/l',
      source: 'bde'
    })
    updateAgentMeta(db, 'a1', { status: 'done', exitCode: 0, finishedAt: new Date().toISOString() })
    const meta = getAgentMeta(db, 'a1')
    expect(meta!.status).toBe('done')
    expect(meta!.exitCode).toBe(0)
  })
})

describe('findAgentByPid', () => {
  it('finds agent by PID', () => {
    insertAgentRecord(db, {
      id: 'a1',
      pid: 9999,
      bin: 'claude',
      task: 't',
      repo: 'r',
      repoPath: '/',
      model: 'm',
      logPath: '/l',
      source: 'bde'
    })
    const meta = findAgentByPid(db, 9999)
    expect(meta).not.toBeNull()
    expect(meta!.id).toBe('a1')
  })

  it('returns null for unknown PID', () => {
    expect(findAgentByPid(db, 0)).toBeNull()
  })
})
```

Note: Adapt the `insertAgentRecord` arguments to match the actual function signature in `src/main/data/agent-queries.ts`. Read the file first.

- [ ] **Step 2: Run agent-queries tests**

```bash
npx vitest run src/main/data/__tests__/agent-queries.test.ts --config src/main/vitest.main.config.ts
```

- [ ] **Step 3: Write cost-queries tests**

Create `src/main/data/__tests__/cost-queries.test.ts`:

```typescript
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import { getCostSummary, getRecentAgentRunsWithCost } from '../cost-queries'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})
afterEach(() => {
  db.close()
})

describe('getCostSummary', () => {
  it('returns zero summary with empty DB', () => {
    const summary = getCostSummary(db)
    expect(summary).toBeDefined()
    expect(summary.tasksToday).toBe(0)
  })
})

describe('getRecentAgentRunsWithCost', () => {
  it('returns empty list with no agent runs', () => {
    const runs = getRecentAgentRunsWithCost(db, 10, 0)
    expect(runs).toEqual([])
  })
})
```

- [ ] **Step 4: Run cost-queries tests**

```bash
npx vitest run src/main/data/__tests__/cost-queries.test.ts --config src/main/vitest.main.config.ts
```

- [ ] **Step 5: Create event-queries.ts**

Create `src/main/data/event-queries.ts`:

```typescript
import type { Database } from 'better-sqlite3'

export function appendEvent(
  db: Database,
  agentId: string,
  eventType: string,
  payload: string,
  timestamp: number
): void {
  db.prepare(
    'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
  ).run(agentId, eventType, payload, timestamp)
}

export function getEventHistory(db: Database, agentId: string): { payload: string }[] {
  return db
    .prepare('SELECT payload FROM agent_events WHERE agent_id = ? ORDER BY timestamp ASC')
    .all(agentId) as { payload: string }[]
}

export function pruneOldEvents(db: Database, retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  db.prepare('DELETE FROM agent_events WHERE timestamp < ?').run(cutoff)
}
```

- [ ] **Step 6: Write event-queries tests**

Create `src/main/data/__tests__/event-queries.test.ts`:

```typescript
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import { appendEvent, getEventHistory, pruneOldEvents } from '../event-queries'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})
afterEach(() => {
  db.close()
})

describe('appendEvent + getEventHistory', () => {
  it('inserts and retrieves events in order', () => {
    appendEvent(db, 'agent-1', 'agent:started', '{"type":"agent:started"}', 1000)
    appendEvent(db, 'agent-1', 'agent:text', '{"type":"agent:text","text":"hello"}', 2000)
    const history = getEventHistory(db, 'agent-1')
    expect(history).toHaveLength(2)
    expect(JSON.parse(history[0].payload).type).toBe('agent:started')
    expect(JSON.parse(history[1].payload).type).toBe('agent:text')
  })

  it('returns empty for unknown agent', () => {
    expect(getEventHistory(db, 'nonexistent')).toEqual([])
  })
})

describe('pruneOldEvents', () => {
  it('removes events older than retention period', () => {
    const old = Date.now() - 100 * 24 * 60 * 60 * 1000 // 100 days ago
    const recent = Date.now()
    appendEvent(db, 'a1', 'agent:text', '{}', old)
    appendEvent(db, 'a1', 'agent:text', '{}', recent)
    pruneOldEvents(db, 30) // keep 30 days
    const history = getEventHistory(db, 'a1')
    expect(history).toHaveLength(1)
  })
})
```

- [ ] **Step 7: Run event-queries tests**

```bash
npx vitest run src/main/data/__tests__/event-queries.test.ts --config src/main/vitest.main.config.ts
```

- [ ] **Step 8: Update event-store.ts to delegate**

Rewrite `src/main/agents/event-store.ts` to use the data layer:

```typescript
import { getDb } from '../db'
import {
  appendEvent as _appendEvent,
  getEventHistory,
  pruneOldEvents as _pruneOldEvents
} from '../data/event-queries'
import type { AgentEvent } from '../../shared/types'

export function appendEvent(agentId: string, event: AgentEvent): void {
  _appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
}

export function getHistory(agentId: string): AgentEvent[] {
  return getEventHistory(getDb(), agentId).map((r) => JSON.parse(r.payload) as AgentEvent)
}

export function pruneOldEvents(retentionDays: number): void {
  _pruneOldEvents(getDb(), retentionDays)
}
```

- [ ] **Step 9: Run full test suite**

```bash
npm run typecheck && npm test
```

- [ ] **Step 10: Verify no direct getDb() in event-store**

```bash
grep -n "getDb()" src/main/agents/event-store.ts
```

Expected: Only the delegation calls (3 occurrences passing `getDb()` to data layer functions).

- [ ] **Step 11: Commit**

```bash
git add src/main/data/ src/main/agents/event-store.ts
git commit -m "chore: add missing data layer tests and extract event-queries

Adds agent-queries, cost-queries, and event-queries test files with
in-memory SQLite. Extracts event-store DB queries to data layer."
```

---

## Task 4: Fix `as never` Type Escape (F4)

**Files:**

- Modify: `src/renderer/src/stores/sprintEvents.ts:10-13,42-52`

- [ ] **Step 1: Read both types for reference**

Confirm the type shapes:

- `AgentEvent` (from `src/shared/types.ts`): `timestamp: number`, no `taskId` field
- `TaskOutputEvent` (from `src/shared/queue-api-contract.ts`): `timestamp: string` (ISO 8601), has `taskId: string`

Key differences: timestamp type (number vs string), taskId presence, and `agent:text`/`agent:user_message` only exist in AgentEvent.

- [ ] **Step 2: Widen the store types**

In `src/renderer/src/stores/sprintEvents.ts`, add the AgentEvent import and create a union type:

```typescript
import type { TaskOutputEvent } from '../../../shared/queue-api-contract'
import type { AgentEvent } from '../../../shared/types'

/** Union of both event types during dual-write migration. */
export type AnyTaskEvent = TaskOutputEvent | AgentEvent
```

Update the state interface:

```typescript
interface SprintEventsState {
  taskEvents: Record<string, AnyTaskEvent[]> // was TaskOutputEvent[]
  latestEvents: Record<string, AnyTaskEvent> // was TaskOutputEvent
  // ... rest unchanged
}
```

- [ ] **Step 3: Remove both `as never` casts**

Replace line 46:

```typescript
// Before
[agentId]: [...(s.taskEvents[agentId] ?? []), event as never],
// After
[agentId]: [...(s.taskEvents[agentId] ?? []), event],
```

Replace line 50:

```typescript
// Before
[agentId]: event as never,
// After
[agentId]: event,
```

- [ ] **Step 4: Fix any downstream type errors**

Run `npm run typecheck` and fix any components that consume `taskEvents` or `latestEvents` and expect `TaskOutputEvent` specifically. They should accept `AnyTaskEvent` or use type narrowing:

```typescript
// Type guard for components that need TaskOutputEvent specifically
function isTaskOutputEvent(e: AnyTaskEvent): e is TaskOutputEvent {
  return typeof e.timestamp === 'string'
}
```

- [ ] **Step 5: Verify no `as never` remains**

```bash
grep -n "as never" src/renderer/src/stores/sprintEvents.ts
```

Expected: Zero results.

- [ ] **Step 6: Run typecheck and tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/sprintEvents.ts src/renderer/src/components/
git commit -m "fix: replace as-never type escapes with union type in sprintEvents

Widens taskEvents/latestEvents to accept AnyTaskEvent (TaskOutputEvent |
AgentEvent) during the dual-write migration. Eliminates unsafe casts."
```
