# Data Layer -- Red Team Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** 10 source files in Data Layer
**Persona:** Red Team (Security Auditor)
**Baseline:** `docs/superpowers/audits/prod-audit/data-layer-red.md` (2026-03-29)

---

## Remediation Status

### DL-RED-1: `updateTask` builds SQL SET clause from dynamic column names without compile-time assertion

- **Status: Fixed**
- **File:** `src/main/data/sprint-queries.ts:211`
- **Evidence:** A regex assertion `if (!/^[a-z_]+$/.test(key))` was added inside the `for` loop that builds SET clauses. This runs on every key before interpolation into SQL. The assertion throws on any key containing characters outside `[a-z_]`, which prevents SQL metacharacters from reaching the query string. The check is inside the transaction, so a bad key aborts the entire update.
- **Notes:** The comment references `QA-18` (Queue API audit ID), confirming cross-audit tracking. Defense-in-depth is now adequate -- two layers protect column names: the `UPDATE_ALLOWLIST` set membership check and the regex assertion.

### DL-RED-2: `updateAgentMeta` builds SQL SET clause from `AGENT_COLUMN_MAP` values without validation

- **Status: Fixed**
- **File:** `src/main/data/agent-queries.ts:133`
- **Evidence:** Identical regex assertion `if (!/^[a-z_]+$/.test(col))` added at line 133, applied to the `col` value from `AGENT_COLUMN_MAP` before interpolation. Throws with descriptive error message on violation.

### DL-RED-3: `backupDatabase` regex allows path traversal sequences

- **Status: Fixed**
- **File:** `src/main/db.ts:51-55`
- **Evidence:** The naive regex has been replaced with `path.resolve()` + prefix check. The path is canonicalized and verified to start with the data directory. The old regex is gone entirely. This matches the recommended fix from the original audit.

### DL-RED-4: Supabase credentials stored in plaintext in SQLite settings table

- **Status: Fixed**
- **File:** `src/main/data/supabase-import.ts:204-211`
- **Evidence:** After successful import, the code now calls `deleteSetting(db, SETTING_SUPABASE_URL)` and `deleteSetting(db, SETTING_SUPABASE_KEY)`. This removes credentials from the settings table immediately after they are no longer needed. The deletion is wrapped in its own try/catch so a deletion failure does not crash the import, and a warning is logged if deletion fails.

### DL-RED-5: OAuth token file has no permission enforcement

- **Status: Fixed**
- **File:** `src/main/env-utils.ts:74-79` (read path), `src/main/env-utils.ts:126` (write path)
- **Evidence:**
  - **Read path:** `getOAuthToken()` now calls `statSync(tokenPath)` and checks `stats.mode & 0o777 !== 0o600`, logging a warning if permissions are insecure. The token is still read (not blocked), which is the pragmatic choice -- blocking would break agent spawning for users with pre-existing files.
  - **Write path:** `refreshOAuthTokenFromKeychain()` now writes with `{ mode: 0o600 }`, ensuring newly written tokens have restrictive permissions.
- **Residual concern:** The read path warns but does not refuse to read the token. This is a design choice, not a bug -- forcing chmod on the user's file would be intrusive. Documented as accepted.

### DL-RED-6: `ensureSubscriptionAuth` deletes env vars as sole security measure

- **Status: Partially Fixed**
- **File:** `src/main/auth-guard.ts:103-105`
- **Evidence:** The env var deletion now happens unconditionally at the top of the function (before any early returns from `checkAuthStatus`), matching the comment `DL-16: Clear env vars unconditionally to prevent bypass (even on error path)`. However, the fundamental issue remains: `buildAgentEnvWithAuth()` re-introduces `ANTHROPIC_API_KEY` into the spawned environment from the OAuth token file. The auth guard and the agent env builder serve different purposes (subscription enforcement vs. agent auth), but the env cleanup is still not a true security boundary.
- **Recommendation:** No further action needed -- this is documented as a subscription enforcement mechanism, not a security control. The env allowlist in `buildAgentEnv()` (line 17-33) now limits what environment variables are passed to agents, which is the real security boundary.

### DL-RED-7: Migrations run in a single transaction with no individual error isolation

- **Status: Fixed**
- **File:** `src/main/db.ts:526-539`
- **Evidence:** The migration runner now wraps each migration in its own transaction. Each migration commits independently. A failure in migration N+2 no longer rolls back migration N+1. Error messages now include the migration version and description (DL-19 fix).

### DL-RED-8: `getSettingJson` uses unconstrained generic type deserialization

