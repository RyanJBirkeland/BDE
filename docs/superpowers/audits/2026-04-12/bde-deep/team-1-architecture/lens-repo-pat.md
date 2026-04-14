# Repository Pattern Gap Audit — BDE Sprint Task Data Access

**Audit Date:** 2026-04-12
**Scope:** Repository abstraction coverage, direct sprint-queries imports, transaction boundaries, and SQLite access patterns
**Methodology:** Full codebase scan for ISprintTaskRepository compliance and architectural bypass detection

## Executive Summary

The BDE codebase has a well-designed repository abstraction (`ISprintTaskRepository`) with three domain-specific sub-interfaces (IAgentTaskRepository, ISprintPollerRepository, IDashboardRepository) that collectively define ~18 public operations. The agent manager receives the repository via constructor injection correctly, and most IPC handlers delegate appropriately through the service layer.

However, the architecture has strategic bypasses that are intentional but create three classes of risk:

1. **Justified thin-wrapper bypasses** (sprint-local.ts, bootstrap.ts cleanup) — acceptable per design
2. **Unencapsulated transaction boundaries** — business logic spread across `sprint-queries.ts` and `task-group-queries.ts` without repository-level transaction guarantees
3. **Incomplete interface coverage** — reporting operations (`getFailureReasonBreakdown`) exported from repository but not included in the interface, forcing clients to re-import from sprint-task-repository

The interface is complete for agent pipeline and dashboard needs. Multi-step operations are atomic within individual functions (transactions wrapping read-validate-update), but there are no cross-entity transaction APIs for workflows involving both tasks and task groups.

---

## Findings

### F-t1-repo-pat-1: Repository Does Not Expose Multi-Entity Transactions

**Severity:** Medium  
**Category:** Repository Pattern  
**Location:** `src/main/data/sprint-task-repository.ts:94-130`, `src/main/services/workflow-engine.ts:10-55`

**Evidence:**

The workflow engine instantiates multiple tasks in sequence:
```typescript
// src/main/services/workflow-engine.ts:46
const task = repo.createTask(input)
if (!task) {
  errors.push(`Step ${i}: createTask failed for "${step.title}"`)
  break
}
created.push(task)
```

Each `createTask()` call is atomic in isolation (single transaction inside sprint-queries.ts:364), but if the 5th task creation fails after the 4th succeeds, the workflow has a partial result and no way to roll back previous tasks or ensure consistent state. The repository interface offers no transaction context API to wrap multiple operations.

**Impact:**

- Workflows that fail mid-sequence leave partial task pipelines in the database
- No atomic "create all or none" semantics
- Clients must implement their own cleanup logic if a workflow partially fails
- Audit trail (task_changes) records each task independently with no transaction ID linking them

**Recommendation:**

Add a method to the repository for multi-operation atomicity:
```typescript
transactional<T>(fn: (txRepo: ISprintTaskRepository) => T): T
```
This allows clients like workflow-engine to wrap `createTask()` calls in a single database transaction that rolls back on any failure.

**Effort:** M  
**Confidence:** High

---

### F-t1-repo-pat-2: Reporting Operations Exported from Repository Interface But Not Defined in It

**Severity:** High  
**Category:** Repository Pattern  
**Location:** `src/main/data/sprint-task-repository.ts:31-34`, `src/main/handlers/sprint-local.ts:245-246`

**Evidence:**

The repository exports `getFailureReasonBreakdown` at module level:
```typescript
export { getFailureReasonBreakdown } from './reporting-queries'
```

But `getFailureReasonBreakdown` is NOT a method on `ISprintTaskRepository` — it's only available as a named export. The IPC handler is forced to import it separately:
```typescript
safeHandle('sprint:failureBreakdown', async () => {
  const { getFailureReasonBreakdown } = await import('../data/sprint-task-repository')
  return getFailureReasonBreakdown()
})
```

This breaks the abstraction: callers accessing reporting data must know to look in the repository module for re-exports, not just the interface. The interface claims to provide `IDashboardRepository`, which includes `getDailySuccessRate()` and `getSuccessRateBySpecType()`, but `getFailureReasonBreakdown()` is missing from the interface definition.

