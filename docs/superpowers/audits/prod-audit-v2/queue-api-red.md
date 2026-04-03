# Queue API -- Red Team Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** 9 files in Queue API (`src/main/queue-api/` + shared contract + sprint-queries.ts)
**Persona:** Red Team (penetration-test-style code review)
**Baseline:** `docs/superpowers/audits/prod-audit/queue-api-red.md` (10 findings, 2026-03-29)

---

## Remediation Verification Summary

| Original ID | Finding                                                       | Verdict                  | Notes                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-RED-1    | SSE token exposed in query string                             | **Not Fixed**            | `?token=` query param still accepted at `helpers.ts:43-50`. No session token endpoint added. Comment at line 44-45 acknowledges the risk but accepts it for localhost. |
| QA-RED-2    | No rate limiting + non-constant-time string comparison        | **Partially Fixed**      | `timingSafeEqual()` now used at `helpers.ts:66-68`. No rate limiting added. See details below.                                                                         |
| QA-RED-3    | Batch delete has no authorization granularity                 | **Not Fixed (Accepted)** | Comment added at `task-handlers.ts:616-618` documenting the limitation. No ownership checks added. Acceptable for single-user desktop app.                             |
| QA-RED-4    | SQL column name interpolation pattern                         | **Fixed**                | Regex assertion `!/^[a-z_]+$/.test(key)` added at `sprint-queries.ts:211`. Throws on invalid column names. Defense-in-depth now in place.                              |
| QA-RED-5    | Unvalidated `status` query parameter                          | **Fixed**                | `handleListTasks` at `task-handlers.ts:134-148` validates against a `validStatuses` set before querying. Returns 400 for invalid values.                               |
| QA-RED-6    | Agent log access lacks task-level authorization               | **Not Fixed (Accepted)** | Comment added at `agent-handlers.ts:43-44` acknowledging the gap. No ownership verification implemented. Acceptable for single-user desktop app.                       |
| QA-RED-7    | SSE broadcast leaks all events to all clients                 | **Not Fixed (Accepted)** | Comment added at `sse-broadcaster.ts:54-56` documenting the limitation. No per-client filtering implemented.                                                           |
| QA-RED-8    | OPTIONS preflight bypasses authentication                     | **Not Fixed (Accepted)** | Comment updated at `router.ts:18` noting retention for API compatibility. CORS headers are empty so impact is negligible.                                              |
| QA-RED-9    | `skipValidation` bypasses spec quality gates (no audit trail) | **Fixed**                | Logger warnings added at `task-handlers.ts:209` and `task-handlers.ts:376` when `skipValidation=true` is used. Audit trail now exists in logs.                         |
| QA-RED-10   | Unbounded SSE client connections                              | **Fixed**                | `MAX_SSE_CLIENTS = 100` enforced at `sse-broadcaster.ts:13,30-34`. Returns 503 when limit reached.                                                                     |
| QA-RED-11   | Error messages leak internal state                            | **Not Fixed**            | Multiple handlers still return raw error messages to clients. See details below.                                                                                       |

---

## Detailed Verification

### QA-RED-1: SSE Token Exposed in Query String -- NOT FIXED

- **Status:** Not Fixed (accepted risk)
- **Current code:** `helpers.ts:42-50` still accepts `?token=` as auth fallback.
- **Assessment:** The comment at lines 44-45 documents this as acceptable for localhost-only API. No short-lived session token endpoint was implemented as recommended. The risk is real but low for a localhost-bound desktop app. The `EventSource` browser API cannot set custom headers, making this a hard problem to eliminate without a session token flow.
- **Residual risk:** Low. Localhost binding limits exposure. API key is 256-bit, reducing partial-leak brute-force risk.

### QA-RED-2: Non-Constant-Time Comparison -- PARTIALLY FIXED

- **Status:** Timing attack vector eliminated. Rate limiting not added.
- **Current code:** `helpers.ts:58-75` now uses `crypto.timingSafeEqual()` with proper length pre-check.
- **What was fixed:**
  - Import of `timingSafeEqual` from `node:crypto` at line 4.
  - Length comparison before `timingSafeEqual` at line 60 (avoids the `Buffer.alloc` length mismatch throw).
  - Try-catch wrapper at line 72 for robustness.
