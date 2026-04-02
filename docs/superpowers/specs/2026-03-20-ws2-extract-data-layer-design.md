# WS2: Extract Data Layer

**Date:** 2026-03-20
**Status:** Draft
**Effort:** 1-2 days
**Dependencies:** None

## Problem

Database queries are scattered across handler files with no abstraction boundary. 10+ files call `getDb()` directly with raw SQL. This makes queries untestable in isolation (only tested indirectly via mocked IPC) and couples business logic to SQLite.

### Current State

```
handlers/sprint-local.ts  → getDb().prepare('SELECT * FROM sprint_tasks ...').get(id)
handlers/sprint-local.ts  → getDb().prepare('INSERT INTO sprint_tasks ...').run(...)
agent-history.ts           → getDb().prepare('SELECT * FROM agent_runs ...').all(...)
cost-queries.ts            → getDb().prepare('SELECT ... FROM cost_events ...').all(...)
agents/event-store.ts      → getDb().prepare('INSERT INTO agent_events ...').run(...)
settings.ts                → getDb().prepare('SELECT value FROM settings ...').get(key)
```

## Solution

Create `src/main/data/` directory with query modules. Each function takes `db: Database` as its first parameter (lightweight functional style). Export type aliases as repository contracts.

## Architecture

```
src/main/data/
  sprint-queries.ts       — Sprint task CRUD queries
  agent-queries.ts        — Agent run queries (history, cost)
  cost-queries.ts         — Cost event queries (move from src/main/cost-queries.ts)
  settings-queries.ts     — Settings key-value queries
  event-queries.ts        — Agent event persistence queries
  index.ts                — Re-exports + repository type aliases
```

### Repository Type Contracts

```typescript
// src/main/data/index.ts

import type { Database } from 'better-sqlite3'

// Type aliases for repository function signatures
export type SprintTaskRepo = {
  getTask: (db: Database, id: string) => SprintTask | null
  listTasks: (db: Database, status?: string) => SprintTask[]
  createTask: (db: Database, input: CreateTaskInput) => SprintTask
  updateTask: (db: Database, id: string, patch: Record<string, unknown>) => SprintTask | null
  deleteTask: (db: Database, id: string) => boolean
  claimTask: (db: Database, id: string, claimedBy: string) => SprintTask | null
  releaseTask: (db: Database, id: string) => SprintTask | null
  getQueueStats: (db: Database) => QueueStats
  getDoneTodayCount: (db: Database) => number
}
```

### Query Module Pattern

```typescript
// src/main/data/sprint-queries.ts
import type { Database } from 'better-sqlite3'
import type { SprintTask } from '../../shared/types'

const UPDATE_ALLOWLIST = new Set([
  'title', 'prompt', 'repo', 'status', 'priority', 'spec', 'notes',
  'pr_url', 'pr_number', 'pr_status', 'agent_run_id', 'claimed_by',
  'template_name', 'started_at', 'completed_at',
])

export function getTask(db: Database, id: string): SprintTask | null {
  return db.prepare('SELECT * FROM sprint_tasks WHERE id = ?').get(id) as SprintTask | null
}

export function listTasks(db: Database, status?: string): SprintTask[] {
  if (status) {
    return db
      .prepare('SELECT * FROM sprint_tasks WHERE status = ? ORDER BY priority ASC, created_at DESC')
      .all(status) as SprintTask[]
  }
  return db
    .prepare('SELECT * FROM sprint_tasks ORDER BY priority ASC, created_at DESC')
    .all() as SprintTask[]
}

export function updateTask(
  db: Database,
  id: string,
  patch: Record<string, unknown>
): SprintTask | null {
  // Filter to allowlisted fields, build SET clause, execute UPDATE
  // Return updated row
}

// ... etc
```

## Changes

### 1. Create `src/main/data/sprint-queries.ts`

Extract from `src/main/handlers/sprint-local.ts`:
- `getTask()`, `listTasks()`, `createTask()`, `updateTask()`, `deleteTask()`
- `claimTask()`, `releaseTask()`, `getQueueStats()`, `getDoneTodayCount()`
- `markTaskDoneByPrNumber()`, `markTaskCancelledByPrNumber()`
- Move `UPDATE_ALLOWLIST` here

All functions gain `db: Database` as first parameter.

### 2. Create `src/main/data/agent-queries.ts`

Extract from `src/main/agent-history.ts`:
- `listAgents()`, `getAgentMeta()`, `createAgentRecord()`, `updateAgentMeta()`
- `findAgentByPid()`, `pruneOldAgents()`, `importAgent()`

Note: Cost rollup queries live in `src/main/cost-queries.ts`, not `agent-history.ts` — they are handled separately in step 3.

### 3. Move `src/main/cost-queries.ts` → `src/main/data/cost-queries.ts`

Already somewhat isolated. Add `db` parameter, remove internal `getDb()` calls.

### 4. Create `src/main/data/settings-queries.ts`

Extract from `src/main/settings.ts`:
- `getSetting()`, `setSetting()`, `deleteSetting()`, `getSettingJson()`, `setSettingJson()`

### 5. Create `src/main/data/event-queries.ts`

Extract from `src/main/agents/event-store.ts`:
- Agent event persistence (INSERT/SELECT on agent_events if applicable)

### 6. Update callers

All existing callers change from:
```typescript
import { getTask } from './handlers/sprint-local'
// getTask(id)
```
To:
```typescript
import { getTask } from './data/sprint-queries'
// getTask(getDb(), id)
```

Callers that already have a `db` reference pass it directly. Callers that don't, call `getDb()` at the call site.

### 7. Create test files

```
src/main/data/__tests__/
  sprint-queries.test.ts
  agent-queries.test.ts
  cost-queries.test.ts
  settings-queries.test.ts
```

Each test file:
```typescript
import Database from 'better-sqlite3'
import { runMigrations } from '../db'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('getTask', () => {
  it('returns task by id', () => {
    db.prepare('INSERT INTO sprint_tasks (id, title, status) VALUES (?, ?, ?)').run('t1', 'Test', 'backlog')
    expect(getTask(db, 't1')).toMatchObject({ id: 't1', title: 'Test' })
  })

  it('returns null for missing id', () => {
    expect(getTask(db, 'nonexistent')).toBeNull()
  })
})
```

### 8. Verify `runMigrations()` is exported for testing

`src/main/db.ts` already exports `runMigrations(db)` (line 316). Verify it accepts an arbitrary `Database.Database` instance so tests can use in-memory databases. If it currently only works with the singleton, refactor to accept a `db` parameter.

## Migration Strategy

1. Create `src/main/data/` modules first (copy functions, add `db` param)
2. Update callers one module at a time (sprint-local → queue-api/router → etc.)
3. Delete original functions from handler files once all callers migrated
4. Add test files

## Verification

- `npm run typecheck` passes
- `npm test` passes (existing tests still work)
- New query tests pass with in-memory SQLite
- `grep -r "getDb()" src/main/handlers` shows no direct DB calls in handlers (only `getDb()` passed as argument)

## Risk

Low-medium. Pure refactor — no logic changes. Main risk is missing a caller during migration. Typecheck will catch missing imports.
