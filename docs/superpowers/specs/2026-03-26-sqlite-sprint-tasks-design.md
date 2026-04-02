# Design: Move Sprint Tasks from Supabase to Local SQLite

**Date:** 2026-03-26
**Status:** Approved
**Approach:** Big-bang rewrite (Approach A)

## Motivation

BDE should be self-contained. Sprint tasks were originally stored in local SQLite (migrations v6-v10) but were moved to Supabase in migration v12 to enable sync with an external task runner. Now that the task runner communicates exclusively through BDE's Queue API (port 18790), the Supabase dependency is unnecessary. Moving tasks back to SQLite eliminates a network dependency, simplifies the data layer, and makes BDE work offline.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data migration | One-time import from Supabase at migration v15 | Smoothest UX; no data loss; silent no-op if creds missing |
| Supabase future | Remove entirely; add back later if needed | YAGNI; half-used sync layers invite bugs |
| API surface | All functions sync | Honest API; SQLite is sync; simpler callers everywhere |
| Migration approach | Big-bang rewrite of sprint-queries.ts | Single file owns all queries; mechanical translation |

## Database Migration (v15)

### Schema

Recreates `sprint_tasks` with the full modern column set — v10's table plus columns added since the Supabase move:

```sql
CREATE TABLE sprint_tasks (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title               TEXT NOT NULL,
  prompt              TEXT NOT NULL DEFAULT '',
  repo                TEXT NOT NULL DEFAULT 'bde',
  status              TEXT NOT NULL DEFAULT 'backlog'
                        CHECK(status IN ('backlog','queued','blocked','active',
                                         'done','cancelled','failed','error')),
  priority            INTEGER NOT NULL DEFAULT 1,
  spec                TEXT,
  notes               TEXT,
  pr_url              TEXT,
  pr_number           INTEGER,
  pr_status           TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft')),
  pr_mergeable_state  TEXT,
  agent_run_id        TEXT,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  fast_fail_count     INTEGER NOT NULL DEFAULT 0,
  started_at          TEXT,
  completed_at        TEXT,
  claimed_by          TEXT,
  template_name       TEXT,
  depends_on          TEXT,
  playground_enabled  INTEGER DEFAULT 0,
  needs_review        INTEGER DEFAULT 0,
  max_runtime_ms      INTEGER,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_sprint_tasks_status ON sprint_tasks(status);
CREATE INDEX idx_sprint_tasks_claimed_by ON sprint_tasks(claimed_by);
CREATE INDEX idx_sprint_tasks_pr_number ON sprint_tasks(pr_number);

CREATE TRIGGER sprint_tasks_updated_at
  AFTER UPDATE ON sprint_tasks
  BEGIN
    UPDATE sprint_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = NEW.id;
  END;
```

### One-Time Supabase Import

Migration v15 checks if `supabase.url` and `supabase.serviceKey` exist in the settings table. If so, performs a raw `fetch()` to `{url}/rest/v1/sprint_tasks?select=*` with the service key as apikey header. Inserts all returned rows into the new SQLite table. If creds are missing or fetch fails, creates an empty table silently.

Uses raw `fetch()` — not `@supabase/supabase-js` — so the dependency can be removed.

**Import details:**
- Uses `INSERT OR IGNORE` to be idempotent (safe if migration runs twice due to a bug)
- `depends_on`: raw `fetch()` returns JSON strings (no auto-deserialization), so insert as-is into TEXT column
- `playground_enabled` / `needs_review`: Supabase returns booleans; convert `true` -> `1`, `false` -> `0`
- `prompt`: coerce `null` to `''` to match `NOT NULL DEFAULT ''` constraint
- Columns in Supabase that don't exist in the SQLite schema are silently ignored

## sprint-queries.ts Rewrite

All 19 exported query functions rewritten from async Supabase client calls to sync `better-sqlite3` calls. The module imports `getDb()` from `db.ts` instead of `getSupabaseClient()`. `setSprintQueriesLogger()` and `UPDATE_ALLOWLIST` are already sync and remain unchanged.

### Translation Patterns

**Simple queries:**
```typescript
// Before
export async function getTask(id: string): Promise<SprintTask | null> {
  const { data, error } = await getSupabaseClient()
    .from('sprint_tasks').select('*').eq('id', id).maybeSingle()
  ...
}

// After
export function getTask(id: string): SprintTask | null {
  const row = getDb().prepare('SELECT * FROM sprint_tasks WHERE id = ?').get(id)
  return row ? sanitizeTask(row as SprintTask) : null
}
```