**Impact:**

- Inconsistent interface coverage — some reporting methods are interface methods, others are module-level re-exports
- Tests mocking `ISprintTaskRepository` cannot mock `getFailureReasonBreakdown` without accessing sprint-task-repository directly
- New developers cannot discover the reporting API by reading the interface
- IPC handlers must import from the implementation module rather than the abstraction

**Recommendation:**

Add `getFailureReasonBreakdown()` to `IDashboardRepository`:
```typescript
export interface IDashboardRepository {
  // ... existing methods ...
  getFailureReasonBreakdown(): FailureReasonBreakdown[]
}
```

Then update the factory to delegate:
```typescript
getFailureReasonBreakdown: reportingQueries.getFailureReasonBreakdown
```

Remove the module-level re-export to force all callers through the interface.

**Effort:** S  
**Confidence:** High

---

### F-t1-repo-pat-3: Task Group Operations Bypass Repository Entirely

**Severity:** Medium  
**Category:** Repository Pattern  
**Location:** `src/main/index.ts:36`, `src/main/data/task-group-queries.ts:*`

**Evidence:**

Task group operations are accessed directly from task-group-queries without going through the repository:
```typescript
// src/main/index.ts:36
import { getGroup, getGroupTasks, getGroupsWithDependencies } from './data/task-group-queries'
```

These same operations ARE delegated by the repository (sprint-task-repository.ts:110-112):
```typescript
getGroup: groupQueries.getGroup,
getGroupTasks: groupQueries.getGroupTasks,
getGroupsWithDependencies: groupQueries.getGroupsWithDependencies
```

But the startup code imports them directly, and the main entry point calls them directly rather than extracting them from the repository instance.

**Impact:**

- Inconsistent code patterns: some callers use repo, others use direct imports
- New developers cannot determine whether to use the repository or direct imports
- If task group operations are later replaced with remote APIs or cached versions, multiple callsites must be updated
- No single point to inject mock group operations for testing

**Recommendation:**

In `src/main/index.ts`, change:
```typescript
import { getGroup, getGroupTasks, getGroupsWithDependencies } from './data/task-group-queries'
```
to:
```typescript
const repo = createSprintTaskRepository()
// Use repo.getGroup, repo.getGroupTasks, repo.getGroupsWithDependencies
```

**Effort:** S  
**Confidence:** High

---

### F-t1-repo-pat-4: Bootstrap Cleanup Uses Raw SQLite to Delete Test Tasks

**Severity:** Low  
**Category:** Repository Pattern  
**Location:** `src/main/bootstrap.ts:150-159`

**Evidence:**

```typescript
try {
  const db = getDb()
  const result = db.prepare("DELETE FROM sprint_tasks WHERE title LIKE 'Test task%'").run()
  if (result.changes > 0) {
    logger.info(`Cleaned ${result.changes} test task artifacts`)
  }
} catch {
  /* non-fatal */
}
```

This is documented as intentional (the module header in CLAUDE.md notes "task-validation.ts, bootstrap.ts are documented bypass sites"), but it's a direct `db.prepare()` call for a domain operation that could be expressed via the repository.

**Impact:**

- Bypasses audit trail — no `task_changes` record of these deletions
- If test task detection logic becomes more sophisticated, it won't be co-located with the repository
- Inconsistent with the broader pattern of using the repository for data mutations

**Recommendation:**

Consider adding a repository method:
```typescript
deleteTestTaskArtifacts(): number
```

Alternatively, document this as a documented maintenance-only exception (one-off cleanup at startup that intentionally avoids audit trail). The current approach is acceptable for startup-time cleanup, but if this pattern repeats in other contexts, formalize it.

**Effort:** S (if accepted as documented bypass), M (if formalizing via repository)  
**Confidence:** Medium

---

### F-t1-repo-pat-5: Supabase Import Accesses Sprint Tasks Table Directly Without Abstraction

