# Abstraction Coupling Audit — BDE Architecture
**Date:** 2026-04-13  
**Scope:** Abstraction layer violations, circular dependencies, leaking internals, tight coupling

---

## F-t1-coupling-1: Private Query Functions Re-exported Through Repository Interface
**Severity:** High
**Category:** Abstraction Coupling
**Location:** `src/main/data/sprint-task-repository.ts:30-34`

**Evidence:**
```typescript
// Line 30-34
export { UPDATE_ALLOWLIST } from './sprint-queries'
export { pruneOldDiffSnapshots, DIFF_SNAPSHOT_RETENTION_DAYS } from './sprint-queries'
export { clearSprintTaskFk } from './sprint-queries'
export { getFailureReasonBreakdown } from './reporting-queries'
```

These exports re-publish implementation details (internal maintenance functions and constants) through the repository interface, blurring the boundary between public API and internal machinery.

**Impact:**
- Callers like `bootstrap.ts:17` import `pruneOldDiffSnapshots` via the repository, creating false coupling to low-level maintenance logic
- When the underlying snapshot mechanism changes, the repository interface must change even though the public contract (CRUD, queue ops) hasn't
- Constants like `UPDATE_ALLOWLIST` and `DIFF_SNAPSHOT_RETENTION_DAYS` bind callers to implementation details

**Recommendation:**
Move these re-exports out of the repository interface. Create a separate `src/main/data/sprint-maintenance-facade.ts` that imports from `sprint-queries` and re-exports for callers that need maintenance functions. Keep the repository focused on the core data access contract: task CRUD, queue ops, PR lifecycle, and reporting.

**Effort:** S
**Confidence:** High

---

## F-t1-coupling-2: Direct Database Object Passed Across Module Boundaries
**Severity:** High
**Category:** Abstraction Coupling
**Location:** `src/main/handlers/sprint-local.ts:163`, `src/main/handlers/agent-handlers.ts:96-97`

**Evidence:**
```typescript
// sprint-local.ts:163
const info = getAgentLogInfo(getDb(), agentId)

// agent-handlers.ts:96-97
const { getEventHistory } = await import('../data/event-queries')
const { getDb } = await import('../db')
const rows = getEventHistory(getDb(), agentId)
```

Handlers directly call `getDb()` and pass the raw database connection into data access functions. While query functions do accept `db` as a parameter (good for testability), the handlers still leak the database abstraction across module boundaries.

**Impact:**
- Handlers depend on the global database singleton, making them tightly coupled to the database lifecycle
- If the database backing implementation changes (e.g., move to a pooled connection or remote DB), all callers must be updated
- Testing handlers requires mocking both the query functions AND the global `getDb()`, increasing test surface area
- The pattern normalizes direct database access in the IPC layer instead of routing through a repository or data service

**Recommendation:**
Create an agent-history repository or facade (`IAgentHistoryRepository`) that wraps database-dependent functions and is injected into handlers. Keep `getDb()` internal to the `src/main/data/` module. For `sprint-local.ts:163`, add `getAgentLogInfo` to the repository interface if it's needed at the IPC layer.

**Effort:** M
**Confidence:** High

---

## F-t1-coupling-3: Module-Level Singleton Repository in Data Mutation Service
**Severity:** Medium
**Category:** Abstraction Coupling
**Location:** `src/main/services/sprint-mutations.ts:23`

**Evidence:**
```typescript
const repo: ISprintTaskRepository = createSprintTaskRepository()
```

This module instantiates the repository at module load time and holds it as a singleton. All callers of this module implicitly share the same repository instance.

**Impact:**
- Hidden dependency: callers of `sprint-mutations.ts` don't see that they depend on `ISprintTaskRepository`
- Tight coupling via shared state: if the repository's internal state changes, all callers are affected
- Difficult to test in isolation: tests cannot supply a mock repository without using module-level mocks (`vi.mock()`)
- Misses an opportunity to depend on injection: `sprint-service.ts` wraps `sprint-mutations.ts` but doesn't offer injection either

**Recommendation:**
- For `sprint-mutations.ts`: Accept `repo: ISprintTaskRepository` as a parameter or make the module accept it as a factory argument
- For `sprint-service.ts`: Accept the repo in `createSprintService()` factory, then pass it to mutations
- Update callers to inject the repository: `sprint-service.createTask()` → `createSprintService(repo).createTask()`

This follows the pattern already established in `AgentManager`, which receives `repo` via constructor.

**Effort:** M
**Confidence:** High

---

## F-t1-coupling-4: IPC Handlers Bypass Repository for Reporting Queries
**Severity:** Medium
**Category:** Abstraction Coupling
**Location:** `src/main/handlers/sprint-local.ts:197-200`

**Evidence:**
```typescript
safeHandle('sprint:failureBreakdown', async () => {
  const { getFailureReasonBreakdown } = await import('../data/sprint-task-repository')
  return getFailureReasonBreakdown()
})
```

The handler dynamically imports and calls `getFailureReasonBreakdown()` directly from the repository module, despite this function being available on the `ISprintTaskRepository` interface (line 128 of the same file sets up `effectiveRepo`).

**Impact:**
- Inconsistent access pattern: same handler uses `effectiveRepo` for mutations but bypasses it for reporting
- If `effectiveRepo` is injected (for testing), the reporting query still uses the global instance
- Violates the principle that all data access should go through the same abstraction layer within a module
- Makes the handler's dependencies implicit rather than explicit

