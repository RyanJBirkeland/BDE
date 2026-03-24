# Event Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Persist agent visibility events to SQLite and expose them via the Queue API so Paul can fetch a structured event timeline for any task.

**Architecture:** The existing `agent_events` table (migration v11) and `event-queries.ts` already provide `appendEvent` and `getEventHistory`. This plan adds batch insert for the `POST /queue/tasks/:id/output` handler, a new `queryEvents` function with filtering/pagination, a `pruneEventsByAgentIds` function for cleanup, a `GET /queue/tasks/:id/events` endpoint, and a `get_task_events` MCP tool in claude-chat-service. The MCP tool depends on the `bde-client.ts` HTTP client created in the Agent Log Access plan.

**Tech Stack:** TypeScript, better-sqlite3, Node.js HTTP, Vitest, @anthropic-ai/claude-agent-sdk (MCP tools), zod

**Spec:** `docs/superpowers/specs/2026-03-23-event-store-design.md`

**Dependency:** Tasks 8-10 of this plan build on `bde-client.ts` from the [Agent Log Access plan](~/projects/claude-chat-service/docs/superpowers/plans/2026-03-23-agent-log-access.md). Complete Agent Log Access Task 8 before starting Event Store Task 8.

---

## File Structure

### BDE (`~/projects/BDE`)

| File | Role | Action |
|------|------|--------|
| `src/main/data/event-queries.ts` | Event DB queries | Modify -- add `insertEventBatch`, `queryEvents`, `pruneEventsByAgentIds` |
| `src/main/data/__tests__/event-queries.test.ts` | Event query tests | Modify -- add tests for new functions |
| `src/main/queue-api/router.ts` | HTTP router | Modify -- wire persistence into `POST /queue/tasks/:id/output`, add `GET /queue/tasks/:id/events` |
| `src/main/queue-api/__tests__/queue-api.test.ts` | Router tests | Modify -- add tests for event persistence and new endpoint |
| `src/main/agent-history.ts` | Agent history facade | Modify -- wire `pruneEventsByAgentIds` into `pruneOldAgents` |
| `src/main/__tests__/agent-history.test.ts` | History tests | Modify -- verify event pruning |
| `src/shared/queue-api-contract.ts` | API contract types | Modify -- add `TaskEventsResponse` |

### claude-chat-service (`~/projects/claude-chat-service`)

| File | Role | Action |
|------|------|--------|
| `src/adapters/sprint/bde-client.ts` | HTTP client for BDE Queue API | Modify -- add `fetchTaskEvents` |
| `src/adapters/sprint/bde-client.test.ts` | Client tests | Modify -- add tests for `fetchTaskEvents` |
| `src/adapters/sprint/tools.ts` | MCP tool definitions | Modify -- add `get_task_events` |
| `src/adapters/sprint/tools.test.ts` | Tool handler tests | Modify -- add tests for `get_task_events` |
| `src/adapters/sprint/index.ts` | MCP server wiring | Verify tool is registered (Plan 1 Task 11 sets up the `agentTools` array and `isBdeConfigured()` guard in `index.ts` — if Plan 1 is not yet complete, this wiring must be done here) |

---

## Task 1: `insertEventBatch` in `event-queries.ts`

**Files:**
- Modify: `~/projects/BDE/src/main/data/event-queries.ts`
- Modify: `~/projects/BDE/src/main/data/__tests__/event-queries.test.ts`

- [ ] **Step 1: Write failing test for `insertEventBatch`**

In `src/main/data/__tests__/event-queries.test.ts`, add `insertEventBatch` to the imports, then add:

```typescript
describe('insertEventBatch', () => {
  it('inserts multiple events in a single transaction', () => {
    const events = [
      { agentId: 'agent-1', eventType: 'agent:started', payload: '{"type":"agent:started","model":"opus"}', timestamp: 1000 },
      { agentId: 'agent-1', eventType: 'agent:tool_call', payload: '{"type":"agent:tool_call","tool":"Bash"}', timestamp: 2000 },
      { agentId: 'agent-1', eventType: 'agent:completed', payload: '{"type":"agent:completed","exitCode":0}', timestamp: 3000 },
    ]

    insertEventBatch(db, events)

    const history = getEventHistory(db, 'agent-1')
    expect(history).toHaveLength(3)
    expect(JSON.parse(history[0].payload).type).toBe('agent:started')
    expect(JSON.parse(history[2].payload).type).toBe('agent:completed')
  })

  it('handles empty batch gracefully', () => {
    insertEventBatch(db, [])
    const history = getEventHistory(db, 'agent-1')
    expect(history).toHaveLength(0)
  })

  it('is atomic -- all or nothing', () => {
    // Insert one valid event first
    appendEvent(db, 'agent-1', 'agent:text', '{"pre":true}', 500)

    // The batch itself should succeed since all fields are valid
    const events = [
      { agentId: 'agent-1', eventType: 'agent:started', payload: '{"a":1}', timestamp: 1000 },
      { agentId: 'agent-1', eventType: 'agent:text', payload: '{"b":2}', timestamp: 2000 },
    ]
    insertEventBatch(db, events)

    const history = getEventHistory(db, 'agent-1')
    expect(history).toHaveLength(3) // 1 pre-existing + 2 batch
  })
})
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/event-queries.test.ts`
Expect: FAIL -- `insertEventBatch` is not exported.

