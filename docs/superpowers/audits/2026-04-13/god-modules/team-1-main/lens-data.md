# Data Layer Audit: God Module Analysis
**Date:** 2026-04-13  
**Scope:** Database access, query logic, schema management, and cross-concern coupling  
**Baseline:** sprint-queries barrel re-export is intentional; db.ts WAL/migration loading is expected

---

## Executive Summary

The data layer exhibits **clean separation of concerns** with **strong evidence of refactoring discipline**. Modules are well-scoped, business logic is correctly pushed to the service layer, and the query layer stays focused on persistence. However, there are **5 medium-severity issues** where query modules take on tangential responsibilities or where the mapper layer duplicates validation logic. These are incremental refinements, not architecture-breaking problems.

**Key Finding:** The data layer is **not a God module**. It's well-composed. The audit identified **one true issue** (sanitization in the data layer) and **several smaller modularity improvements** that would help with testability and change velocity.

---

## F-t1-data-1: Sanitization Logic in Data Layer Violates Input Separation

**Severity:** High  
**Category:** Mixed Responsibilities | Input Validation Boundary Violation  
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-task-crud.ts:91–92, sprint-task-mapper.ts:2–3, sprint-agent-queries.ts:2, 136`

**Evidence:**

The data layer **sanitizes raw input** before persistence and **deserializes/re-sanitizes** during row mapping:

```typescript
// sprint-task-crud.ts lines 91-92 (CREATE path)
const dependsOn = sanitizeDependsOn(input.depends_on)
const tags = sanitizeTags(input.tags)

// sprint-task-mapper.ts lines 23-24 (READ path, re-sanitizing)
depends_on: sanitizeDependsOn(row.depends_on),
tags: sanitizeTags(row.tags),

// sprint-agent-queries.ts line 136 (QUERY path, re-sanitizing)
depends_on: row.depends_on ? sanitizeDependsOn(row.depends_on) : null
```

This violates a clean input contract:
- **CREATE:** `sanitizeDependsOn(input.depends_on)` — treating raw IPC input as untrusted ✓
- **READ:** `sanitizeDependsOn(row.depends_on)` — re-sanitizing already-sanitized JSON stored in DB ✗
- **QUERY:** same re-sanitization in `getTasksWithDependencies()` ✗

**Root Cause:** Defensive programming. The mapper assumes `row.depends_on` could contain malformed JSON or invalid task references. But if the CREATE path sanitized it, and the DB schema enforces constraints, re-sanitization is redundant and adds coupling.

**Impact:**
- **Testability:** Sanitization tests are scattered across data layer and service layer, making it hard to verify the input boundary
- **Performance:** `sanitizeDependsOn()` re-parses and re-validates JSON on every row mapping (especially bad in bulk reads like `getTasksWithDependencies()`)
- **Maintenance:** If sanitization rules change, they must be updated in 3+ places instead of at the boundary

**Recommendation:**
1. Move sanitization responsibility to **service layer entry points** (sprint-service.ts, task-state-service.ts)
2. In `sprint-task-crud.ts`, assume `input` is pre-sanitized OR sanitize once and trust it
3. In `sprint-task-mapper.ts`, remove re-sanitization; assume the DB contains valid data (it should, if CREATE sanitized it)
4. Add a comment in COLUMN_MAP or sprint-task-types.ts: "sanitization is caller's responsibility; mapper assumes DB is clean"

**Effort:** M (3 edits, but requires coordination with callers)  
**Confidence:** High

---

## F-t1-data-2: State Transition Validation Embedded in Query Layer

**Severity:** Medium  
**Category:** Mixed Responsibilities | Business Logic in Data Layer  
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-task-crud.ts:183–191`

**Evidence:**

`updateTask()` enforces the **state machine** (a business rule) directly:

```typescript
// sprint-task-crud.ts lines 183-191
if (patch.status && typeof patch.status === 'string') {
  const currentStatus = oldTask.status as string
  const validationResult = validateTransition(currentStatus, patch.status)
  if (!validationResult.ok) {
    throw new Error(
      `[sprint-queries] Invalid transition for task ${id}: ${validationResult.reason}`
    )
  }
}
```

This is **correct behavior** — preventing invalid state transitions at persistence time. But the module coupling is tight:

```typescript
// Line 11: Imported from shared, not service
import { validateTransition } from '../../shared/task-state-machine'
```

The IPC handler also calls `updateTask()` through the service layer, which also has transition checks via `prepareQueueTransition()`. This creates **dual validation paths**:
- Path 1: IPC → service layer business rules (prepareQueueTransition)
- Path 2: IPC → service → data layer business rules (updateTask + validateTransition)