**Severity:** Medium  
**Category:** Repository Pattern  
**Location:** `src/main/data/supabase-import.ts:57-72, 147-190`

**Evidence:**

The Supabase import is a one-time migration that reads the count of existing tasks and bulk-inserts from Supabase:
```typescript
const countRow = db.prepare('SELECT COUNT(*) as cnt FROM sprint_tasks').get() as {
  cnt: number
}

const importAll = db.transaction((tasks: SupabaseSprintTaskRow[]) => {
  const stmt = db.prepare(
    `INSERT INTO sprint_tasks (...) VALUES (...) RETURNING *`
  )
  // Bulk insert
})
```

This is a historical migration (noted in CLAUDE.md as "scheduled for removal before public release"), but it directly accesses the schema without repository abstraction.

**Impact:**

- Couples migration logic to the current schema
- If sprint_tasks schema changes, this migration must be updated alongside schema migration files
- No abstraction to support testing or schema versioning

**Recommendation:**

This is scheduled for removal, so leave as-is. When removed, there's no further action needed. If this pattern appears in other migrations, formalize it as a migration-specific bypass (migrations operate below the abstraction layer by definition).

**Effort:** S  
**Confidence:** Medium

---

### F-t1-repo-pat-6: Agent Manager Constructor Injection Works Correctly, But Tests Mock Sprint-Queries Directly

**Severity:** Medium  
**Category:** Repository Pattern / Testability  
**Location:** `src/main/agent-manager/index.ts:158-162`, `src/main/agent-manager/__tests__/index.test.ts:102-114`

**Evidence:**

The constructor injection is correct:
```typescript
constructor(
  config: AgentManagerConfig,
  readonly repo: ISprintTaskRepository,
  readonly logger: Logger = defaultLogger
)
```

But tests still import and mock sprint-queries directly:
```typescript
// src/main/agent-manager/__tests__/index.test.ts:102
import {
  getTask,
  updateTask,
  getQueuedTasks,
  // ...
} from '../../data/sprint-queries'

vi.mock('../../data/sprint-queries', () => ({
  // ... mocks ...
}))
```

This defeats the purpose of the repository abstraction. Tests should mock the repository interface, not the implementation.

**Impact:**

- Tests are brittle to changes in sprint-queries implementation
- Test setup is verbose (mocking 10+ functions individually)
- If sprint-queries functions are refactored, tests break even if the repository interface is unchanged
- New developers cannot learn the proper testing pattern from existing tests

**Recommendation:**

Create a test helper to mock the repository interface:
```typescript
// src/main/agent-manager/__tests__/mock-repo.ts
export function createMockRepository(overrides?: Partial<ISprintTaskRepository>): ISprintTaskRepository {
  return {
    getTask: vi.fn(),
    updateTask: vi.fn(),
    getQueuedTasks: vi.fn(),
    // ... rest with sensible defaults
    ...overrides
  }
}
```

Then update tests:
```typescript
const mockRepo = createMockRepository({
  getQueuedTasks: vi.fn().mockReturnValue([/* test data */])
})
const am = new AgentManagerImpl(config, mockRepo)
```

**Effort:** M  
**Confidence:** High

---

### F-t1-repo-pat-7: Report Queries Logger Separate from Repository Logger

**Severity:** Low  
**Category:** Repository Pattern  
**Location:** `src/main/data/reporting-queries.ts:19-21`, `src/main/data/sprint-queries.ts:41-43`

**Evidence:**

Both sprint-queries and reporting-queries define module-level loggers independently:
```typescript
// sprint-queries.ts
export function setSprintQueriesLogger(l: Logger): void {
  logger = l
}

// reporting-queries.ts
export function setReportingQueriesLogger(l: Logger): void {
  logger = l
}
```

The startup code sets only sprint-queries logger:
```typescript
// src/main/index.ts:144
setSprintQueriesLogger(logger)
```

Reporting-queries continues to log to console.

**Impact:**

- Reporting query failures are not captured in the structured log system
- Debugging reporting issues requires monitoring console output separately
- Inconsistent logging configuration across data access modules