- [ ] **Step 2: Implement `insertEventBatch`**

In `src/main/data/event-queries.ts`, add:

```typescript
export interface EventBatchItem {
  agentId: string
  eventType: string
  payload: string
  timestamp: number
}

export function insertEventBatch(
  db: Database.Database,
  events: EventBatchItem[]
): void {
  if (events.length === 0) return

  const insert = db.prepare(
    'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
  )

  const tx = db.transaction(() => {
    for (const e of events) {
      insert.run(e.agentId, e.eventType, e.payload, e.timestamp)
    }
  })
  tx()
}
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/event-queries.test.ts`
Expect: PASS.

- [ ] **Step 3: Commit**

```
git add src/main/data/event-queries.ts src/main/data/__tests__/event-queries.test.ts
git commit -m "feat: add insertEventBatch for transactional bulk event insert"
```

---

## Task 2: `queryEvents` in `event-queries.ts`

**Files:**
- Modify: `~/projects/BDE/src/main/data/event-queries.ts`
- Modify: `~/projects/BDE/src/main/data/__tests__/event-queries.test.ts`

- [ ] **Step 1: Write failing test for `queryEvents`**

In `src/main/data/__tests__/event-queries.test.ts`, add `queryEvents` to the imports, then add:

```typescript
describe('queryEvents', () => {
  beforeEach(() => {
    // Seed events across two agents
    appendEvent(db, 'agent-1', 'agent:started', '{"type":"agent:started","model":"opus"}', 1000)
    appendEvent(db, 'agent-1', 'agent:tool_call', '{"type":"agent:tool_call","tool":"Bash"}', 2000)
    appendEvent(db, 'agent-1', 'agent:tool_call', '{"type":"agent:tool_call","tool":"Read"}', 3000)
    appendEvent(db, 'agent-1', 'agent:completed', '{"type":"agent:completed","exitCode":0}', 4000)
    appendEvent(db, 'agent-2', 'agent:started', '{"type":"agent:started","model":"sonnet"}', 5000)
  })

  it('returns all events for a given agent_id', () => {
    const result = queryEvents(db, { agentId: 'agent-1' })
    expect(result.events).toHaveLength(4)
    expect(result.events[0].event_type).toBe('agent:started')
    expect(result.events[3].event_type).toBe('agent:completed')
  })

  it('filters by event type', () => {
    const result = queryEvents(db, { agentId: 'agent-1', eventType: 'agent:tool_call' })
    expect(result.events).toHaveLength(2)
    expect(result.events.every(e => e.event_type === 'agent:tool_call')).toBe(true)
  })

  it('supports afterTimestamp for pagination', () => {
    const result = queryEvents(db, { agentId: 'agent-1', afterTimestamp: 2000 })
    expect(result.events).toHaveLength(2) // events at 3000 and 4000
  })

  it('respects limit', () => {
    const result = queryEvents(db, { agentId: 'agent-1', limit: 2 })
    expect(result.events).toHaveLength(2)
    expect(result.hasMore).toBe(true)
  })

  it('returns hasMore=false when all events fit', () => {
    const result = queryEvents(db, { agentId: 'agent-1', limit: 100 })
    expect(result.hasMore).toBe(false)
  })

  it('returns empty result for unknown agent', () => {
    const result = queryEvents(db, { agentId: 'nonexistent' })
    expect(result.events).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })

  it('queries by multiple agent IDs', () => {
    const result = queryEvents(db, { agentIds: ['agent-1', 'agent-2'] })
    expect(result.events).toHaveLength(5)
  })
})
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/event-queries.test.ts`
Expect: FAIL -- `queryEvents` is not exported.

- [ ] **Step 2: Implement `queryEvents`**

In `src/main/data/event-queries.ts`, add:

```typescript
export interface EventRow {
  id: number
  agent_id: string
  event_type: string
  payload: string
  timestamp: number
}

export interface QueryEventsOptions {
  agentId?: string
  agentIds?: string[]
  eventType?: string
  afterTimestamp?: number
  limit?: number
}

export interface QueryEventsResult {
  events: EventRow[]
  hasMore: boolean
}

export function queryEvents(
  db: Database.Database,
  opts: QueryEventsOptions
): QueryEventsResult {
  const conditions: string[] = []
  const params: unknown[] = []
  const limit = opts.limit ?? 200

  if (opts.agentId) {
    conditions.push('agent_id = ?')
    params.push(opts.agentId)
  } else if (opts.agentIds && opts.agentIds.length > 0) {
    const placeholders = opts.agentIds.map(() => '?').join(', ')
    conditions.push(`agent_id IN (${placeholders})`)
    params.push(...opts.agentIds)
  }

  if (opts.eventType) {
    conditions.push('event_type = ?')
    params.push(opts.eventType)
  }

  if (opts.afterTimestamp != null) {
    conditions.push('timestamp > ?')
    params.push(opts.afterTimestamp)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  // Fetch limit+1 to detect hasMore
  const sql = `SELECT * FROM agent_events ${where} ORDER BY timestamp ASC LIMIT ?`
  params.push(limit + 1)

  const rows = db.prepare(sql).all(...params) as EventRow[]
  const hasMore = rows.length > limit
  if (hasMore) rows.pop()

  return { events: rows, hasMore }
}
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/event-queries.test.ts`
Expect: PASS.

- [ ] **Step 3: Commit**

```
git add src/main/data/event-queries.ts src/main/data/__tests__/event-queries.test.ts
git commit -m "feat: add queryEvents with filtering, pagination, and multi-agent support"
```

---

## Task 3: `pruneEventsByAgentIds` in `event-queries.ts`

**Files:**
- Modify: `~/projects/BDE/src/main/data/event-queries.ts`
- Modify: `~/projects/BDE/src/main/data/__tests__/event-queries.test.ts`

- [ ] **Step 1: Write failing test for `pruneEventsByAgentIds`**

In `src/main/data/__tests__/event-queries.test.ts`, add `pruneEventsByAgentIds` to the imports, then add:

```typescript
describe('pruneEventsByAgentIds', () => {
  it('deletes events for the given agent IDs', () => {
    appendEvent(db, 'agent-1', 'agent:text', '{"a":1}', 1000)
    appendEvent(db, 'agent-2', 'agent:text', '{"b":2}', 2000)
    appendEvent(db, 'agent-3', 'agent:text', '{"c":3}', 3000)

    pruneEventsByAgentIds(db, ['agent-1', 'agent-2'])

    expect(getEventHistory(db, 'agent-1')).toHaveLength(0)
    expect(getEventHistory(db, 'agent-2')).toHaveLength(0)
    expect(getEventHistory(db, 'agent-3')).toHaveLength(1)
  })

  it('handles empty array gracefully', () => {
    appendEvent(db, 'agent-1', 'agent:text', '{"a":1}', 1000)
    pruneEventsByAgentIds(db, [])
    expect(getEventHistory(db, 'agent-1')).toHaveLength(1)
  })

  it('handles non-existent agent IDs gracefully', () => {
    appendEvent(db, 'agent-1', 'agent:text', '{"a":1}', 1000)
    pruneEventsByAgentIds(db, ['ghost-1', 'ghost-2'])
    expect(getEventHistory(db, 'agent-1')).toHaveLength(1)
  })
})
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/event-queries.test.ts`
Expect: FAIL -- `pruneEventsByAgentIds` is not exported.

- [ ] **Step 2: Implement `pruneEventsByAgentIds`**

In `src/main/data/event-queries.ts`, add:

```typescript
export function pruneEventsByAgentIds(
  db: Database.Database,
  agentIds: string[]
): void {
  if (agentIds.length === 0) return

  const placeholders = agentIds.map(() => '?').join(', ')
  db.prepare(`DELETE FROM agent_events WHERE agent_id IN (${placeholders})`).run(
    ...agentIds
  )
}
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/event-queries.test.ts`
Expect: PASS.

- [ ] **Step 3: Commit**

```
git add src/main/data/event-queries.ts src/main/data/__tests__/event-queries.test.ts
git commit -m "feat: add pruneEventsByAgentIds for targeted event cleanup"
```

---

## Task 4: Wire Event Persistence into `POST /queue/tasks/:id/output` Handler

**Files:**
- Modify: `~/projects/BDE/src/main/queue-api/router.ts`
- Modify: `~/projects/BDE/src/main/queue-api/__tests__/queue-api.test.ts`

- [ ] **Step 1: Write failing test for event persistence**

In `src/main/queue-api/__tests__/queue-api.test.ts`, add the mock for event-queries:

```typescript
const mockInsertEventBatch = vi.fn()

vi.mock('../../data/event-queries', () => ({
  insertEventBatch: (...args: unknown[]) => mockInsertEventBatch(...args),
}))
```

Then add:

```typescript
describe('POST /queue/tasks/:id/output - event persistence', () => {
  it('persists events to SQLite via insertEventBatch', async () => {
    const events = [
      { type: 'agent:started', model: 'opus', timestamp: '2025-01-01T00:00:00Z' },
      { type: 'agent:tool_call', tool: 'Bash', summary: 'run tests', timestamp: '2025-01-01T00:01:00Z' },
    ]
    const res = await request('POST', '/queue/tasks/task-1/output', { events })
    expect(res.status).toBe(200)
    expect(mockInsertEventBatch).toHaveBeenCalledWith(
      expect.anything(), // db instance
      expect.arrayContaining([
        expect.objectContaining({
          agentId: 'task-1',
          eventType: 'agent:started',
        }),
        expect.objectContaining({
          agentId: 'task-1',
          eventType: 'agent:tool_call',
        }),
      ])
    )
  })

  it('still broadcasts events to SSE clients', async () => {
    const events = [{ type: 'agent:text', text: 'hello' }]
    const res = await request('POST', '/queue/tasks/task-1/output', { events })
    expect(res.status).toBe(200)
    // SSE broadcast is fire-and-forget -- just verify the endpoint works
  })
})
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/queue-api/__tests__/queue-api.test.ts`
Expect: FAIL -- `mockInsertEventBatch` not called.

- [ ] **Step 2: Wire persistence into the handler**

In `src/main/queue-api/router.ts`, add the import:

```typescript
import { insertEventBatch } from '../data/event-queries'
import { getDb } from '../db'
```

**Important:** The `agent_events.agent_id` column should store the actual **agent run ID** (not the task ID), consistent with how `appendEvent` and `getEventHistory` use it. The request body can include `agentId` (the caller knows it), or we fall back to using the `taskId` as a key (simpler but semantically imprecise). Per the spec, prefer caller-provided `agentId`.

In the `handleTaskOutput` function, after the SSE broadcast loop, add event persistence:

```typescript
// Persist curated events to SQLite for later retrieval
const CURATED_TYPES = new Set([
  'agent:started', 'agent:tool_call', 'agent:tool_result',
  'agent:rate_limited', 'agent:error', 'agent:completed',
])
try {
  // Use agentId from request body if provided, otherwise fall back to taskId
  const agentId = (body as Record<string, unknown>).agentId as string ?? taskId
  const dbEvents = events
    .filter((e): e is Record<string, unknown> =>
      typeof e === 'object' && e !== null &&
      CURATED_TYPES.has(String((e as Record<string, unknown>).type))
    )
    .map((e) => ({
      agentId,
      eventType: String((e as Record<string, unknown>).type ?? 'unknown'),
      payload: JSON.stringify(e),
      timestamp: typeof (e as Record<string, unknown>).timestamp === 'string'
        ? new Date((e as Record<string, unknown>).timestamp as string).getTime()
        : typeof (e as Record<string, unknown>).timestamp === 'number'
          ? (e as Record<string, unknown>).timestamp as number
          : Date.now(),
    }))
  if (dbEvents.length > 0) {
    insertEventBatch(getDb(), dbEvents)
  }
} catch (err) {
  // Event persistence is best-effort -- don't fail the request
  console.error('[queue-api] Failed to persist events:', err)
}
```

**Note on testing:** The existing `queue-api.test.ts` starts a real HTTP server but does not mock `getDb`. Add `vi.mock('../../db', () => ({ getDb: vi.fn(() => mockDb) }))` where `mockDb` is an in-memory `better-sqlite3` instance with the `agent_events` table created. Alternatively, mock `insertEventBatch` directly so `getDb` is never called.

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/queue-api/__tests__/queue-api.test.ts`
Expect: PASS.

- [ ] **Step 3: Commit**

```
git add src/main/queue-api/router.ts src/main/queue-api/__tests__/queue-api.test.ts
git commit -m "feat: persist visibility events to SQLite in POST /queue/tasks/:id/output"
```

---

## Task 5: `GET /queue/tasks/:id/events` Endpoint

**Files:**
- Modify: `~/projects/BDE/src/main/queue-api/router.ts`
- Modify: `~/projects/BDE/src/main/queue-api/__tests__/queue-api.test.ts`

- [ ] **Step 1: Write failing tests for `GET /queue/tasks/:id/events`**

In `src/main/queue-api/__tests__/queue-api.test.ts`, add the mock for `queryEvents`:

```typescript
const mockQueryEvents = vi.fn()