- **Status: Partially Fixed**
- **File:** `src/main/data/settings-queries.ts:26-48`
- **Evidence:** The function signature now accepts an optional `validator` parameter. If a validator is provided and fails, it returns `null` with a warning. However, no callers currently pass a validator. The `repos` setting (the highest-risk use case identified in the original finding) is still deserialized without validation. The infrastructure is in place but not yet adopted.
- **Recommendation:** Add a Zod or manual validator for the `repos` setting in `src/main/paths.ts` to complete this fix.

### DL-RED-9: Queue API token in query string is logged in server access logs

- **Status: Accepted Risk (unchanged)**
- **File:** `src/main/queue-api/helpers.ts:43-50`
- **Evidence:** The `?token=` query parameter is still supported. A comment at line 44-45 now explicitly documents the risk: "Query string tokens are logged in access logs and browser history. This is acceptable for localhost-only API but should not be used in production." This is the correct disposition for a localhost-only API.

### DL-RED-10: `migration.version` interpolated into pragma without parameterization

- **Status: Not Fixed**
- **File:** `src/main/db.ts:530`
- **Evidence:** The code still uses template literal interpolation for `user_version` pragma. The `migration.version` is a number from the hardcoded `migrations` array, so this is not exploitable with current code. The risk remains purely theoretical.
- **Recommendation:** Low priority. Add `if (!Number.isInteger(migration.version)) throw new Error(...)` as a one-line defensive guard.

### DL-RED-11: `sanitizeDependsOn` recursive call has no depth limit

- **Status: Not Fixed**
- **File:** `src/shared/sanitize-depends-on.ts:16`
- **Evidence:** The function still recurses without a depth parameter. In practice, `JSON.parse` of a non-JSON-string will throw, limiting real recursion to the depth of encoding. Stack overflow would require thousands of levels of encoding, which is not a realistic attack vector.
- **Recommendation:** Low priority. The current code is safe for all practical inputs.

### DL-RED-12: Supabase import does not validate `status` field from remote data

- **Status: Fixed**
- **File:** `src/main/data/supabase-import.ts:132-156`
- **Evidence:** A `VALID_STATUSES` set is defined and checked before each row insert. Invalid statuses are skipped with a warning log including the task ID and title. The import now reports both `imported` and `skipped` counts. This exactly matches the recommended fix.

### DL-RED-13: `AuthGuard` Keychain read is not rate-limited

- **Status: Fixed**
- **File:** `src/main/auth-guard.ts:41-42, 47-51`
- **Evidence:** A rate limit of 1 second (`KEYCHAIN_RATE_LIMIT_MS = 1000`) is enforced in `MacOSCredentialStore.readToken()`. Reads within the window throw an error. This prevents rapid-fire Keychain access from IPC polling.

### DL-RED-14: Database file permissions not explicitly set

- **Status: Fixed**
- **File:** `src/main/db.ts:14-21`
- **Evidence:** On first creation (`!dbExists`), `chmodSync(DB_PATH, 0o600)` is called. The chmod is wrapped in try/catch to avoid crashing on permission errors. Only applies to new databases -- existing databases retain their current permissions.
- **Residual concern:** The `~/.bde/` directory is still created with default umask. See DL-RED-NEW-2.

### DL-RED-15: `VACUUM INTO` backup has no integrity verification

- **Status: Partially Fixed**
- **File:** `src/main/db.ts:60-69`
- **Evidence:** After `VACUUM INTO`, the code now verifies the backup file exists and compares backup size to original size (warns if less than 10% of original). This catches the worst case (backup not created, or truncated/empty file). The original recommendation of running `PRAGMA integrity_check` was not implemented, but the size check is a reasonable pragmatic alternative.

---

## Synthesis Findings Cross-Check

The March 28 synthesis identified additional findings beyond the Red Team audit. Verifying those that map to files in scope:

### DL-1 (Synthesis): Migration v9 disables `foreign_keys` without guaranteed re-enable on failure

- **Status: Fixed**
- **File:** `src/main/db.ts:234-289`
- **Evidence:** Migration v9 now wraps the foreign_keys re-enable in a `finally` block (line 287-289). Migration v17 (line 464-511) follows the same pattern. Migration v10 (line 297-341) still has `PRAGMA foreign_keys = ON` inside the main block rather than in a `finally`, but since each migration now runs in its own transaction, a failure rolls back and the next startup re-runs from the same version.

### DL-2 (Synthesis): `updateTask` read + audit + write not in single transaction

- **Status: Fixed**
- **File:** `src/main/data/sprint-queries.ts:199-247`
- **Evidence:** The entire operation (fetch old task, build SET clause, UPDATE, record audit trail) is wrapped in `db.transaction()`. If the audit write fails, the error is re-thrown at line 243, aborting the transaction and rolling back the UPDATE.