- **What was not fixed:** No rate limiting on authentication attempts. An attacker with network access can still make unlimited auth attempts per second. Given the 256-bit key space, brute force is computationally infeasible, so this is informational only.
- **Residual risk:** Negligible. The timing side-channel is closed. Brute force against 256-bit keys is not practical.

### QA-RED-3: Batch Delete Authorization -- NOT FIXED (ACCEPTED)

- **Status:** Documented as accepted limitation.
- **Current code:** `task-handlers.ts:616-618` has a comment noting the single-API-key model. `deleteTask(id)` at line 691 still has no ownership check.
- **Residual risk:** Low for single-user desktop app. Would need addressing for multi-tenant deployment.

### QA-RED-4: SQL Column Name Interpolation -- FIXED

- **Status:** Defense-in-depth regex added.
- **Current code:** `sprint-queries.ts:210-213`:
  ```typescript
  if (!/^[a-z_]+$/.test(key)) {
    throw new Error(`Invalid column name: ${key}`)
  }
  ```
- **Assessment:** This is exactly the recommended fix. The regex rejects any key containing characters outside `[a-z_]`, providing a safety net independent of the allowlist. Combined with the existing `UPDATE_ALLOWLIST` filter at line 192, this creates two independent layers of defense against SQL injection via column names.

### QA-RED-5: Unvalidated Status Parameter -- FIXED

- **Status:** Input validation added.
- **Current code:** `task-handlers.ts:134-148` validates against a hardcoded `validStatuses` set including all 8 known statuses. Returns 400 with descriptive error for invalid values.
- **Assessment:** Clean implementation. The set is hardcoded rather than imported from a shared constant, which means it could drift from the canonical status list, but the current values are correct.

### QA-RED-6: Agent Log Access -- NOT FIXED (ACCEPTED)

- **Status:** Documented as accepted limitation.
- **Current code:** Comment at `agent-handlers.ts:43-44` notes that task-level authorization is implicit via API key auth. No ownership verification added.
- **Residual risk:** Low for single-user app. Any holder of the API key can read any agent's logs.

### QA-RED-7: SSE Broadcast Scope -- NOT FIXED (ACCEPTED)

- **Status:** Documented as accepted limitation.
- **Current code:** Comment at `sse-broadcaster.ts:54-56` documents the broadcast-to-all behavior and notes that per-client filtering should be added for multi-tenant environments.
- **Residual risk:** Low for single-user app. All SSE clients see all events.

### QA-RED-8: OPTIONS Preflight -- NOT FIXED (ACCEPTED)

- **Status:** Retained for compatibility, impact negligible.
- **Current code:** `router.ts:18-23` still responds 204 to all OPTIONS requests without auth. With `CORS_HEADERS = {}`, this provides no useful CORS permissions.
- **Assessment:** The original finding acknowledged this was largely a non-issue after the CORS wildcard fix. Keeping it for compatibility is reasonable.

### QA-RED-9: skipValidation Audit Trail -- FIXED

- **Status:** Audit logging added.
- **Current code:**
  - `task-handlers.ts:208-209`: `logger.warn(...)` when skipValidation used on task creation.
  - `task-handlers.ts:375-376`: `logger.warn(...)` when skipValidation used on status update.
- **Assessment:** Both code paths now log when validation is bypassed. The log messages include the task title (creation) or task ID (status update), providing sufficient context for audit review. The logs go to `~/.bde/bde.log` via the structured logger.

### QA-RED-10: Unbounded SSE Clients -- FIXED

- **Status:** Connection limit enforced.
- **Current code:** `sse-broadcaster.ts:13` defines `MAX_SSE_CLIENTS = 100`. Lines 30-34 check the limit and return 503 with a JSON error body when exceeded.
- **Assessment:** The limit of 100 is generous but reasonable for a desktop app. The 503 status code and JSON error body are appropriate. The implementation correctly checks the limit before calling `res.writeHead()`, preventing partial connection setup.