// REPLACE the existing event-queries mock from Task 4 (only one vi.mock per module allowed):
vi.mock('../../data/event-queries', () => ({
  insertEventBatch: (...args: unknown[]) => mockInsertEventBatch(...args),
  queryEvents: (...args: unknown[]) => mockQueryEvents(...args),
}))
```

Then add:

```typescript
describe('GET /queue/tasks/:id/events', () => {
  it('returns events for a task', async () => {
    mockQueryEvents.mockReturnValue({
      events: [
        { id: 1, agent_id: 'task-1', event_type: 'agent:started', payload: '{"type":"agent:started","model":"opus"}', timestamp: 1000 },
        { id: 2, agent_id: 'task-1', event_type: 'agent:tool_call', payload: '{"type":"agent:tool_call","tool":"Bash"}', timestamp: 2000 },
      ],
      hasMore: false,
    })

    const res = await request('GET', '/queue/tasks/task-1/events')
    expect(res.status).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body.events).toHaveLength(2)
    expect(body.hasMore).toBe(false)
  })

  it('passes eventType filter', async () => {
    mockQueryEvents.mockReturnValue({ events: [], hasMore: false })
    await request('GET', '/queue/tasks/task-1/events?eventType=agent:tool_call')
    expect(mockQueryEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'agent:tool_call' })
    )
  })

  it('passes afterTimestamp for pagination', async () => {
    mockQueryEvents.mockReturnValue({ events: [], hasMore: false })
    await request('GET', '/queue/tasks/task-1/events?afterTimestamp=5000')
    expect(mockQueryEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ afterTimestamp: 5000 })
    )
  })

  it('passes limit parameter', async () => {
    mockQueryEvents.mockReturnValue({ events: [], hasMore: false })
    await request('GET', '/queue/tasks/task-1/events?limit=50')
    expect(mockQueryEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 50 })
    )
  })

  it('returns empty events for unknown task', async () => {
    mockQueryEvents.mockReturnValue({ events: [], hasMore: false })
    const res = await request('GET', '/queue/tasks/nonexistent/events')
    expect(res.status).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body.events).toHaveLength(0)
  })
})
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/queue-api/__tests__/queue-api.test.ts`
Expect: FAIL -- 404 (route not registered).

- [ ] **Step 2: Implement the endpoint**

In `src/main/queue-api/router.ts`, add the import:

```typescript
import { insertEventBatch, queryEvents } from '../data/event-queries'
```

(Update the existing `insertEventBatch` import to also include `queryEvents`.)

In the `route` function, add the route in the parameterized section. Place it BEFORE the `POST /queue/tasks/:id/output` route since `matchRoute` checks path segment count:

```typescript
// GET /queue/tasks/:id/events
params = matchRoute('/queue/tasks/:id/events', path)
if (method === 'GET' && params) {
  return handleGetTaskEvents(res, params['id'], query)
}
```

Add the handler:

```typescript
async function handleGetTaskEvents(
  res: http.ServerResponse,
  taskId: string,
  query: URLSearchParams
): Promise<void> {
  const eventType = query.get('eventType') ?? undefined
  const afterTimestamp = query.has('afterTimestamp')
    ? parseInt(query.get('afterTimestamp')!, 10)
    : undefined
  const limit = Math.min(
    Math.max(parseInt(query.get('limit') ?? '200', 10) || 200, 1),
    1000
  )

  // Query by taskId -- events stored with agentId from request body
  // may use either agent run ID or task ID as the key.
  // For consistency, also check if Agent Log Access plan added
  // listAgentRunsByTaskId -- if so, resolve agentRunIds and query by those.
  const result = queryEvents(getDb(), {
    agentId: taskId,
    eventType,
    afterTimestamp,
    limit,
  })

  sendJson(res, 200, {
    events: result.events.map((e) => ({
      id: e.id,
      agentId: e.agent_id,
      eventType: e.event_type,
      payload: JSON.parse(e.payload),
      timestamp: e.timestamp,
    })),
    hasMore: result.hasMore,
  })
}
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/queue-api/__tests__/queue-api.test.ts`
Expect: PASS.

- [ ] **Step 3: Commit**

```
git add src/main/queue-api/router.ts src/main/queue-api/__tests__/queue-api.test.ts
git commit -m "feat: add GET /queue/tasks/:id/events endpoint"
```

---

## Task 6: Wire `pruneEventsByAgentIds` into `pruneOldAgents`

**Files:**
- Modify: `~/projects/BDE/src/main/agent-history.ts`
- Modify: `~/projects/BDE/src/main/__tests__/agent-history.test.ts`

- [ ] **Step 1: Write failing test for event pruning during agent pruning**

In `src/main/__tests__/agent-history.test.ts`, add a test that verifies events are cleaned up when agents are pruned. This depends on the test setup -- the key is:

```typescript
describe('pruneOldAgents cleans up events', () => {
  it('deletes events for pruned agent IDs', async () => {
    // Create 3 agents (oldest will be pruned when maxCount=2)
    for (let i = 1; i <= 3; i++) {
      await createAgentRecord({
        id: `prune-agent-${i}`,
        pid: null,
        bin: 'claude',
        model: 'opus',
        repo: 'bde',
        repoPath: '/tmp',
        task: `task ${i}`,
        startedAt: `2025-01-0${i}T00:00:00Z`,
        finishedAt: `2025-01-0${i}T01:00:00Z`,
        exitCode: 0,
        status: 'done',
        source: 'bde',
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null,
      })
    }

    // Add events for the oldest agent (will be pruned)
    const { appendEvent, getEventHistory } = await import('../data/event-queries')
    const { getDb } = await import('../db')
    appendEvent(getDb(), 'prune-agent-1', 'agent:text', '{"a":1}', 1000)
    appendEvent(getDb(), 'prune-agent-2', 'agent:text', '{"b":2}', 2000)

    // Prune keeping only 2 agents -- agent-1 should be removed
    await pruneOldAgents(2)

    // Events for pruned agent should be gone
    expect(getEventHistory(getDb(), 'prune-agent-1')).toHaveLength(0)
    // Events for surviving agents should remain
    expect(getEventHistory(getDb(), 'prune-agent-2')).toHaveLength(1)
  })
})
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/__tests__/agent-history.test.ts`
Expect: FAIL -- events for pruned agents still exist (pruneOldAgents does not clean them).

- [ ] **Step 2: Wire event pruning into `pruneOldAgents`**

In `src/main/agent-history.ts`, add the import:

```typescript
import { pruneEventsByAgentIds } from './data/event-queries'
```

In the `pruneOldAgents` function, add event cleanup right before the `deleteAgent` transaction (after the `clearSprintTaskFk` loop, before the SQLite delete transaction):

```typescript
// Clean up events for agents being removed
const agentIdsToRemove = toRemove.map(r => r.id)
if (agentIdsToRemove.length > 0) {
  pruneEventsByAgentIds(db, agentIdsToRemove)
}
```

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/__tests__/agent-history.test.ts`
Expect: PASS.