### DL-3 (Synthesis): `markTaskDone/Cancelled` bypass audit trail entirely

- **Status: Fixed**
- **File:** `src/main/data/sprint-queries.ts:444-594`
- **Evidence:** Both functions now fetch affected tasks before updating, call `recordTaskChanges()` for each, and run everything inside a transaction. The `changed_by` is set to `'pr-poller'`.

### DL-5 (Synthesis): `pr_status` CHECK constraint missing `branch_only`

- **Status: Fixed**
- **File:** `src/main/db.ts:462-512` (migration v17)
- **Evidence:** Migration v17 recreates the table with `pr_status IN ('open','merged','closed','draft','branch_only')` at line 480.

### DL-10 (Synthesis): Supabase import TOCTOU race on "table is empty" check

- **Status: Fixed**
- **File:** `src/main/data/supabase-import.ts:54-67`
- **Evidence:** The count check and credential read are now inside a single SQLite transaction.

### DL-13 (Synthesis): `claimTask`/`releaseTask` skip audit trail

- **Status: Fixed**
- **File:** `src/main/data/sprint-queries.ts:278-391`
- **Evidence:** Both functions now fetch the old task, execute the update, and call `recordTaskChanges` within a transaction. The `changed_by` is set to the `claimedBy` argument.

### DL-14 (Synthesis): `deleteTask` leaves orphaned audit records, no deletion audit

- **Status: Fixed**
- **File:** `src/main/data/sprint-queries.ts:256-276`
- **Evidence:** `deleteTask` now runs in a transaction that records a `_deleted` audit entry with the full task snapshot before deleting. Accepts a `deletedBy` parameter.

### DL-20 (Synthesis): `recordTaskChanges` not transactional for multi-field patches

- **Status: Fixed**
- **File:** `src/main/data/task-changes.ts:46-52`
- **Evidence:** When `db` is not provided, the function wraps all inserts in its own transaction. When `db` is provided, it trusts the caller's transaction scope.

### DL-25 (Synthesis): `getSettingJson` swallows parse errors silently

- **Status: Fixed**
- **File:** `src/main/data/settings-queries.ts:41-45`
- **Evidence:** The catch block now logs a warning with the setting key and error message.

### DL-27 (Synthesis): `pruneEventsByAgentIds` vulnerable to large IN clause

- **Status: Fixed**
- **File:** `src/main/data/event-queries.ts:121-137`
- **Evidence:** Arrays larger than 500 are processed in batches. The SQLite variable limit (default 999) is respected.

### DL-30 (Synthesis): `changedBy` always `'unknown'` in audit trail

- **Status: Partially Fixed**
- `claimTask` and `releaseTask` pass the `claimedBy` parameter. `markTaskDone/CancelledByPrNumber` pass `'pr-poller'`. `deleteTask` accepts `deletedBy`. However, `updateTask` still hardcodes `'unknown'` at line 237.

### DL-33 (Synthesis): `updateAgentMeta` returns raw row while peers return mapped

- **Status: Fixed**
- **File:** `src/main/data/agent-queries.ts:120-149`
- **Evidence:** `updateAgentMeta` now does a SELECT after the UPDATE and returns `rowToMeta(row)`.

### DL-34 (Synthesis): `cost-queries` hardcodes `NULL AS pr_url`

- **Status: Not Fixed (documented)**
- **File:** `src/main/data/cost-queries.ts:85, 173`
- **Evidence:** Still hardcodes `NULL AS pr_url`. Comments document why: pr_url is on `sprint_tasks`, not `agent_runs`. Data model limitation, not a security issue.

---

## New Findings

### DL-RED-NEW-1: Migration v10 does not use `finally` for `PRAGMA foreign_keys = ON`

- **File:** `src/main/db.ts:297-341`
- **Severity:** Low
- **Risk:** Migration v10 puts `PRAGMA foreign_keys = ON` inside the main block rather than in a `finally` block. If the migration fails partway through, foreign keys remain disabled for subsequent migrations. Mitigated by the fact that each migration now runs in its own transaction (the DL-8 fix), so a failure rolls back and the next startup re-runs from the same version.
- **Recommendation:** Refactor to match the v9/v17 pattern for consistency. Low urgency.

### DL-RED-NEW-2: `~/.bde/` directory created without explicit mode

- **File:** `src/main/db.ts:10`
- **Severity:** Low
- **Risk:** `mkdirSync(DB_DIR, { recursive: true })` uses the process umask (typically 0755 on macOS). While the DB file is now chmod'd to 0600 on creation, the directory itself is world-listable. On a shared system, other users could enumerate files in `~/.bde/` (e.g., `oauth-token`, `bde.db`, `agent-manager.log`), though they cannot read 0600-protected files.
- **Recommendation:** Add `mode: 0o700` to the `mkdirSync` call.