**Atomic claim (conditional update):**
```typescript
export function claimTask(id: string, claimedBy: string): SprintTask | null {
  const now = new Date().toISOString()
  const result = getDb().prepare(
    `UPDATE sprint_tasks SET status = 'active', claimed_by = ?, started_at = ?
     WHERE id = ? AND status = 'queued'`
  ).run(claimedBy, now, id)
  if (result.changes === 0) return null
  return getTask(id)
}
```

SQLite's `busy_timeout = 5000` (configured in `db.ts`) + WAL mode handles concurrent access. The `WHERE status = 'queued'` guard is atomic within a single statement.

**Batch operations (markTaskDoneByPrNumber, markTaskCancelledByPrNumber):**
Wrap in `db.transaction()` for atomicity — currently 3 separate Supabase calls.

**getQueueStats:**
Becomes a proper `SELECT status, COUNT(*) as count FROM sprint_tasks GROUP BY status` instead of fetching all rows and counting in JS.

**Prepared statements:**
Frequently-called queries use cached prepared statements via `better-sqlite3`'s native caching.

### Type Mapping: SQLite <-> TypeScript

| SQLite type | TypeScript type | Conversion |
|-------------|----------------|------------|
| `INTEGER DEFAULT 0` | `boolean` | Read: `!!row.playground_enabled`, `!!row.needs_review`. Write: `value ? 1 : 0` |
| `TEXT` (depends_on) | `TaskDependency[] \| null` | Read: `JSON.parse()` in `sanitizeTask()`. Write: `JSON.stringify()` before INSERT/UPDATE |
| `TEXT NOT NULL DEFAULT ''` (prompt) | `string \| null` | Coerce `null` to `''` on write. Existing null prompts coerced to `''` during Supabase import |

`sanitizeTask()` handles all read-side conversions:
```typescript
function sanitizeTask(row: Record<string, unknown>): SprintTask {
  return {
    ...row,
    depends_on: sanitizeDependsOn(row.depends_on),
    playground_enabled: !!row.playground_enabled,
    needs_review: !!row.needs_review,
  } as SprintTask
}
```

`createTask()` and `updateTask()` handle write-side conversions:
- `depends_on`: `JSON.stringify()` before binding
- `playground_enabled` / `needs_review`: `value ? 1 : 0`

### Error Handling: Fail-Closed Behavior

`getActiveTaskCount()` currently returns `Infinity` on Supabase errors (fail-closed to prevent over-claiming). With SQLite, wrap in try/catch and preserve the same behavior — return `Infinity` if the query throws.

### Functions (19 query functions, all become sync)

| Function | Return type change |
|----------|-------------------|
| `getTask` | `Promise<SprintTask \| null>` -> `SprintTask \| null` |
| `listTasks` | `Promise<SprintTask[]>` -> `SprintTask[]` |
| `createTask` | `Promise<SprintTask \| null>` -> `SprintTask \| null` |
| `updateTask` | `Promise<SprintTask \| null>` -> `SprintTask \| null` |
| `deleteTask` | `Promise<void>` -> `void` |
| `claimTask` | `Promise<SprintTask \| null>` -> `SprintTask \| null` |
| `releaseTask` | `Promise<SprintTask \| null>` -> `SprintTask \| null` |
| `getQueueStats` | `Promise<QueueStats>` -> `QueueStats` |
| `getDoneTodayCount` | `Promise<number>` -> `number` |
| `markTaskDoneByPrNumber` | `Promise<string[]>` -> `string[]` |
| `markTaskCancelledByPrNumber` | `Promise<string[]>` -> `string[]` |
| `listTasksWithOpenPrs` | `Promise<SprintTask[]>` -> `SprintTask[]` |
| `updateTaskMergeableState` | `Promise<void>` -> `void` |
| `getActiveTaskCount` | `Promise<number>` -> `number` |
| `getQueuedTasks` | `Promise<SprintTask[]>` -> `SprintTask[]` |
| `getOrphanedTasks` | `Promise<SprintTask[]>` -> `SprintTask[]` |
| `clearSprintTaskFk` | `Promise<void>` -> `void` |
| `getHealthCheckTasks` | `Promise<SprintTask[]>` -> `SprintTask[]` |
| `getTasksWithDependencies` | `Promise<Array<...>>` -> `Array<...>` |

## Caller Updates

### IPC Handlers (sprint-local.ts)

~15 handlers drop `async/await`. Electron's `ipcMain.handle()` accepts sync return values — `safeHandle()` wrappers don't change.

```typescript
// Before
safeHandle('sprint:list', async () => listTasks())
// After
safeHandle('sprint:list', () => listTasks())
```

### Queue API Handlers (task-handlers.ts)

Same mechanical change — drop `async/await`, call sync functions directly. HTTP server runs on main thread; SQLite calls are sub-ms for single-row ops.

