# Data Layer -- UX QA Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** 10 source files in Data Layer (post-remediation)
**Persona:** UX QA (API ergonomics and error propagation quality)
**Previous audit:** `docs/superpowers/audits/prod-audit/data-layer-ux.md` (17 findings)

---

## Remediation Summary

The data layer received three rounds of remediation (PRs #551, #558, #562) addressing critical, medium, and low findings from the original audit. The improvements are substantial: migration isolation, audit trail coverage, WAL checkpointing, backup integrity, and keychain rate limiting were all added. Several findings were addressed with inline comments documenting intentional design decisions.

---

## Finding-by-Finding Verification

### DL-UX-1: `pr_status` CHECK constraint missing `branch_only`

**Status: Fixed**

Migration v17 (`db.ts:460-513`) recreates the `sprint_tasks` table with `branch_only` added to the `pr_status` CHECK constraint:
```
pr_status TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft','branch_only'))
```

**However, migration v17 introduces a new critical bug** -- see NEW-1 below.

---

### DL-UX-2: Inconsistent error patterns (null vs [] vs Infinity vs throw)

**Status: Not Fixed**

The error return pattern is unchanged. All functions now have standardized error message formatting (tagged `DL-17` in comments), but the fundamental inconsistency remains:
- `getTask()` returns `null` on error (line 128)
- `listTasks()` returns `[]` on error (line 151)
- `createTask()` returns `null` on error (line 184)
- `updateTask()` returns `null` on error (line 253) -- still three failure modes with the same return value
- `getActiveTaskCount()` returns `Infinity` on error (line 641) -- documented as intentional fail-closed
- `getAllTaskIds()` and `getTasksWithDependencies()` still throw intentionally

The standardized error messages are an improvement to debuggability but callers still cannot distinguish "not found" from "database error" from "empty patch."

---

### DL-UX-3: Audit trail gaps -- write operations bypassing `recordTaskChanges`

**Status: Partially Fixed**

The following functions now include audit trail recording:
- `claimTask()` (line 305-311, 335-341) -- records `status`, `claimed_by`, `started_at` with `changedBy` set to the `claimedBy` argument
- `releaseTask()` (line 373-379) -- records changes with `changedBy` set to the `claimedBy` argument
- `markTaskDoneByPrNumber()` (lines 459-472, 489-502) -- records changes with `changedBy = 'pr-poller'`
- `markTaskCancelledByPrNumber()` (lines 536-549, 565-578) -- records changes with `changedBy = 'pr-poller'`
- `deleteTask()` (lines 260-266) -- records a `_deleted` event with full task snapshot before deletion

**Still not audited:**
- `updateTaskMergeableState()` (line 612-626) -- writes `pr_mergeable_state` directly with no audit trail
- `clearSprintTaskFk()` (line 679-689) -- writes `agent_run_id = NULL` with no audit trail

These are lower-impact (metadata fields, not status transitions), but the gap means the audit trail is ~90% complete rather than 100%.

---

### DL-UX-4: `backupDatabase()` swallows errors

**Status: Fixed**

`backupDatabase()` (`db.ts:46-69`) now:
1. Validates the backup path against directory traversal (DL-4 fix)
2. Lets the `VACUUM INTO` error propagate (no try/catch swallowing)
3. Verifies backup file existence and size ratio after creation (DL-24 fix)

The function now throws on failure, allowing callers to detect and handle backup failures.

---

### DL-UX-5: `getSettingJson` silently returns null for corrupt JSON

**Status: Fixed**

`settings-queries.ts:41-46` now logs a warning when JSON parsing fails. Additionally, an optional `validator` parameter was added (DL-9 fix, line 29) that rejects values failing validation, also with a warning log. The return value is still `null` for both "missing" and "corrupt" (the discriminated union was not adopted), but the logging makes it debuggable.

---

### DL-UX-6: `setSetting` silently coerces non-string values

**Status: Not Fixed**

`setSetting` (`settings-queries.ts:14`) still accepts `value: string` with no runtime check or JSDoc warning. However, the addition of `setSettingJson<T>()` (line 50-52) provides a proper typed alternative for non-string values, which partially mitigates the risk by offering a correct API path.

---

### DL-UX-7: Incompatible DI patterns across query modules

**Status: Not Fixed (Documented)**

`sprint-queries.ts` still calls `getDb()` internally while all other modules accept `db` as a parameter. However, `getTask()` now has an optional `db` parameter (line 117), and `task-changes.ts` functions also accept optional `db`. The sprint-task-repository.ts header comment (DL-31, lines 6-9) documents this as intentional: agent-manager uses the repository, IPC handlers and Queue API call sprint-queries directly.

The pattern divergence remains but is now documented and partially bridged by optional `db` parameters on key functions.

---

### DL-UX-8: `updateTask` returns null for empty patch

**Status: Not Fixed**

`sprint-queries.ts:192-193` is unchanged:
```typescript
const entries = Object.entries(patch).filter(([k]) => UPDATE_ALLOWLIST.has(k))
if (entries.length === 0) return null
```

Three distinct failure modes still return `null`: empty patch (no allowed fields), task not found (line 202 returns null), and database error (line 253 catch returns null). The column-name regex check (line 211, QA-18) is a new defense-in-depth addition but does not address the UX issue.

---

### DL-UX-9: `runMigrations` provides no error feedback

**Status: Fixed**

`db.ts:526-539` now runs each migration individually with error context. Each migration runs in its own transaction (DL-8 fix), and failures include the version number and description. This is a significant improvement for diagnosing startup issues.

---

### DL-UX-10: `supabase-import.ts` silently drops rows with invalid status

**Status: Fixed**

`supabase-import.ts:132-156` now validates status against `VALID_STATUSES` set before insert, logs a warning per skipped task with ID and title, and tracks `skipped` count separately from `imported`. The final log message reports both counts (line 199-201).

Additionally, the TOCTOU race on the "table is empty" check (DL-10) was fixed by reading credentials inside a transaction (lines 55-67).

---

### DL-UX-11: `createTask` prompt fallback chain undocumented

**Status: Not Fixed**

`sprint-queries.ts:169` is unchanged:
```typescript
input.prompt ?? input.spec ?? input.title,
```

No JSDoc comment was added to `CreateTaskInput.prompt` (lines 84-95) explaining the fallback chain.

---

### DL-UX-12: `changedBy` always `'unknown'` in audit trail

**Status: Partially Fixed**

The `changedBy` parameter is now populated in several callers:
- `claimTask()` passes the `claimedBy` argument (lines 309, 338)
- `releaseTask()` passes the `claimedBy` argument (line 377)
- `markTaskDoneByPrNumber()` passes `'pr-poller'` (line 465)
- `markTaskCancelledByPrNumber()` passes `'pr-poller'` (line 542)
- `deleteTask()` accepts a `deletedBy` parameter (line 256, default `'unknown'`)

**Still hardcoded as `'unknown'`:**
- `updateTask()` at line 237 still passes `'unknown'`. This is the primary general-purpose update path used by IPC handlers and Queue API. The majority of audit trail entries will still say `changed_by = 'unknown'`.

---

### DL-UX-13: `ISprintTaskRepository` covers only 7 of 20 query functions

**Status: Not Fixed (Documented)**

`sprint-task-repository.ts:6-9` now has a JSDoc comment explaining the intentional scope. The interface is unchanged at 7 methods but the rationale is documented.

---

### DL-UX-14: `deleteTask` returns void -- caller can't confirm deletion

**Status: Partially Fixed**

`deleteTask()` (line 256-276) still returns `void`, so callers cannot confirm a row was deleted. However, it now records a `_deleted` audit event with the full task snapshot before deletion (lines 260-266), runs in a transaction, and the `deletedBy` parameter supports attribution. The return type issue persists -- callers still cannot distinguish "deleted" from "didn't exist."

---

### DL-UX-15: `updateAgentMeta` returns raw row while peers return `AgentMeta`

**Status: Fixed**

`agent-queries.ts:120-149` now returns `AgentMeta | null` (line 125). After the UPDATE, it re-reads the row and maps it through `rowToMeta()` (lines 147-148). The return type is now consistent with `getAgentMeta`, `listAgents`, and `findAgentByPid`.

---

### DL-UX-16: `cost-queries` hardcodes `NULL AS pr_url`

**Status: Not Fixed (Documented)**

`cost-queries.ts:79-80` and `cost-queries.ts:155` now have inline comments (`DL-34`) explaining the rationale: `pr_url` is not in the `agent_runs` table and would require a JOIN with `sprint_tasks`. The vestigial column remains but the documentation explains why.

---

### DL-UX-17: Hybrid DI with awkward positional `db?` as 5th parameter

**Status: Partially Fixed**

`task-changes.ts:19-24` still uses the positional `db?` as the 5th parameter. However, all callers now pass all 5 arguments explicitly including `db`. The DL-20 fix also added transactional safety: if `db` is provided, the caller owns the transaction; otherwise, `recordTaskChanges` wraps its own (lines 46-52). The positional API is still awkward but all callers now use it correctly.

---

## New Issues Found

### NEW-1: Migration v17 drops 3 columns -- `playground_enabled`, `needs_review`, `max_runtime_ms`

**Severity: Critical**

**File:** `src/main/db.ts:466-508` (migration v17)

**Evidence:** Migration v17 recreates `sprint_tasks` to update the `pr_status` CHECK constraint. The new table definition (`sprint_tasks_v17`) omits three columns present in the v15 schema:
- `playground_enabled INTEGER NOT NULL DEFAULT 0`
- `needs_review INTEGER NOT NULL DEFAULT 0`
- `max_runtime_ms INTEGER`

The migration uses `INSERT INTO sprint_tasks_v17 SELECT * FROM sprint_tasks` (line 494-495). After v15+v16, `sprint_tasks` has 26 columns (25 from v15 + `spec_type` from v16). The v17 table has only 23 columns. SQLite requires the column count to match for unqualified `SELECT *` INSERT, so **this migration will fail at runtime** with a column count mismatch error.

If the migration were to somehow succeed (e.g., on a database without those columns), all `playground_enabled`, `needs_review`, and `max_runtime_ms` data would be silently lost.

**Impact:** Any existing database upgrading through v17 will crash at startup. The error message from the DL-19 fix will correctly report the migration failure, but the app will not start.

**Fix:** Recreate the v17 table definition with all columns from v15+v16 (including `playground_enabled`, `needs_review`, `max_runtime_ms`). Use explicit column lists in both the CREATE TABLE and the INSERT...SELECT to prevent ordering mismatches.

---

### NEW-2: Migration v17 uses `SELECT *` with column reordering

**Severity: Significant**

**File:** `src/main/db.ts:494-495`

**Evidence:** Even setting aside the missing columns, v17 reorders columns compared to v15. For example, `depends_on` moves from position 20 (in v15) to position 7 (in v17), and `spec_type` (from v16) appears at position 21 in v17. `SELECT *` inserts by position, not by name, so data would be written to the wrong columns.

**Impact:** Silent data corruption -- field values mapped to incorrect columns.

**Fix:** Use explicit column lists: `INSERT INTO sprint_tasks_v17 (id, title, ...) SELECT id, title, ... FROM sprint_tasks`.

---

### NEW-3: Migration v10 does not re-enable `foreign_keys` on partial failure

**Severity: Moderate**

**File:** `src/main/db.ts:298-340`

**Evidence:** Migration v9 uses `try/finally` to re-enable foreign keys (line 287-289), which is correct. Migration v10 (line 298-340) places `PRAGMA foreign_keys = ON` as the last statement inside the same `db.exec()` block as the DDL. If any prior statement fails, `foreign_keys` stays OFF for the remainder of the session. PRAGMAs are not transactional in SQLite, so the DL-8/DL-19 transaction rollback does not restore the pragma.

**Impact:** If migration v10 fails partway, all subsequent operations in the same DB connection run without foreign key enforcement.

---

### NEW-4: `updateTask` transaction swallows audit failure as null

**Severity: Moderate**

**File:** `src/main/data/sprint-queries.ts:232-253`

**Evidence:** The DL-2 fix wraps read + audit + write in a transaction (line 199). If `recordTaskChanges` throws (line 243), the error is re-thrown to abort the transaction. However, the outer catch at line 248-253 catches this re-thrown error and returns `null`, swallowing the audit failure. The caller gets `null` (indistinguishable from "task not found") with no indication that the update was attempted but rolled back due to an audit infrastructure failure.

**Impact:** An audit infrastructure failure silently blocks all task updates with no diagnostic signal to callers.

---

## Summary Table

| ID | Original Severity | Status | Notes |
|----|-------------------|--------|-------|
| DL-UX-1 | Significant | Fixed | Migration v17 adds `branch_only` to CHECK (but see NEW-1) |
| DL-UX-2 | Significant | Not Fixed | Error messages standardized, but return value inconsistency unchanged |
| DL-UX-3 | Significant | Partially Fixed | 5 of 7 bypass functions now audit; `updateTaskMergeableState` and `clearSprintTaskFk` still skip |
| DL-UX-4 | Significant | Fixed | Errors now propagate; backup integrity verified |
| DL-UX-5 | Moderate | Fixed | Parse errors logged; optional validator added |
| DL-UX-6 | Moderate | Not Fixed | No JSDoc/runtime check, but `setSettingJson` provides safe alternative |
| DL-UX-7 | Moderate | Not Fixed (Documented) | DI divergence documented; optional `db` params added to key functions |
| DL-UX-8 | Moderate | Not Fixed | Triple-null ambiguity unchanged |
| DL-UX-9 | Moderate | Fixed | Individual migration transactions with version/description in error |
| DL-UX-10 | Moderate | Fixed | Status validation, per-row warnings, accurate counters |
| DL-UX-11 | Minor | Not Fixed | No JSDoc on prompt fallback chain |
| DL-UX-12 | Minor | Partially Fixed | Specialized callers pass identity; `updateTask` still `'unknown'` |
| DL-UX-13 | Minor | Not Fixed (Documented) | Interface scope documented as intentional |
| DL-UX-14 | Minor | Partially Fixed | Audit event recorded on delete, but return type still void |
| DL-UX-15 | Minor | Fixed | Returns `AgentMeta` consistently |
| DL-UX-16 | Minor | Not Fixed (Documented) | Vestigial column documented with rationale |
| DL-UX-17 | Minor | Partially Fixed | Callers now pass all args correctly; positional API unchanged |

### New Issues

| ID | Severity | File | Issue |
|----|----------|------|-------|
| NEW-1 | Critical | `db.ts:466-508` | Migration v17 drops 3 columns (`playground_enabled`, `needs_review`, `max_runtime_ms`) -- will crash on upgrade |
| NEW-2 | Significant | `db.ts:494-495` | Migration v17 `SELECT *` with column reordering causes silent data corruption |
| NEW-3 | Moderate | `db.ts:298-340` | Migration v10 `foreign_keys = ON` inside exec block -- not re-enabled on partial failure |
| NEW-4 | Moderate | `sprint-queries.ts:232-253` | Audit failure in `updateTask` transaction silently returns null to caller |

---

## Overall Assessment

**Remediation quality: Good with one critical regression.**

The three remediation PRs addressed the most impactful findings (audit trail gaps, backup safety, migration isolation, keychain rate limiting, supabase import validation). The code is measurably better: 6 of 17 findings are fully fixed, 5 are partially fixed with meaningful progress, and 4 are documented as intentional design decisions.

However, **migration v17 is a critical regression** that will crash any existing database on upgrade. The table recreation drops 3 columns and reorders others while using `SELECT *`. This must be fixed before any release containing v17.

The unfixed UX issues (DL-UX-2 error patterns, DL-UX-8 triple-null) are deeper architectural choices that would require coordinated refactoring across all callers. They remain valid concerns but are reasonable to defer.

**Recommended immediate actions:**
1. **Fix migration v17** -- add missing columns, use explicit column lists (Critical, blocks release)
2. **Pass `changedBy` in `updateTask`** -- accept it as a parameter from IPC/Queue API callers (Low effort, high audit value)
3. **Add audit to `updateTaskMergeableState`** -- small function, easy to wrap (Low effort)
