# SQLite Sprint Tasks Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move sprint tasks from Supabase back to local SQLite (`~/.bde/bde.db`), making BDE fully self-contained.

**Architecture:** Rewrite `sprint-queries.ts` from async Supabase client to sync `better-sqlite3`. Add migration v15 to recreate `sprint_tasks` table with one-time Supabase import. Remove `@supabase/supabase-js` dependency. All callers drop `async/await`.

**Tech Stack:** better-sqlite3 (already used), TypeScript strict mode, vitest

**Spec:** `docs/superpowers/specs/2026-03-26-sqlite-sprint-tasks-design.md`

**Worktree:** `~/worktrees/bde/feat-sqlite-sprint-tasks` (branch: `feat/sqlite-sprint-tasks`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/db.ts` | Modify | Add migration v15 (create table + Supabase import) |
| `src/main/data/supabase-import.ts` | Create | One-time async Supabase import at startup |
| `src/main/data/sprint-queries.ts` | Rewrite | All 19 query functions: Supabase to SQLite, async to sync |
| `src/main/data/sprint-task-repository.ts` | Modify | Interface + impl: `Promise<T>` to `T` |
| `src/main/data/supabase-client.ts` | Delete | No longer needed |
| `src/main/handlers/sprint-local.ts` | Modify | Drop async/await on wrappers + handlers |
| `src/main/handlers/workbench.ts` | Modify | Replace `getSupabaseClient()` query with `listTasks()` |
| `src/main/queue-api/task-handlers.ts` | Modify | Drop async/await |
| `src/main/queue-api/field-mapper.ts` | Modify | `JSON.stringify()` for depends_on in `toSnakeCase()` |
| `src/main/agent-manager/index.ts` | Modify | Drop await on repo calls |
| `src/main/agent-manager/run-agent.ts` | Modify | Drop await on repo.updateTask |
| `src/main/agent-manager/completion.ts` | Modify | Drop await on repo.updateTask |
| `src/main/agent-manager/dependency-helpers.ts` | Modify | `checkTaskDependencies` sync, drop await on `listTasks` |
| `src/main/agent-manager/resolve-dependents.ts` | Modify | Function params + body: `Promise<T>` to `T` |
| `src/main/agent-manager/orphan-recovery.ts` | Modify | Drop await on repo calls |
| `src/main/sprint-pr-poller.ts` | Modify | `SprintPrPollerDeps` types + body: `Promise<T>` to `T` |
| `src/main/agent-history.ts` | Modify | Drop `await` on `clearSprintTaskFk` (becomes sync after Task 2) |
| `package.json` | Modify | Remove `@supabase/supabase-js` |
| Tests (multiple) | Modify | Swap Supabase mocks for `getDb` mocks |

---

## Task 1: Migration v15 — Recreate sprint_tasks Table

**Files:**
- Modify: `src/main/db.ts` (append to migrations array)
- Create: `src/main/data/supabase-import.ts`
- Create: `src/main/data/__tests__/migration-v15.test.ts`

- [ ] **Step 1: Write failing test for migration v15**

Create `src/main/data/__tests__/migration-v15.test.ts` with tests for:
- Table creation with all expected columns (id, title, status, depends_on, playground_enabled, needs_review, max_runtime_ms, claimed_by)
- All 8 valid statuses accepted (backlog, queued, blocked, active, done, cancelled, failed, error)
- Invalid status rejected by CHECK constraint
- Auto-generated id and timestamps via DEFAULT expressions

Use `new Database(':memory:')` and apply all migrations.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npx vitest run src/main/data/__tests__/migration-v15.test.ts --config src/main/vitest.main.config.ts`
Expected: FAIL — sprint_tasks table doesn't exist (dropped in v12)

- [ ] **Step 3: Write migration v15 in db.ts**

Add to the `migrations` array. Creates the table with:
- Full column set matching `SprintTask` type in `src/shared/types.ts`
- `blocked` status in CHECK constraint (wasn't in original v6-v10)
- Indexes on `status`, `claimed_by`, `pr_number`
- `updated_at` trigger
- `depends_on` as TEXT (JSON string), `playground_enabled`/`needs_review` as INTEGER

- [ ] **Step 4: Create supabase-import.ts**

Create `src/main/data/supabase-import.ts` — async one-time import function:
- Only runs if local `sprint_tasks` table is empty
- Reads `supabase.url` and `supabase.serviceKey` from settings table via `getSetting()`
- Uses raw `fetch()` to `{url}/rest/v1/sprint_tasks?select=*`
- Uses `INSERT OR IGNORE` for idempotency
- Handles type mapping: `depends_on` JSON stringify, boolean to 0/1, null prompt to ''
- Logs result via `createLogger('supabase-import')`
- Silent no-op if creds missing or fetch fails

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npx vitest run src/main/data/__tests__/migration-v15.test.ts --config src/main/vitest.main.config.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks
git add src/main/db.ts src/main/data/supabase-import.ts src/main/data/__tests__/migration-v15.test.ts
git commit -m "feat: add migration v15 — recreate sprint_tasks in SQLite with Supabase import"
```

---

## Task 2: Rewrite sprint-queries.ts (Supabase to SQLite)

**Files:**
- Rewrite: `src/main/data/sprint-queries.ts`
- Rewrite: `src/main/data/__tests__/sprint-queries.test.ts`

- [ ] **Step 1: Write failing tests for key sync functions**

Rewrite `src/main/data/__tests__/sprint-queries.test.ts`. Mock `getDb` to return an in-memory SQLite DB with all migrations applied. Test cases:

- `createTask` returns task with generated id
- `getTask` returns null for missing id, returns created task
- `listTasks` sorts by priority then created_at, filters by status
- `updateTask` updates fields and returns updated task
- `deleteTask` removes the task
- `claimTask` atomically sets status to active, returns null if not queued
- `releaseTask` resets status to queued
- `getQueueStats` returns correct GROUP BY counts
- `getActiveTaskCount` returns count, returns Infinity on error
- Boolean fields (`playground_enabled`, `needs_review`) coerced to true/false on read
- `depends_on` serialized as JSON string on write, deserialized on read
- `markTaskDoneByPrNumber` transitions active tasks to done, sets pr_status to merged
- `markTaskCancelledByPrNumber` transitions active tasks to cancelled

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npx vitest run src/main/data/__tests__/sprint-queries.test.ts --config src/main/vitest.main.config.ts`
Expected: FAIL — sprint-queries still imports Supabase

- [ ] **Step 3: Rewrite sprint-queries.ts**

Replace entire file. Key patterns:
- Import `getDb` from `../db` instead of `getSupabaseClient`
- All functions sync (drop `async`, return `T` not `Promise<T>`)
- `sanitizeTask()` adds: `playground_enabled: !!row.playground_enabled`, `needs_review: !!row.needs_review`, plus existing `sanitizeDependsOn()` for `depends_on`
- `createTask()`: `JSON.stringify()` for `depends_on`, `value ? 1 : 0` for booleans
- `updateTask()`: same serialization, record audit trail via sync import of `recordTaskChanges()`
- `getQueueStats()`: `SELECT status, COUNT(*) as count FROM sprint_tasks GROUP BY status`
- `getActiveTaskCount()`: wrap in try/catch, return `Infinity` on error (fail-closed)
- `markTaskDoneByPrNumber()` / `markTaskCancelledByPrNumber()`: wrap in `db.transaction()`
- `claimTask()`: `WHERE id = ? AND status = 'queued'` atomic conditional update
- `releaseTask()`: `WHERE id = ? AND status = 'active' AND claimed_by = ?`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npx vitest run src/main/data/__tests__/sprint-queries.test.ts --config src/main/vitest.main.config.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks
git add src/main/data/sprint-queries.ts src/main/data/__tests__/sprint-queries.test.ts
git commit -m "feat: rewrite sprint-queries from Supabase to SQLite (sync)"
```

---

## Task 3: Update Repository Interface (sync)

**Files:**
- Modify: `src/main/data/sprint-task-repository.ts`
- Modify: `src/main/agent-manager/resolve-dependents.ts`
- Modify: `src/main/agent-manager/dependency-helpers.ts`
- Modify: `src/main/agent-manager/orphan-recovery.ts`
- Modify: `src/main/agent-manager/run-agent.ts`
- Modify: `src/main/agent-manager/completion.ts`
- Modify: `src/main/agent-manager/index.ts`

- [ ] **Step 1: Update ISprintTaskRepository interface**

All 7 methods: `Promise<T>` to `T`. `createSprintTaskRepository()` directly assigns sync sprint-queries functions.

- [ ] **Step 2: Update resolve-dependents.ts**

Change function signature — `getTask` and `updateTask` params become sync return types. Function itself becomes sync (`void` not `Promise<void>`). Remove all `await` in the body.

- [ ] **Step 3: Update dependency-helpers.ts**

`checkTaskDependencies`: drop `async`, `await listTasks()` becomes `listTasks()`. Return type: direct object not `Promise`.

- [ ] **Step 4: Update orphan-recovery.ts**

Drop `await` on `repo.getOrphanedTasks()` and `repo.updateTask()`.

- [ ] **Step 5: Update run-agent.ts**

Drop `await` on `repo.updateTask(task.id, ...)` (~line 141).

- [ ] **Step 6: Update completion.ts**

Drop `await` on all `repo.updateTask(taskId, ...)` calls (~lines 304, 307, 319, 327).

- [ ] **Step 7: Update agent-manager/index.ts**

Drop `await` on: `resolveDependents(...)` (~line 240), `repo.updateTask(...)` (~line 342), `repo.getTasksWithDependencies()` (~line 381).

- [ ] **Step 8: Run agent manager tests**

Run: `cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/`
Expected: May fail due to mock changes — fix in Task 6

- [ ] **Step 9: Commit**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks
git add src/main/data/sprint-task-repository.ts src/main/agent-manager/
git commit -m "feat: sync repository interface + agent manager callers"
```

---

## Task 4: Update IPC Handlers + Sprint PR Poller

**Files:**
- Modify: `src/main/handlers/sprint-local.ts`
- Modify: `src/main/handlers/workbench.ts`
- Modify: `src/main/sprint-pr-poller.ts`
- Modify: `src/main/agent-history.ts`

- [ ] **Step 1: Update sprint-local.ts**

Thin wrappers (lines 45-101): drop `async`, return values directly. `notifySprintMutation` calls stay.

Handler registrations: drop `async` where the handler body only calls sync functions.

**Keep async on these handlers** (they have genuinely async operations):
- `sprint:update` — uses `await import('../spec-semantic-check')` and `await checkSpecSemantic()`
- `sprint:generatePrompt` — calls `await generatePrompt()` (spawns CLI)
- `sprint:readLog` — calls `await readLog()` (file I/O)

Update comment on line 45: remove "Supabase" reference.

- [ ] **Step 2: Update workbench.ts**

Replace `import { getSupabaseClient } from '../data/supabase-client'` with `import { listTasks } from '../data/sprint-queries'`.

Replace the Supabase query (~lines 223-231) with a sync `listTasks()` call filtered in JS:
```typescript
const tasks = listTasks()
const conflicting = tasks.filter(t => t.repo === repo && ['active', 'queued'].includes(t.status))
```

- [ ] **Step 3: Update sprint-pr-poller.ts**

`SprintPrPollerDeps` interface: sprint-task functions become sync return types. `pollPrStatuses` stays `Promise` (GitHub API). `onTaskTerminal` becomes sync.

`poll()` function stays `async` (because `pollPrStatuses` is async). Drop `await` on sync calls only.

- [ ] **Step 4: Update agent-history.ts**

Line ~215: drop `await` on `clearSprintTaskFk()`. Update comment to remove "Supabase" reference.

- [ ] **Step 5: Run typecheck**

Run: `cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npm run typecheck`
Expected: PASS (or only pre-existing errors in untracked test files)

- [ ] **Step 6: Commit**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks
git add src/main/handlers/sprint-local.ts src/main/handlers/workbench.ts src/main/sprint-pr-poller.ts src/main/agent-history.ts
git commit -m "feat: sync IPC handlers, PR poller, and agent-history callers"
```

---

## Task 5: Update Queue API Handlers + Field Mapper

**Files:**
- Modify: `src/main/queue-api/task-handlers.ts`
- Modify: `src/main/queue-api/field-mapper.ts`

- [ ] **Step 1: Update field-mapper.ts**

In `toSnakeCase()`: add `JSON.stringify()` for JSONB fields when value is an array/object. Remove the comment about Supabase auto-serialization.

**Important:** `sprint-queries.ts` already handles `depends_on` serialization internally (via `sanitizeDependsOn()` + `JSON.stringify()`). The Queue API's `toSnakeCase()` runs BEFORE the data reaches sprint-queries when the Queue API builds patch objects. So `toSnakeCase` should stringify — sprint-queries' `updateTask` will see a string and pass it through. Verify no double-stringification: `sanitizeDependsOn()` should handle both string and array inputs (it already does — it parses strings and returns arrays, and `updateTask` stringifies the result).

In `toCamelCase()`: already handles JSON parsing via `JSONB_FIELDS` set — verify it works for SQLite TEXT columns (it should, since it checks `typeof value === 'string'`).

- [ ] **Step 2: Update task-handlers.ts**

Drop `await` on all sprint-queries calls AND on `resolveDependents()` (called in `handleUpdateStatus` ~line 412 — this function is now sync after Task 3). HTTP handler functions may stay `async` if they call other async functions (like GitHub API calls). Pattern: `await someSprintQuery(...)` becomes `someSprintQuery(...)`.

- [ ] **Step 3: Run typecheck**

Run: `cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks
git add src/main/queue-api/task-handlers.ts src/main/queue-api/field-mapper.ts
git commit -m "feat: sync Queue API handlers + fix field-mapper for SQLite"
```

---

## Task 6: Update Tests

**Files:**
- Modify: `src/main/handlers/__tests__/sprint-local.test.ts`
- Modify: `src/main/handlers/__tests__/workbench.test.ts` (mocks `supabase-client`)
- Modify: `src/main/agent-manager/__tests__/index.test.ts`
- Modify: `src/main/agent-manager/__tests__/completion.test.ts`
- Modify: `src/main/agent-manager/__tests__/dependency-helpers.test.ts`
- Modify: `src/main/agent-manager/__tests__/orphan-recovery.test.ts`
- Modify: `src/main/agent-manager/__tests__/resolve-dependents.test.ts` (signature changed to sync)
- Modify: `src/main/agent-manager/__tests__/run-agent.test.ts` (if it mocks repo)
- Modify: `src/main/agent-manager/__tests__/fast-fail.test.ts` (if it mocks repo)
- Modify: `src/main/agent-manager/__tests__/concurrency.test.ts` (if it mocks repo)
- Modify: `src/main/__tests__/integration/sprint-ipc.test.ts`
- Modify: `src/main/__tests__/integration/queue-api.test.ts` (if it mocks Supabase)

- [ ] **Step 1: Update sprint-local.test.ts**

Replace Supabase mock with `getDb()` mock or keep module-level `vi.mock('../data/sprint-queries')`. Update return values from `mockResolvedValue()` to `mockReturnValue()`.

- [ ] **Step 2: Update agent-manager test mocks**

All mock repositories: `mockResolvedValue(...)` becomes `mockReturnValue(...)` since `ISprintTaskRepository` is now sync.

Apply across: `index.test.ts`, `completion.test.ts`, `dependency-helpers.test.ts`, `orphan-recovery.test.ts`, `resolve-dependents.test.ts` (heavy use of `mockResolvedValue` for `getTask`/`updateTask` params), `run-agent.test.ts`, `fast-fail.test.ts`, `concurrency.test.ts`.

- [ ] **Step 2b: Update workbench.test.ts**

Remove mock of `supabase-client` module. The conflict check now uses `listTasks()` from sprint-queries — mock that instead.

- [ ] **Step 3: Update integration tests**

`sprint-ipc.test.ts` and `queue-api.test.ts`: replace Supabase module mocks with in-memory SQLite setup, or mock `getDb` to return test DB.

- [ ] **Step 4: Run full test suite**

Run: `cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npm test && npm run test:main`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks
git add src/main/handlers/__tests__/ src/main/agent-manager/__tests__/ src/main/__tests__/
git commit -m "test: update all mocks for sync SQLite sprint-queries"
```

---

## Task 7: Remove Supabase Dependency + Wire Import

**Files:**
- Delete: `src/main/data/supabase-client.ts`
- Modify: `package.json` (remove `@supabase/supabase-js`)
- Modify: `src/main/index.ts` (call `importFromSupabase()` at startup)

- [ ] **Step 1: Delete supabase-client.ts**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks && rm src/main/data/supabase-client.ts
```

- [ ] **Step 2: Remove @supabase/supabase-js**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npm uninstall @supabase/supabase-js
```

- [ ] **Step 3: Wire importFromSupabase() at startup**

In `src/main/index.ts`, after DB init / `getDb()` call and before agent manager startup:

```typescript
import { importFromSupabase } from './data/supabase-import'
// Fire-and-forget — doesn't block startup
importFromSupabase().catch(err => console.warn('[startup] Supabase import skipped:', err))
```

- [ ] **Step 4: Run typecheck + full tests**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npm run typecheck && npm test && npm run test:main
```
Expected: PASS

- [ ] **Step 5: Verify no dangling Supabase imports**

Search `src/` for any remaining references to `supabase-client`, `@supabase/supabase-js`, or `getSupabaseClient`. Exclude `supabase-import.ts` and test files. Expected: no matches.

- [ ] **Step 6: Commit**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks
git add -A
git commit -m "chore: remove Supabase dependency, wire one-time import at startup"
```

---

## Task 8: Documentation Updates

**Files:**
- Modify: `CLAUDE.md` (project root)

- [ ] **Step 1: Update CLAUDE.md**

Key changes:
- Data layer: "`sprint_tasks` lives in local SQLite alongside `agent_runs`, `settings`, etc."
- Remove: "Sprint tasks live in **Supabase**" from Architecture Notes
- Remove: "Four writers to sprint_tasks" — replace with "Two writers: BDE main process + Queue API (port 18790)"
- Remove: Supabase setup gotchas and onboarding prerequisites
- Update: Queue API description — it's now a local SQLite API server, not a "Supabase proxy"
- Update: Cross-Repo Contracts section — task runner uses Queue API, not direct Supabase

- [ ] **Step 2: Commit**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks
git add CLAUDE.md
git commit -m "docs: update architecture notes for SQLite sprint tasks"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run full CI checks**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks
npm run typecheck && npm test && npm run test:main && npm run build
```

All must pass.

- [ ] **Step 2: Run coverage check**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks && npm run test:coverage
```

Must meet thresholds: 72% stmts, 66% branches, 70% functions, 74% lines.

- [ ] **Step 3: Push branch**

```bash
cd ~/worktrees/bde/feat-sqlite-sprint-tasks && git push -u origin feat/sqlite-sprint-tasks
```