**Recommendation:**
Call the function through the already-instantiated `effectiveRepo`:
```typescript
safeHandle('sprint:failureBreakdown', async () => {
  return effectiveRepo.getFailureReasonBreakdown()
})
```

This is a one-line fix that makes dependencies explicit and ensures the injected repository is used consistently.

**Effort:** S
**Confidence:** High

---

## F-t1-coupling-5: Review Orchestration Service Creates Singleton Repository
**Severity:** Medium
**Category:** Abstraction Coupling
**Location:** `src/main/services/review-orchestration-service.ts:47`

**Evidence:**
```typescript
const repo = createSprintTaskRepository()
```

Like `sprint-mutations.ts`, the review orchestration service instantiates the repository at module load time and holds it as a module-level singleton.

**Impact:**
- All review operations share the same repository instance, creating hidden coupling
- The service's methods `mergeLocally()`, `createPr()`, etc., do not declare their dependency on the repository
- Testing review actions requires module mocking rather than injection
- The service is not composable: cannot easily create multiple instances with different repositories (e.g., read-only for diagnostics)

**Recommendation:**
- Create a factory function `createReviewOrchestrationService(repo: ISprintTaskRepository)` that returns the service methods
- Update callers (`handlers/review.ts`) to inject the repository:
  ```typescript
  const reviewOrch = createReviewOrchestrationService(repo)
  safeHandle('review:createPr', (...) => reviewOrch.createPr(...))
  ```

**Effort:** M
**Confidence:** High

---

## F-t1-coupling-6: Database Singleton Shared Across Data Layer Without Encapsulation Boundary
**Severity:** Medium
**Category:** Abstraction Coupling
**Location:** `src/main/db.ts:10-34`, and all direct callers

**Evidence:**
- `db.ts` exports a singleton `getDb()` that is called from 26+ files across the codebase
- Each module directly calls `getDb()` to obtain a connection
- No wrapper or facade layer encapsulates database access patterns (transactions, batch operations, etc.)

**Impact:**
- **Tight coupling to database lifecycle:** All modules depend on the global singleton, making it impossible to test database behavior without involving the real SQLite instance
- **No abstraction over database concerns:** Modules directly use `better-sqlite3` API (`db.prepare()`, `db.transaction()`, etc.), leaking SQLite specifics across boundaries
- **Difficult to add middleware (logging, profiling):** Adding observability requires instrumenting every call site
- **Migration complexity:** Switching to a connection pool, remote DB, or in-memory DB for testing requires changes across all data modules

**Recommendation:**
- Create `src/main/data/db-abstraction.ts` that exports a minimal interface:
  ```typescript
  export interface IDatabase {
    execute(sql: string, params?: unknown[]): unknown[]
    prepare(sql: string): PreparedStatement
    transaction(fn: () => void): void
  }
  ```
- Have data access functions accept `IDatabase` instead of calling `getDb()` directly
- Provide a default implementation that wraps the singleton: `createDatabaseAdapter() => new DatabaseAdapter(getDb())`
- This isolates the data layer and makes SQLite an implementation detail, not a public concern

**Effort:** L
**Confidence:** Medium

---

## F-t1-coupling-7: Task Validation Service Imports Dependency Service Instead of Interface
**Severity:** Low
**Category:** Abstraction Coupling
**Location:** `src/main/services/task-validation.ts:8`

**Evidence:**
```typescript
import { buildBlockedNotes, computeBlockState } from './dependency-service'
```

The task validation service imports helper functions directly from `dependency-service.ts` rather than a clean interface. While `dependency-service.ts` is a focused module, this pattern assumes its internal organization.

**Impact:**
- Low severity because `dependency-service` is a stable, single-purpose module
- But it couples task validation to the specific location and shape of dependency utilities
- If `dependency-service` refactors (e.g., renames functions or reorganizes), task-validation must change

**Recommendation:**
Create an export barrel or facade for dependency utilities:
```typescript
// src/main/services/dependency-facade.ts
export { buildBlockedNotes, computeBlockState } from './dependency-service'
// Alternative: export as a single function if only used by task-validation
export function validateBlockedState(...) { ... }
```

This is a low-effort improvement for better modularity.

**Effort:** S
**Confidence:** Low

---

## Summary

**Critical Path (blocking other fixes):**
1. **F-t1-coupling-1** — Stop re-exporting maintenance functions through the repository interface
2. **F-t1-coupling-2** — Inject database/repository into handlers instead of calling `getDb()` directly
3. **F-t1-coupling-3** — Accept repository as parameter in `sprint-mutations` and `sprint-service`

**Quick Wins (low effort, high impact):**
- **F-t1-coupling-4** — Use `effectiveRepo` for `failureBreakdown` query (1-line fix)
- **F-t1-coupling-7** — Create a dependency facade

**Long-term Investment:**
- **F-t1-coupling-6** — Abstract the database layer behind an `IDatabase` interface

---

**Acknowledge Known Debt:**
CLAUDE.md already notes that `src/main/index.ts:51`, `task-validation.ts`, and `bootstrap.ts` still access sprint-queries directly. This audit confirms that pattern and identifies it as part of a broader issue (#1, #2, #4) rather than isolated exceptions.