**Impact:**
- **Clarity:** Callers must understand that `updateTask()` throws on invalid transitions. The type system doesn't express this (throws, doesn't return a Result type).
- **Testing:** State machine tests exist in both layers; hard to prove one covers all cases
- **Extension:** If a new status is added, maintainers must update shared/task-state-machine.ts AND remember to test updateTask's enforcement

**Recommendation:**
1. Keep the validation in `updateTask()` as a safety net (defensive)
2. **Document** the dual validation with a comment: "validateTransition is also called in TaskStateService. This is defense-in-depth."
3. Consider returning a Result type from `updateTask()` instead of throwing, so callers can handle state errors gracefully
4. OR: Remove from data layer and trust the service layer (higher risk, but cleaner responsibility split)

**Effort:** S (documentation) → M (Result type refactor)  
**Confidence:** Medium

---

## F-t1-data-3: `sprint-task-mapper.ts` Embeds Revision Feedback Parsing

**Severity:** Low  
**Category:** Mixed Responsibilities | Type Coercion Logic  
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-task-mapper.ts:11–28`

**Evidence:**

The mapper includes **application-level type coercion** logic beyond simple row → object mapping:

```typescript
// sprint-task-mapper.ts lines 12-20
let revisionFeedback: unknown = row.revision_feedback
if (typeof revisionFeedback === 'string') {
  try {
    revisionFeedback = JSON.parse(revisionFeedback)
  } catch {
    revisionFeedback = null
  }
}
if (!Array.isArray(revisionFeedback)) revisionFeedback = null
```

This is **defensive parsing** — handling malformed JSON with a fallback to null. But the mapper also handles `depends_on` and `tags` JSON via delegated sanitization functions.

**Impact:**
- **Inconsistency:** `revision_feedback` has inline fallback logic; `depends_on`/`tags` delegate to functions
- **Discoverability:** A maintainer looking at `serializeFieldForStorage()` (which handles `revision_feedback` as string or object) must cross-reference `mapRowToTask()` to understand the full round-trip
- **Testability:** The try/catch fallback is tested implicitly; no explicit test for malformed JSON

**Recommendation:**
1. Extract `parseRevisionFeedback()` function (parallels `sanitizeDependsOn()`)
2. Keep it in sprint-task-mapper.ts or move to shared (consistent with other sanitizers)
3. Update `serializeFieldForStorage()` to reference it by name for clarity

**Effort:** S  
**Confidence:** Low (cosmetic, improves readability)

---

## F-t1-data-4: `sprint-maintenance.ts` Lacks Configuration or Observability

**Severity:** Medium  
**Category:** Operational Concern | Missing Observability  
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-maintenance.ts:10, 21–37`

**Evidence:**

The maintenance function has a hardcoded constant and no observability:

```typescript
// sprint-maintenance.ts lines 10, 21-37
export const DIFF_SNAPSHOT_RETENTION_DAYS = 30

export function pruneOldDiffSnapshots(
  retentionDays: number = DIFF_SNAPSHOT_RETENTION_DAYS,
  db?: Database.Database
): number {
  const conn = db ?? getDb()
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const result = conn
    .prepare(
      `UPDATE sprint_tasks
       SET review_diff_snapshot = NULL
       WHERE review_diff_snapshot IS NOT NULL
         AND status IN ('done', 'cancelled', 'failed', 'error')
         AND updated_at < ?`
    )
    .run(cutoff)
  return result.changes
}
```

**Issues:**
1. **No logging:** Caller doesn't know if cleanup succeeded, how many rows were affected, or how long it took
2. **No caller enforcement:** `pruneOldDiffSnapshots()` returns `.changes` but the caller (if any) must check it
3. **Status hardcoding:** Terminal statuses are hardcoded in the SQL instead of referencing shared `TERMINAL_STATUSES`

**Impact:**
- **Operations:** No visibility into database cleanup effectiveness (especially problematic if retention is tuned)
- **Testing:** Hard to verify the function is called at the right time and frequency
- **Maintenance:** If task statuses change, the hardcoded list becomes stale

**Recommendation:**
1. Add optional `logger` parameter (pattern used by other functions)
2. Log before and after: `logger?.info('Pruning old snapshots...'); result.changes > 0 && logger?.info(...)`
3. Replace hardcoded statuses: `WHERE status IN (${Array.from(TERMINAL_STATUSES).map(s => `'${s}'`).join(',')})`
4. Ensure the function is called from a scheduled maintenance hook (e.g., on startup or periodic timer)

**Effort:** S  
**Confidence:** Medium