### Repository Interface (sprint-task-repository.ts)

All 7 methods change from `Promise<T>` to `T`:

```typescript
export interface ISprintTaskRepository {
  getTask(id: string): SprintTask | null
  updateTask(id: string, patch: Record<string, unknown>): SprintTask | null
  getQueuedTasks(limit: number): SprintTask[]
  getTasksWithDependencies(): Array<{ id: string; depends_on: TaskDependency[] | null; status: string }>
  getOrphanedTasks(claimedBy: string): SprintTask[]
  getActiveTaskCount(): number
  claimTask(id: string, claimedBy: string): SprintTask | null
}
```

Ripples into agent manager files that consume the repository: `run-agent.ts`, `index.ts`, `completion.ts`, `dependency-helpers.ts`, `resolve-dependents.ts`. All mechanical `await` removal.

### Sprint PR Poller (sprint-pr-poller.ts)

Calls to `listTasksWithOpenPrs`, `markTaskDoneByPrNumber`, etc. become sync. The 60s `setInterval` callback executes inline instead of awaiting.

## Cleanup & Removal

### Files Deleted

- `src/main/data/supabase-client.ts`

### Dependency Removed

- `@supabase/supabase-js` from `package.json`

### Onboarding Changes

- Remove `supabaseConnected` check from onboarding flow (was already optional/warning-only)
- `supabase.url` and `supabase.serviceKey` settings can remain in the settings table (inert)

### File Watcher Benefit

With sprint tasks back in SQLite, the `bde.db` file watcher (`bootstrap.ts`) naturally fires `sprint:externalChange` when tasks change — the notification gap that existed with Supabase is gone. The IPC notification added in `notifySprintMutation` (`sprint-listeners.ts`) stays for instant notification (fires before the 500ms file watcher debounce).

### Documentation Updates

- Update CLAUDE.md architecture notes: sprint_tasks in local SQLite, not Supabase
- Remove "Four writers to sprint_tasks" — now BDE + Queue API only
- Remove Supabase setup instructions from gotchas
- Update onboarding prerequisites

## Files Changed

| File | Change |
|------|--------|
| `src/main/db.ts` | Add migration v15 |
| `src/main/data/sprint-queries.ts` | Rewrite all 19 query functions (Supabase -> SQLite, async -> sync) |
| `src/main/data/sprint-task-repository.ts` | Interface + impl: Promise<T> -> T |
| `src/main/data/supabase-client.ts` | DELETE |
| `src/main/handlers/sprint-local.ts` | Drop async/await on ~15 handlers |
| `src/main/queue-api/task-handlers.ts` | Drop async/await on HTTP handlers |
| `src/main/agent-manager/index.ts` | Drop await on repository calls |
| `src/main/agent-manager/run-agent.ts` | Drop await on repository calls |
| `src/main/agent-manager/completion.ts` | Drop await on repository calls |
| `src/main/agent-manager/dependency-helpers.ts` | Drop await on repository calls |
| `src/main/agent-manager/resolve-dependents.ts` | Drop await on repository calls; update function parameter types from `Promise<T>` to `T` |
| `src/main/sprint-pr-poller.ts` | Drop async/await; update `SprintPrPollerDeps` parameter types from `Promise<T>` to `T` |
| `src/main/agent-history.ts` | Drop await if it calls sprint-queries |
| `src/main/handlers/workbench.ts` | Replace `getSupabaseClient()` conflict-check query with `listTasks()` from sprint-queries |
| `src/main/queue-api/field-mapper.ts` | Update `toSnakeCase()`: `JSON.stringify()` JSONB fields before write (Supabase auto-serialized, SQLite does not) |
| `package.json` | Remove @supabase/supabase-js |
| Tests (7+ files) | Swap Supabase mocks for SQLite/getDb mocks |
| `CLAUDE.md` | Update architecture notes |

## Testing Strategy

- Existing unit tests rewritten to mock `getDb()` instead of Supabase client
- Integration tests (`sprint-ipc.test.ts`) use `:memory:` SQLite DB with migrations applied
- `claimTask` atomicity: test concurrent claims to verify only one succeeds
- Migration v15: test with and without Supabase creds configured
- All existing `npm test` and `npm run test:main` must pass

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Data loss during migration | Low | One-time Supabase import; empty table if creds missing |
| Blocking event loop on large queries | Low | SQLite sub-ms for single-row; `listTasks()` is the heaviest, still fast for <1000 tasks |
| Life OS / chat-service lose write access | Expected | They route through Queue API; document this as the contract |
| Concurrent claim races | Low | SQLite atomic WHERE clause + WAL mode + busy_timeout |