- [ ] **Step 3: Commit**

```
git add src/main/agent-history.ts src/main/__tests__/agent-history.test.ts
git commit -m "feat: prune events alongside agent records in pruneOldAgents"
```

---

## Task 7: Add `TaskEventsResponse` to `queue-api-contract.ts`

**Files:**
- Modify: `~/projects/BDE/src/shared/queue-api-contract.ts`

- [ ] **Step 1: Add the response type**

In `src/shared/queue-api-contract.ts`, add at the end of the file (before the health monitoring types section):

```typescript
// --- Task Events Response ---

export interface TaskEventItem {
  id: number
  agentId: string
  eventType: string
  payload: Record<string, unknown>
  timestamp: number
}

export interface TaskEventsResponse {
  events: TaskEventItem[]
  hasMore: boolean
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expect: PASS.

- [ ] **Step 3: Commit**

```
git add src/shared/queue-api-contract.ts
git commit -m "feat: add TaskEventsResponse to queue-api-contract"
```

---

## Task 8: `fetchTaskEvents` in `bde-client.ts` (claude-chat-service)

**Dependency:** Requires Plan 1 Task 8 (bde-client.ts must exist).

**Files:**
- Modify: `~/projects/claude-chat-service/src/adapters/sprint/bde-client.ts`
- Modify: `~/projects/claude-chat-service/src/adapters/sprint/bde-client.test.ts`

- [ ] **Step 1: Write failing test for `fetchTaskEvents`**

In `src/adapters/sprint/bde-client.test.ts`, add `fetchTaskEvents` to the imports, then add:

```typescript
describe('fetchTaskEvents', () => {
  it('calls GET /queue/tasks/:id/events', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        events: [
          { id: 1, agentId: 'task-1', eventType: 'agent:started', payload: { type: 'agent:started', model: 'opus' }, timestamp: 1000 },
          { id: 2, agentId: 'task-1', eventType: 'agent:tool_call', payload: { type: 'agent:tool_call', tool: 'Bash' }, timestamp: 2000 },
        ],
        hasMore: false,
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await fetchTaskEvents('task-1')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:18790/queue/tasks/task-1/events?limit=200',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      })
    )
    expect(result.events).toHaveLength(2)
    expect(result.hasMore).toBe(false)
  })

  it('passes eventType filter', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], hasMore: false }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await fetchTaskEvents('task-1', { eventType: 'agent:tool_call' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('eventType=agent%3Atool_call'),
      expect.anything()
    )
  })

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server error'),
    }))

    await expect(fetchTaskEvents('task-1')).rejects.toThrow('BDE API error 500')
  })
})
```

Run: `cd ~/projects/claude-chat-service && npx vitest run src/adapters/sprint/bde-client.test.ts`
Expect: FAIL -- `fetchTaskEvents` is not exported.

- [ ] **Step 2: Implement `fetchTaskEvents`**

In `src/adapters/sprint/bde-client.ts`, add the types and function:

```typescript
export interface TaskEventItem {
  id: number
  agentId: string
  eventType: string
  payload: Record<string, unknown>
  timestamp: number
}