---

## F-t1-data-5: Bulk Operations Lack Consistent Error Handling

**Severity:** Medium  
**Category:** Error Handling Asymmetry  
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-pr-ops.ts:15–54, 60–98, 104–146`

**Evidence:**

The PR operations file defines private bulk helpers with **different error semantics**:

```typescript
// sprint-pr-ops.ts lines 30-45: Bulk transition calls recordTaskChangesBulk
// (throws on audit failure, causing rollback)
recordTaskChangesBulk(
  affected.map((oldTask) => ({
    taskId: oldTask.id as string,
    oldTask,
    newPatch: { status: 'done', completed_at: completedAt }
  })),
  changedBy,
  db
)

// sprint-pr-ops.ts lines 47-50: Status UPDATE is NOT protected by try/catch
db.prepare(
  'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
).run('done', completedAt, prNumber, 'active')
```

And the public functions:

```typescript
// sprint-pr-ops.ts lines 148-164: markTaskDoneByPrNumber wraps entire operation
export function markTaskDoneByPrNumber(prNumber: number): string[] {
  try {
    const db = getDb()
    return db.transaction(() => {
      // ... calls transitionTasksToDone (which throws on audit failure)
      // ... calls updatePrStatusBulk (which throws on audit failure)
    })()
  } catch (err) {
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] markTaskDoneByPrNumber failed for PR #${prNumber}: ${msg}`)
    return []
  }
}
```

**Issues:**
1. **Implicit coupling:** Private helpers throw; public functions catch. Works, but the contract is implicit in code, not documented
2. **Partial failure invisibility:** If audit fails mid-transaction, the entire PR marking is rolled back. Caller gets empty array `[]` with no context
3. **Inconsistency with single-task operations:** `sprint-task-crud.ts:updateTask()` also records changes but **separately documents** the error handling in comments (DL-17)

**Impact:**
- **Observability:** No way to distinguish "PR number not found" from "database locked" from "audit failure"
- **Testing:** Hard to mock the private helpers; hard to test partial failures
- **Debuggability:** Logs show "failed" but not why

**Recommendation:**
1. Add a comment at the top of the file: "Private helpers throw on audit failures (transactionality). Public wrappers catch and log."
2. Document expected exceptions in each public function's JSDoc
3. Consider extracting a `withAuditedTransaction` helper (like `withRetry`) to standardize the pattern across `sprint-pr-ops.ts`, `sprint-queue-ops.ts`, and `sprint-task-crud.ts`

**Effort:** M  
**Confidence:** Medium

---

## Summary Table

| ID | Title | Severity | Effort | Fix Priority |
|----|-------|----------|--------|--------------|
| F-t1-data-1 | Sanitization in Data Layer | High | M | High |
| F-t1-data-2 | State Transition Validation in Query Layer | Medium | S–M | Medium |
| F-t1-data-3 | Revision Feedback Parsing Inconsistency | Low | S | Low |
| F-t1-data-4 | Maintenance Function Observability | Medium | S | Medium |
| F-t1-data-5 | Bulk Operations Error Handling | Medium | M | Medium |

---

## Positive Findings (No Issues)

✓ **db.ts** — Correctly owns connection, pragma setup, and migration orchestration only. WAL mode, permissions, and shutdown logic are all appropriate.

✓ **sprint-task-repository.ts** — Clean abstraction layer. Proper use of composition to delegate to focused query modules. No additional logic.

✓ **sprint-queries.ts barrel** — Correctly re-exports from focused modules without adding its own logic (baseline confirmed).

✓ **sprint-task-crud.ts** — CRUD operations are focused. Proper use of transactions and audit recording. Change detection filters prevent write amplification.

✓ **sprint-queue-ops.ts** — WIP enforcement, claim/release logic cleanly separated. Proper transaction boundaries.

✓ **sprint-pr-ops.ts** — PR state management is cohesive. Bulk operations are well-factored into private helpers.

✓ **sprint-agent-queries.ts** — Agent health checks are focused queries. Proper error handling and fallback behavior.

✓ **Separation of Concerns** — Business logic (spec validation, dependency blocking, state transitions) correctly lives in `services/task-state-service.ts`, not data layer. IPC handlers delegate to service layer correctly.

---

## Conclusion

The data layer is **well-designed and maintainable**. It is **not a God module**. The findings are **incremental improvements** that would enhance clarity, testability, and operational visibility without requiring architectural changes.

Primary recommendation: **Extract sanitization to service layer entry points** (F-t1-data-1) to establish a clear input validation boundary. Secondary recommendations focus on documentation and observability.