### QA-RED-11: Error Messages Leak Internal State -- NOT FIXED

- **Status:** Still present in multiple handlers.
- **Evidence of remaining leaks:**
  1. `task-handlers.ts:326-328` -- `handleUpdateTask`: `Failed to update task ${id}: ${err.message}`
  2. `task-handlers.ts:436-438` -- `handleUpdateStatus`: `Failed to update task status ${id}: ${err.message}`
  3. `task-handlers.ts:592-594` -- `handleUpdateDependencies`: `Failed to update task dependencies ${id}: ${err.message}`
  4. `task-handlers.ts:610-612` -- `handleDeleteTask`: `Failed to delete task ${id}: ${err.message}`
  5. `task-handlers.ts:702` -- `handleBatchTasks` catch in operation loop: `String(err)` returned per-op
  6. `task-handlers.ts:717` -- `handleBatchTasks` outer catch: `Batch operation failed: ${err}`
  7. `server.ts:36` -- Global error handler: `{ error: 'Internal server error', details: errorMessage }` -- leaks raw error to client
  8. `task-handlers.ts:119-122` -- `handleHealth`: `{ error: 'Failed to get queue stats', details: err.message }`
- **Assessment:** The original recommendation was to log full errors server-side and return generic messages to clients. This was not implemented. The `details` field in error responses can expose SQLite error messages (which may contain file paths, table names, or SQL fragments), Node.js internal errors, or stack traces. The global handler in `server.ts:36` is the most concerning as it catches all unhandled errors and forwards `details: errorMessage` to the client.

---

## New Findings

### QA-RED-12: API Key Cache Not Invalidated on Settings Change

- **Severity:** Low
- **File(s):** `src/main/queue-api/helpers.ts:13-26`
- **Description:** The `cachedApiKey` variable (line 13) caches the API key in memory after first read. The `clearApiKeyCache()` export exists for testing but is never called by the settings system. If an admin changes the `taskRunner.apiKey` setting via the Settings UI or direct SQLite write, the cached key remains active until app restart. This means the old key continues to work and the new key is rejected.
- **Assessment:** Low impact -- key rotation is not a documented workflow, and the app is single-user. But it could cause confusion if someone manually changes the key expecting immediate effect.
- **Recommendation:** Subscribe to setting changes and call `clearApiKeyCache()` when `taskRunner.apiKey` is updated.

### QA-RED-13: `parseBody` Timeout Does Not Account for Slow Reads

- **Severity:** Low
- **File(s):** `src/main/queue-api/helpers.ts:96-162`
- **Description:** The `BODY_PARSE_TIMEOUT_MS` (30 seconds) timeout applies to the entire body parse including the `end` event. However, a malicious client can send data in tiny chunks just under the 30-second deadline, resetting the "activity" because the timeout is absolute (not idle-based). This means a slow-loris style attack would be bounded to 30 seconds per connection rather than indefinite, which is acceptable. The `req.destroy()` call at line 106 properly terminates the socket.
- **Assessment:** The timeout implementation is correct and addresses QA-13 from the synthesis. This is informational only -- the 30-second absolute timeout is a reasonable defense against slow clients.

### QA-RED-14: Batch Operations Can Silently Succeed Despite Individual Failures

- **Severity:** Low
- **File(s):** `src/main/queue-api/task-handlers.ts:619-723`
- **Description:** The batch endpoint wraps all operations in a SQLite transaction (line 711) for atomicity, but individual operation failures within the transaction (caught at line 701-702) do not cause the transaction to rollback. A batch with 10 updates where 3 fail will commit the 7 successful ones and report per-operation status. This is documented behavior (comment at line 721), but the transaction wrapper creates a false expectation of atomicity.
- **Assessment:** The transaction ensures consistency at the SQL level (no partial writes if the process crashes mid-batch). Individual business-logic failures (task not found, no valid fields) are expected to be non-fatal. The current behavior is reasonable but could be documented more clearly.

### QA-RED-15: Health Endpoint Authenticated -- Monitoring Impact