**Recommendation:**

Either:
1. Call both setters at startup:
   ```typescript
   import { setReportingQueriesLogger } from './data/reporting-queries'
   const logger = createLogger('agent-manager')
   setSprintQueriesLogger(logger)
   setReportingQueriesLogger(logger)
   ```

2. Or merge reporting-queries logger initialization into the repository's logger-setting function.

**Effort:** S  
**Confidence:** Medium

---

## Coverage Assessment

### ✅ Well-Covered Interfaces

- **IAgentTaskRepository** — 11 methods: used by agent-manager via constructor injection, atomic per-operation transactions, all methods delegated correctly
- **ISprintPollerRepository** — 3 methods: used by sprint-pr-poller, all transactional
- **IDashboardRepository** (mostly) — 11 of 12 methods properly encapsulated; `getFailureReasonBreakdown()` is the exception (see F-t1-repo-pat-2)

### ⚠️ Partial Coverage

- **Multi-entity transactions** — no repository-level API for workflows to atomically create multiple tasks
- **Task groups** — interface methods exist but callers import directly in some contexts
- **Reporting** — one method (`getFailureReasonBreakdown`) breaks the interface export pattern

### ✅ Justified Bypasses (Per Design)

- **IPC handlers (sprint-local.ts)** — intentionally thin; they validate and delegate to services
- **Bootstrap cleanup** — one-time startup maintenance, explicitly documented
- **Migrations** — operate at the schema level, bypass by design

---

## Transaction Boundary Analysis

All single-entity operations use `db.transaction()` correctly:

1. **claimTask()** (sprint-queries.ts:486-533) — Atomic WIP check + claim + audit in one transaction ✅
2. **updateTask()** (sprint-queries.ts:355-455) — Atomic read-validate-update + audit in one transaction ✅
3. **releaseTask()** (sprint-queries.ts:535-571) — Atomic update + audit in one transaction ✅
4. **deleteTask()** (sprint-queries.ts:457-477) — Atomic delete + audit in one transaction ✅
5. **markTaskDoneByPrNumber()** (sprint-queries.ts:748-762) — Multi-task transitions in one transaction ✅
6. **reorderGroupTasks()** (task-group-queries.ts:251-273) — Bulk reorder in one transaction ✅

**Gaps:** No repository-level transaction context for multi-entity operations. Workflow instantiation is the primary use case (F-t1-repo-pat-1).

---

## Recommendation Summary

| Finding | Priority | Effort | Type | Status |
|---------|----------|--------|------|--------|
| F-t1-repo-pat-1 | High | M | Add multi-entity transaction API | Backlog |
| F-t1-repo-pat-2 | High | S | Add `getFailureReasonBreakdown` to interface | Quick fix |
| F-t1-repo-pat-3 | Medium | S | Import task group ops via repository in startup | Quick fix |
| F-t1-repo-pat-4 | Low | S | Document or formalize cleanup bypass | Documentation |
| F-t1-repo-pat-5 | Low | S | Remove (scheduled) or document | No action (removal pending) |
| F-t1-repo-pat-6 | Medium | M | Add test helpers to mock repository | Testing infra |
| F-t1-repo-pat-7 | Low | S | Set reporting queries logger at startup | Quick fix |

---

## Conclusion

The repository abstraction is well-designed and mostly well-applied. The agent manager correctly receives the repository via constructor injection, enabling testability. The three sub-interfaces cleanly separate concerns (pipeline, PR polling, dashboard).

The primary architectural debt is **incomplete interface coverage** (F-t1-repo-pat-2) and **missing multi-entity transaction APIs** (F-t1-repo-pat-1). Fixes are straightforward and low-risk. The documented bypasses in bootstrap and IPC handlers are appropriately scoped and intentional.

The abstraction successfully isolates sprint-queries from most of the codebase, with only 6 direct imports outside of sprint-task-repository and core data layer modules. This is a strong foundation for future refactoring (e.g., remote APIs, caching layers).