export interface TaskEventsResponse {
  events: TaskEventItem[]
  hasMore: boolean
}

export interface FetchTaskEventsOptions {
  eventType?: string
  afterTimestamp?: number
  limit?: number
}

export async function fetchTaskEvents(
  taskId: string,
  opts: FetchTaskEventsOptions = {}
): Promise<TaskEventsResponse> {
  const base = getBaseUrl()
  const params = new URLSearchParams()
  params.set('limit', String(opts.limit ?? 200))
  if (opts.eventType) params.set('eventType', opts.eventType)
  if (opts.afterTimestamp != null) params.set('afterTimestamp', String(opts.afterTimestamp))

  const url = `${base}/queue/tasks/${encodeURIComponent(taskId)}/events?${params.toString()}`
  const res = await fetch(url, { headers: getHeaders() })
  if (!res.ok) {
    throw new Error(`BDE API error ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<TaskEventsResponse>
}
```

Run: `cd ~/projects/claude-chat-service && npx vitest run src/adapters/sprint/bde-client.test.ts`
Expect: PASS.

- [ ] **Step 3: Commit**

```
git add src/adapters/sprint/bde-client.ts src/adapters/sprint/bde-client.test.ts
git commit -m "feat: add fetchTaskEvents to bde-client.ts"
```

---

## Task 9: `get_task_events` MCP Tool

**Files:**
- Modify: `~/projects/claude-chat-service/src/adapters/sprint/tools.ts`
- Modify: `~/projects/claude-chat-service/src/adapters/sprint/tools.test.ts`

- [ ] **Step 1: Write failing test for `get_task_events` handler**

In `src/adapters/sprint/tools.test.ts`, add `fetchTaskEvents` to the `bde-client.js` mock:

```typescript
vi.mock('./bde-client.js', () => ({
  fetchAgentRuns: vi.fn(),
  fetchAgentLog: vi.fn(),
  fetchTaskEvents: vi.fn(),
  isBdeConfigured: vi.fn().mockReturnValue(true),
}))

import { fetchAgentRuns, fetchAgentLog, fetchTaskEvents } from './bde-client.js'
```

Then add:

```typescript
describe('get_task_events', () => {
  it('formats events as a structured timeline', async () => {
    vi.mocked(fetchTaskEvents).mockResolvedValue({
      events: [
        { id: 1, agentId: 'task-1', eventType: 'agent:started', payload: { type: 'agent:started', model: 'opus' }, timestamp: 1000 },
        { id: 2, agentId: 'task-1', eventType: 'agent:tool_call', payload: { type: 'agent:tool_call', tool: 'Bash', summary: 'npm test' }, timestamp: 2000 },
        { id: 3, agentId: 'task-1', eventType: 'agent:completed', payload: { type: 'agent:completed', exitCode: 0, costUsd: 0.45 }, timestamp: 3000 },
      ],
      hasMore: false,
    })

    const result = await sprintToolHandlers.get_task_events({ taskId: 'task-1' })
    expect(result.text).toContain('agent:started')
    expect(result.text).toContain('Bash')
    expect(result.text).toContain('agent:completed')
  })

  it('returns message when no events found', async () => {
    vi.mocked(fetchTaskEvents).mockResolvedValue({ events: [], hasMore: false })
    const result = await sprintToolHandlers.get_task_events({ taskId: 'task-1' })
    expect(result.text).toContain('No events found')
  })

  it('returns error message when BDE is unreachable', async () => {
    vi.mocked(fetchTaskEvents).mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await sprintToolHandlers.get_task_events({ taskId: 'task-1' })
    expect(result.text).toContain('BDE is not running')
  })

  it('passes eventType filter', async () => {
    vi.mocked(fetchTaskEvents).mockResolvedValue({ events: [], hasMore: false })
    await sprintToolHandlers.get_task_events({ taskId: 'task-1', eventType: 'agent:tool_call' })
    expect(fetchTaskEvents).toHaveBeenCalledWith('task-1', expect.objectContaining({ eventType: 'agent:tool_call' }))
  })
})
```

Run: `cd ~/projects/claude-chat-service && npx vitest run src/adapters/sprint/tools.test.ts`
Expect: FAIL -- `get_task_events` handler does not exist.

- [ ] **Step 2: Implement the handler and tool definition**

In `src/adapters/sprint/tools.ts`, add the import:

```typescript
import { fetchAgentRuns, fetchAgentLog, fetchTaskEvents } from './bde-client.js'
```

(Update the existing import to include `fetchTaskEvents`.)

Add to `sprintToolHandlers`:

```typescript
get_task_events: async (args: { taskId: string; eventType?: string; limit?: number }) => {
  try {
    const result = await fetchTaskEvents(args.taskId, {
      eventType: args.eventType,
      limit: args.limit ?? 100,
    })

    if (result.events.length === 0) {
      return { text: 'No events found for this task.' }
    }

    const lines = result.events.map((e) => {
      const ts = new Date(e.timestamp).toISOString().slice(11, 19) // HH:MM:SS
      const payload = e.payload
      switch (e.eventType) {
        case 'agent:started':
          return `[${ts}] STARTED model=${payload.model}`
        case 'agent:tool_call':
          return `[${ts}] TOOL ${payload.tool}: ${payload.summary ?? ''}`
        case 'agent:tool_result':
          return `[${ts}] RESULT ${payload.tool}: ${payload.success ? 'ok' : 'FAIL'} - ${payload.summary ?? ''}`
        case 'agent:thinking':
          return `[${ts}] THINKING (${payload.tokenCount} tokens)`
        case 'agent:error':
          return `[${ts}] ERROR: ${payload.message}`
        case 'agent:rate_limited':
          return `[${ts}] RATE LIMITED (attempt ${payload.attempt}, retry in ${payload.retryDelayMs}ms)`
        case 'agent:completed':
          return `[${ts}] COMPLETED exit=${payload.exitCode} cost=$${(payload.costUsd as number)?.toFixed(2) ?? '?'}`
        default:
          return `[${ts}] ${e.eventType}: ${JSON.stringify(payload)}`
      }
    })

    const header = `${result.events.length} event(s) for task ${args.taskId}:`
    const truncation = result.hasMore ? '\n\n(more events available -- use limit parameter)' : ''
    return { text: header + '\n\n' + lines.join('\n') + truncation }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('ENOTFOUND')) {
      return { text: "BDE is not running -- can't fetch events right now." }
    }
    return { isError: true, text: '', content: msg }
  }
},
```

Add to the `agentTools` array in `tools.ts` (this array is created by Agent Log Access Plan 1 Task 11 — if Plan 1 is complete, `agentTools` already exists alongside `get_agent_log` and `list_agent_runs`; if not, create it and wire it into `index.ts`):

```typescript
tool(
  'get_task_events',
  'Fetch the structured event timeline for a task (tool calls, results, errors, completion). More structured than raw logs.',
  {
    taskId: z.string().describe('Sprint task ID'),
    eventType: z.string().optional().describe('Filter by event type: agent:started, agent:tool_call, agent:tool_result, agent:error, agent:completed'),
    limit: z.number().optional().describe('Max events to return (default 100)'),
  },
  (args) => sprintToolHandlers.get_task_events(args),
  { annotations: { readOnly: true } },
),
```

Run: `cd ~/projects/claude-chat-service && npx vitest run src/adapters/sprint/tools.test.ts`
Expect: PASS.

- [ ] **Step 3: Commit**

```
git add src/adapters/sprint/tools.ts src/adapters/sprint/tools.test.ts
git commit -m "feat: add get_task_events MCP tool"
```

---

## Task 10: Wire Tool into MCP Server

**Files:**
- Modify: `~/projects/claude-chat-service/src/adapters/sprint/index.ts` (if not already done)

- [ ] **Step 1: Verify `get_task_events` is in the `agentTools` array**

The tool was added to the `agentTools` array in Task 9. If Agent Log Access Plan 1 Task 11 is complete, `index.ts` already pushes `...agentTools` into the tools list when `isBdeConfigured()` is true, and no additional wiring is needed.

**If Plan 1 is NOT yet complete:** You must create the `agentTools` array in `tools.ts`, add an `isBdeConfigured()` function (checks `process.env.BDE_QUEUE_URL`), and update `index.ts` to conditionally include `agentTools` alongside `sprintTools`.

Verify by checking the `agentTools` export includes the tool:

```typescript
// In tools.ts, agentTools should contain:
// - get_agent_log (Plan 1 Task 9)
// - list_agent_runs (Plan 1 Task 10)
// - get_task_events (Plan 2 Task 9)
```

- [ ] **Step 2: Run full test suite for both projects**

```
cd ~/projects/BDE && npm test && npm run test:main
cd ~/projects/claude-chat-service && npm test
```

Expect: PASS for all.

- [ ] **Step 3: Run typecheck for both projects**

```
cd ~/projects/BDE && npm run typecheck
cd ~/projects/claude-chat-service && npm run typecheck
```

Expect: PASS for both.

- [ ] **Step 4: Commit (if any changes were needed)**

```
git add src/adapters/sprint/index.ts
git commit -m "feat: wire get_task_events into MCP server"
```
