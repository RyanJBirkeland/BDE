# DB Injection Seam

## Goal

Replace 23 direct `getDb()` calls in services and managers with constructor dependency injection, making services testable without SQLite initialization while keeping backward compatibility. Handlers remain unchanged.

## Why This Matters

Services currently call `getDb()` directly, forcing tests to either mock SQLite globally (fragile — `bootstrap.test.ts` requires 12+ `vi.mock()` statements) or hit a real database (slow, file I/O). Injecting `db: Database.Database` via constructor enables isolated unit tests, parallel test execution, and explicit dependency visibility.

**This is the highest-priority Wave 2 task** — it unblocks Tasks 1 and 2 (agent-manager split).

## Approach

**Additive, backward-compatible:** Add an optional `db?: Database.Database` parameter to service constructors. If not provided, falls back to `getDb()`. No breaking changes to bootstrap or IPC wiring.

- Services (`src/main/services/*.ts`, `src/main/agent-history.ts`, etc.) → receive `db` via constructor
- Data modules (`src/main/data/*.ts`) → accept `db` as function parameter
- Managers (`src/main/agent-event-persister.ts`, `adhoc-agent.ts`, etc.) → receive `db` via constructor
- **Handlers** (`src/main/handlers/*.ts`) → keep `getDb()` calls, no changes

## Call-site Inventory

**Data modules (add `db` parameter to exported functions):**
- `src/main/data/sprint-task-crud.ts`
- `src/main/data/sprint-pr-ops.ts`
- `src/main/data/sprint-agent-queries.ts`
- `src/main/data/sprint-maintenance.ts`
- `src/main/data/sprint-planning-queries.ts`
- `src/main/data/sprint-queue-ops.ts`
- `src/main/data/task-changes.ts`
- `src/main/data/task-group-queries.ts`
- `src/main/data/webhook-queries.ts`
- `src/main/data/dashboard-queries.ts`
- `src/main/data/reporting-queries.ts`

**Services (add optional `db` to constructor):**
- `src/main/agent-history.ts`
- `src/main/cost-queries.ts`
- `src/main/settings.ts`

**Managers (add optional `db` to constructor or init):**
- `src/main/agent-event-persister.ts`
- `src/main/agent-event-mapper.ts`
- `src/main/adhoc-agent.ts`
- `src/main/agent-manager/run-agent.ts`
- `src/main/agent-manager/turn-tracker.ts`

**Entry points (wire `db` instance):**
- `src/main/bootstrap.ts` — pass db to `setupCleanupTasks()`
- `src/main/index.ts` — pass db to service constructors

**DO NOT CHANGE:**
- `src/main/handlers/*.ts` — keep `getDb()` calls
- `src/main/db.ts` — keep existing `getDb()` singleton; only export `Database` type if not already exported

## Implementation Steps

1. **Verify `Database` type export** in `src/main/db.ts` — confirm `Database.Database` is importable; add named export if missing.

2. **Update data modules** — for each file in the data modules list, add `db: Database.Database` as first parameter to all exported functions. Internal helpers thread `db` through. No default value (caller always provides).

3. **Update services** — for each service file, add `private db: Database.Database` to the class, initialized from constructor parameter defaulting to `getDb()`:
   ```typescript
   constructor(db: Database.Database = getDb()) {
     this.db = db
   }
   ```
   Replace all `getDb()` calls in the class with `this.db`.

4. **Update managers** — same pattern as services. For module-level (non-class) managers, add `db?: Database.Database` to the exported function/factory and default to `getDb()`.

5. **Wire entry points** — in `src/main/index.ts`, call `getDb()` once and pass the instance to service constructors. In `src/main/bootstrap.ts`, pass db to `setupCleanupTasks()`.

6. **Verify handlers unchanged** — after all edits, grep confirms no handler files were modified.

## Files to Change

**Modify (data modules — 11 files):**
`src/main/data/sprint-task-crud.ts`, `sprint-pr-ops.ts`, `sprint-agent-queries.ts`, `sprint-maintenance.ts`, `sprint-planning-queries.ts`, `sprint-queue-ops.ts`, `task-changes.ts`, `task-group-queries.ts`, `webhook-queries.ts`, `dashboard-queries.ts`, `reporting-queries.ts`

**Modify (services — 3 files):**
`src/main/agent-history.ts`, `src/main/cost-queries.ts`, `src/main/settings.ts`

**Modify (managers — 5 files):**
`src/main/agent-event-persister.ts`, `src/main/agent-event-mapper.ts`, `src/main/adhoc-agent.ts`, `src/main/agent-manager/run-agent.ts`, `src/main/agent-manager/turn-tracker.ts`

**Modify (entry points — 2 files):**
`src/main/bootstrap.ts`, `src/main/index.ts`

**Do NOT modify:** any file in `src/main/handlers/`

## How to Test

1. **Unit tests for services** — create `mockDb` with `{ prepare: vi.fn(() => ({ all: vi.fn(), get: vi.fn(), run: vi.fn() })) }`, pass to constructor, assert correct SQL methods called without touching disk.

2. **bootstrap.test.ts gotcha** — if you import a new module in `bootstrap.ts`, you MUST add `vi.mock('../new-module')` at the top of `bootstrap.test.ts`. Missing mocks cause ALL tests in the file to fail with "not a function" errors. Check the file for existing mock patterns.

3. **Integration tests** — `bootstrap.ts` and handler tests pass unchanged (handlers still call `getDb()` directly).

4. **Smoke test** — start app with `npm run dev`, verify startup succeeds, create a sprint task, verify no runtime errors in `~/.bde/bde.log`.

```bash
npm run typecheck && npm test && npm run test:main
```

Confirm no handler files changed:
```bash
git diff --name-only src/main/handlers/
# should be empty
```