### DL-RED-NEW-3: `getSettingJson` validator not used by any caller

- **File:** `src/main/data/settings-queries.ts:29`
- **Severity:** Low (infrastructure gap)
- **Risk:** The optional `validator` parameter added for DL-9 is never passed by any caller in the codebase. The `repos` setting (identified as the highest-risk deserialization target) is still read without validation. The fix infrastructure exists but is not yet activated.
- **Recommendation:** Add validators for security-sensitive settings (`repos`, `taskRunner.apiKey`).

---

## Summary Table

| ID | Original Severity | Status | Notes |
|---|---|---|---|
| DL-RED-1 | High | **Fixed** | Regex assertion on column names in `updateTask` |
| DL-RED-2 | High | **Fixed** | Regex assertion on column names in `updateAgentMeta` |
| DL-RED-3 | High | **Fixed** | `path.resolve()` + prefix check replaces naive regex |
| DL-RED-4 | Medium | **Fixed** | Credentials deleted after successful import |
| DL-RED-5 | Medium | **Fixed** | Permission check on read, explicit mode on write |
| DL-RED-6 | Medium | **Partially Fixed** | Env cleanup unconditional; fundamental limitation documented |
| DL-RED-7 | Medium | **Fixed** | Individual migration transactions with error context |
| DL-RED-8 | Medium | **Partially Fixed** | Validator parameter added but not yet used by callers |
| DL-RED-9 | Medium | **Accepted Risk** | Documented in code comments |
| DL-RED-10 | Low | **Not Fixed** | Theoretical only; hardcoded integer array |
| DL-RED-11 | Low | **Not Fixed** | Theoretical only; practical recursion depth is 1-2 |
| DL-RED-12 | Low | **Fixed** | Status validation with skip-and-warn |
| DL-RED-13 | Low | **Fixed** | 1-second rate limit on Keychain reads |
| DL-RED-14 | Low | **Fixed** | `chmodSync(0o600)` on new DB creation |
| DL-RED-15 | Low | **Partially Fixed** | Existence + size check (no full integrity check) |
| DL-RED-NEW-1 | Low | **New** | Migration v10 missing `finally` for FK re-enable |
| DL-RED-NEW-2 | Low | **New** | `~/.bde/` directory created without explicit mode |
| DL-RED-NEW-3 | Low | **New** | `getSettingJson` validator infrastructure unused |

### Synthesis Findings Status

| Synthesis ID | Status | Notes |
|---|---|---|
| DL-1 | **Fixed** | `finally` block on v9/v17 (v10 residual, low risk) |
| DL-2 | **Fixed** | Single transaction for read + update + audit |
| DL-3 | **Fixed** | Audit trail added to markTaskDone/Cancelled |
| DL-5 | **Fixed** | Migration v17 adds `branch_only` to CHECK constraint |
| DL-10 | **Fixed** | TOCTOU race eliminated with transactional credential read |
| DL-13 | **Fixed** | Audit trail in claim/release with caller attribution |
| DL-14 | **Fixed** | Deletion audit with task snapshot |
| DL-20 | **Fixed** | Conditional transaction wrapping |
| DL-25 | **Fixed** | Parse errors logged |
| DL-27 | **Fixed** | Batch processing for large IN clauses |
| DL-30 | **Partially Fixed** | Attribution in claim/release/pr-poller; `updateTask` still `'unknown'` |
| DL-33 | **Fixed** | Returns mapped AgentMeta |
| DL-34 | **Not Fixed** | Documented as data model limitation |

---

## Overall Assessment

**Remediation grade: Strong.** Of the 15 original Red Team findings:
- **9 Fixed** (including all 3 High severity)
- **3 Partially Fixed** (DL-RED-6, DL-RED-8, DL-RED-15 -- all with reasonable mitigations in place)
- **1 Accepted Risk** (DL-RED-9 -- correctly documented)
- **2 Not Fixed** (DL-RED-10, DL-RED-11 -- both Low severity, theoretical-only risks)

All **High severity** findings have been fully remediated. The synthesis cross-check confirms extensive work across the data layer, with 10 of 13 checked synthesis findings fully fixed. The 3 new findings are all Low severity and relate to defense-in-depth gaps rather than exploitable vulnerabilities.

The data layer is now in a solid security posture for a local-only desktop application. The remaining open items (migration pragma interpolation, sanitizeDependsOn depth, validator adoption) are hardening opportunities, not blocking issues.