- **Severity:** Informational
- **File(s):** `src/main/queue-api/router.ts:26,32-34`
- **Description:** The `GET /queue/health` endpoint requires authentication (line 26 -- `checkAuth` runs before all routes). Health endpoints are conventionally unauthenticated to support monitoring systems (load balancers, uptime checks) that may not have credentials. For a localhost-only desktop API this is fine, but it means external monitoring tools would need the API key.
- **Assessment:** Informational only. The current behavior is correct for a single-user API.

---

## Previously Open Items from Synthesis (Cross-Reference)

| Synthesis ID | Issue                                                         | Current Status                                                                                                                                |
| ------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-9         | `parseBody` continues after size rejection / double-rejection | **Fixed.** `settled` flag at line 100, checked at lines 122 and 139. `cleanup()` removes all listeners. Timeout at line 103 destroys request. |
| QA-10        | `handleUpdateStatus` does not validate `status` is present    | **Fixed.** Check at `task-handlers.ts:359-362`.                                                                                               |
| QA-11        | `blocked` missing from `RUNNER_WRITABLE_STATUSES`             | **Fixed.** Added at `queue-api-contract.ts:45` with comment.                                                                                  |
| QA-12        | No API key caching                                            | **Fixed.** `cachedApiKey` at `helpers.ts:13` with `clearApiKeyCache()` for testing.                                                           |
| QA-13        | No request timeout on body parsing                            | **Fixed.** `BODY_PARSE_TIMEOUT_MS = 30_000` at `helpers.ts:94`, enforced via `setTimeout` at line 103.                                        |
| QA-14        | General PATCH silently drops disallowed fields                | **Fixed.** Returns 400 with disallowed field names at `task-handlers.ts:309-313`.                                                             |
| ARCH-2       | Repository pattern inconsistently applied                     | **Not Fixed.** `task-handlers.ts` still imports `sprint-queries` directly (lines 7-19). Not a direct security issue.                          |

---

## Summary Table

| Severity  | Original Count | Fixed                             | Partially Fixed | Not Fixed (Accepted)             | Not Fixed     |
| --------- | -------------- | --------------------------------- | --------------- | -------------------------------- | ------------- |
| Critical  | 0              | 0                                 | 0               | 0                                | 0             |
| High      | 0              | 0                                 | 0               | 0                                | 0             |
| Medium    | 5              | 1 (QA-RED-9)                      | 1 (QA-RED-2)    | 3 (QA-RED-1, QA-RED-3, QA-RED-7) | 0             |
| Low       | 5              | 3 (QA-RED-4, QA-RED-5, QA-RED-10) | 0               | 1 (QA-RED-8)                     | 1 (QA-RED-11) |
| **Total** | **10**         | **4**                             | **1**           | **4**                            | **1**         |

New findings: 3 Low + 1 Informational (QA-RED-12 through QA-RED-15).

---

## Overall Assessment

**The Queue API's security posture has materially improved since the initial audit.** Four of the ten original findings are fully remediated, and one more is partially fixed. The four "accepted" findings are appropriately scoped decisions for a single-user localhost desktop application -- they would need revisiting only if BDE's Queue API were exposed to multiple users or network-accessible.

**Key improvements:**

- Timing-safe token comparison (QA-RED-2) eliminates the most technically exploitable attack vector
- SQL column name regex (QA-RED-4) adds a robust defense-in-depth layer
- Body parse hardening (QA-9, QA-13) closes resource exhaustion and double-rejection bugs
- SSE client limits (QA-RED-10) prevent connection exhaustion
- Input validation on status parameter (QA-RED-5) and status field presence (QA-10)
- Audit trail for validation bypass (QA-RED-9) enables post-hoc review

**Remaining action item:**

- **QA-RED-11 (error message sanitization)** is the only finding that is both not fixed and not explicitly accepted. This is a straightforward fix (log full error, return generic message) across 8 locations in `task-handlers.ts` and `server.ts`. Priority: Low, but it would close the last unaccepted gap.

**Threat model note:** The Queue API binds to `127.0.0.1:18790` (not externally accessible), uses a 256-bit auto-generated API key, and runs in a single-user desktop app context. The residual risk from all unfixed findings combined is **Low** under this threat model.
