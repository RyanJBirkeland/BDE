# Queue API — UX QA Audit

**Date:** 2026-03-29
**Scope:** 15 files in Queue API (`src/main/queue-api/` + tests + `src/shared/queue-api-contract.ts`)
**Persona:** UX QA — API Consumer Experience

---

## Cross-Reference with March 28 Audit

### Previously Reported — Now Fixed

| #     | Issue                                                                                                                                                                                                                            | Status    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| SEC-5 | **CORS `*` on auth-protected localhost API** — `helpers.ts` line 57 now exports `CORS_HEADERS = {}` with a comment explaining the removal. The wildcard `Access-Control-Allow-Origin: *` has been replaced with an empty object. | **Fixed** |

### Previously Reported — Still Open

| #                                        | Issue                                                                                                                                                                                                                                                                                           | Status     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| ARCH-2                                   | **Repository pattern inconsistently applied** — Queue API `task-handlers.ts` still imports `sprint-queries` directly (lines 7-18) rather than going through `ISprintTaskRepository`. This means Queue API writes do not trigger the same notification side effects as agent manager writes.     | Still open |
| main-process-ax 4.8 / main-process-pm M1 | **Stale "Supabase proxy" JSDoc in server.ts** — `server.ts` line 3 still reads `"Queue API HTTP server — lightweight Supabase proxy on port 18790"`. BDE migrated to local SQLite; this is no longer a Supabase proxy. Misleading for anyone reading the code or API consumers checking source. | Still open |
| main-process-sd C4                       | **SSE token via query-string exposure** — `checkAuth()` in `helpers.ts` lines 30-35 accepts `?token=` query param. This is documented as accepted risk for SSE clients that cannot set headers, but the token is logged in access logs and browser history. No change since March 28.           | Still open |

### New Findings

See below.

---

## Findings

### QA-UX-1: Inconsistent field naming between create and release endpoints (snake_case vs camelCase)

- **Severity:** high
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:454`, `src/main/queue-api/task-handlers.ts:412-413`
- **Description:** The `/queue/tasks/:id/claim` endpoint expects `executorId` (camelCase), but the `/queue/tasks/:id/release` endpoint expects `claimed_by` (snake_case). API consumers must memorize which endpoint uses which convention. The `POST /queue/tasks` creation endpoint also expects `depends_on` (snake_case) while `PATCH /queue/tasks/:id/dependencies` expects `dependsOn` (camelCase). This inconsistency is a frequent source of 400 errors for consumers.
- **Evidence:**
  - Claim (line 412): `const { executorId } = body as ClaimRequest` — camelCase
  - Release (line 454): `const claimedBy = (body as Record<string, unknown>).claimed_by as string` — snake_case
  - Create (line 149): `const { title, repo, depends_on } = body` — snake_case
  - Update deps (line 488): `const { dependsOn } = body` — camelCase
- **Recommendation:** Standardize all request body fields to camelCase (matching the response format). Accept both conventions during a transition period using the `field-mapper.ts` `toSnakeCase()` on incoming bodies.

### QA-UX-2: General PATCH silently drops disallowed fields with no feedback

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:260-271`
- **Description:** When a consumer sends `PATCH /queue/tasks/:id` with fields like `status`, `claimed_by`, or `depends_on`, those fields are silently filtered out by `GENERAL_PATCH_FIELDS`. If ALL fields in the request are disallowed, the consumer gets `"No valid fields to update"` — but if some fields are allowed and some aren't, the disallowed ones vanish silently. The consumer may believe their status change took effect when it didn't.
- **Evidence:**
  ```
  PATCH /queue/tasks/abc { "title": "New", "status": "done" }
  → 200 OK (title updated, status silently ignored)
  ```
  The consumer sees a 200 and assumes `status` was updated.
- **Recommendation:** Include a `warnings` array in the response listing which fields were ignored and why: `{ ...task, _warnings: ["status: must use PATCH /queue/tasks/:id/status"] }`. Alternatively, return 400 if any disallowed fields are present.

### QA-UX-3: `RUNNER_WRITABLE_STATUSES` excludes `blocked` and `backlog` — no way to manually unblock or reset via status endpoint

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/shared/queue-api-contract.ts:43-50`, `src/main/queue-api/task-handlers.ts:309`
- **Description:** `RUNNER_WRITABLE_STATUSES` only includes `queued`, `active`, `done`, `failed`, `cancelled`, `error`. A consumer cannot transition a task back to `backlog` (e.g., to de-queue it) or manually set `blocked`. While `blocked` is typically auto-set by dependency logic, there's no API path to manually unblock a task that was incorrectly blocked, nor to move a task back to `backlog` for rework. The error message `"Invalid status: backlog"` is confusing because `backlog` is a valid task status in the system — just not writable here.
- **Evidence:**
  ```
  PATCH /queue/tasks/abc/status { "status": "backlog" }
  → 400 { "error": "Invalid status: backlog" }
  ```
- **Recommendation:** Add `backlog` and `blocked` to `RUNNER_WRITABLE_STATUSES`, or improve the error message to explain: `"Status 'backlog' cannot be set via this endpoint. Use PATCH /queue/tasks/:id to update other fields."` Also consider adding `backlog` as a writable status for de-queueing use cases.

### QA-UX-4: No individual DELETE endpoint for tasks

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/router.ts` (missing route), `src/main/queue-api/task-handlers.ts:606` (delete exists in batch only)
- **Description:** The `deleteTask` function is imported and used in the batch endpoint (`POST /queue/tasks/batch` with `op: "delete"`), but there is no `DELETE /queue/tasks/:id` route. Consumers who need to delete a single task must construct a batch request with one operation. This is unnecessarily complex and non-standard REST.
- **Evidence:** The router (lines 77-82) matches `GET` and `PATCH` for `/queue/tasks/:id` but not `DELETE`. `deleteTask` is imported on line 14 of task-handlers but only called within `handleBatchTasks`.
- **Recommendation:** Add a `DELETE /queue/tasks/:id` route in `router.ts` and a corresponding `handleDeleteTask` handler. The handler already exists in batch form — extract and expose it.

### QA-UX-5: Error response inconsistency — some handlers catch errors locally, others fall through to global handler

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:275-280` vs `src/main/queue-api/server.ts:31-36`
- **Description:** `handleUpdateTask` and `handleUpdateStatus` catch errors from `updateTask()` and return `500` with the actual error message (e.g., `"Failed to update task abc: UNIQUE constraint failed"`). But `handleHealth`, `handleListTasks`, `handleGetTask`, `handleCreateTask`, `handleClaim`, and `handleRelease` do NOT catch errors from their query calls — they fall through to the global handler in `server.ts` which returns a generic `"Internal server error"`. This means:
  - For update operations: consumers get specific error messages (potentially leaking internal details)
  - For all other operations: consumers get an opaque `"Internal server error"`
    The inconsistency makes debugging harder and the specific messages may leak SQLite internals.
- **Evidence:**
  - `handleUpdateTask` line 278: `error: \`Failed to update task ${id}: ${err.message}\`` — specific
  - `handleHealth` has no try/catch — falls to server.ts line 35: `{ error: 'Internal server error' }` — generic
- **Recommendation:** Standardize: either all handlers catch and return specific messages, or all handlers let errors propagate to the global handler. Prefer the latter (global handler) with structured logging, and return consistent `{ error: "Internal server error", requestId: "..." }` for all 500s.

### QA-UX-6: `handleUpdateStatus` returns 400 with `"No valid fields to update"` when only `status` is sent and it's filtered correctly

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:359-369`
- **Description:** If a consumer sends `PATCH /queue/tasks/:id/status` with a body containing only fields NOT in `STATUS_UPDATE_FIELDS`, they get the unhelpful error `"No valid fields to update"`. This is the same error as the general PATCH endpoint, despite being a different endpoint with different allowed fields. The consumer has no way to know which fields ARE valid.
- **Evidence:**
  ```
  PATCH /queue/tasks/abc/status { "title": "new title" }
  → 400 { "error": "No valid fields to update" }
  ```
  Consumer doesn't know to use the general PATCH endpoint for `title`.
- **Recommendation:** Return a more specific error: `"No valid fields for status update. Allowed fields: status, notes, prUrl, prNumber, prStatus, completedAt, startedAt, agentRunId, retryCount, fastFailCount, maxRuntimeMs, needsReview"`.

### QA-UX-7: Stale JSDoc describes server as "Supabase proxy"

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/server.ts:2-5`
- **Description:** The module JSDoc reads: `"Queue API HTTP server — lightweight Supabase proxy on port 18790. Allows external runners (without Supabase credentials) to consume the sprint task queue via a simple REST interface."` BDE migrated to local SQLite and is no longer a Supabase proxy. Multiple test files also reference "Mock sprint-queries — intercept all Supabase calls" in comments. This is misleading for API consumers reading source or contributors.
- **Evidence:** `server.ts` lines 2-5, `queue-api.test.ts` line 5, `queue-api-auth.test.ts` line 13, `queue-api-integration.test.ts` line 13, `queue-api-sse.test.ts` line 16.
- **Recommendation:** Update JSDoc to: `"Queue API HTTP server — local task queue on port 18790. Allows external runners to consume the sprint task queue via a simple REST interface."` Update test comments similarly.

### QA-UX-8: SSE `event: task:output` wraps task output events but SSE `event` field is always `task:output` — no way to filter by event type at SSE level

- **Severity:** low
- **Effort:** M (1-4hr)
- **File(s):** `src/main/queue-api/event-handlers.ts:68-69`, `src/main/queue-api/sse-broadcaster.ts:44-45`
- **Description:** When events are broadcast via SSE, they all use the SSE event type `task:output` regardless of the inner event type (`agent:started`, `agent:tool_call`, etc.). An SSE consumer using `EventSource` cannot use `addEventListener('agent:started', ...)` — they must listen for `task:output` and parse/filter the JSON data payload. The inner event's `type` field is buried inside the JSON data, requiring every consumer to implement their own filtering.
- **Evidence:** `event-handlers.ts` line 69: `sseBroadcaster.broadcast('task:output', { taskId, ...event })` — always `task:output` regardless of inner type. SSE format is: `event: task:output\ndata: {"taskId":"...","type":"agent:started",...}\n\n`.
- **Recommendation:** Use the inner event type as the SSE event name: `sseBroadcaster.broadcast(event.type ?? 'task:output', ...)`. This allows consumers to use `eventSource.addEventListener('agent:started', ...)` directly. Maintain backward compat by also broadcasting on `task:output`.

### QA-UX-9: `handleTaskOutput` returns `{ ok: true }` instead of standard task response

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/event-handlers.ts:100`
- **Description:** `POST /queue/tasks/:id/output` returns `{ ok: true }` on success, while every other mutation endpoint returns the updated resource. This inconsistency forces consumers to special-case this endpoint's response handling.
- **Evidence:** Line 100: `sendJson(res, 200, { ok: true })`. Compare with `handleUpdateTask` (line 287): `sendJson(res, 200, toCamelCase(updated))`.
- **Recommendation:** Return `{ ok: true, persisted: N }` where N is the count of curated events persisted to SQLite, giving consumers visibility into what was actually stored vs. just broadcast.

### QA-UX-10: `parseBody` can resolve with `null` for empty body — callers must check separately

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/helpers.ts:84-86`
- **Description:** When the request body is empty, `parseBody` resolves with `null`. Every handler then has to check `if (!body || typeof body !== 'object')` and return a 400. If `parseBody` rejected on empty body (for endpoints that require a body), this boilerplate could be eliminated. Not a consumer-facing issue per se, but it means empty-body requests get `"Request body must be a JSON object"` which doesn't tell the consumer the body was empty specifically.
- **Evidence:** Lines 84-86 in `helpers.ts`: empty string resolves as `null`. Then every handler (lines 144, 254, 304, 407, 450, 483, 553 in task-handlers.ts) repeats the same null check.
- **Recommendation:** Add a `parseJsonBody(req, res)` wrapper that rejects empty bodies with `{ error: "Request body is empty" }` for endpoints that require a body.

### QA-UX-11: `handleTaskOutput` does not validate task existence

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/event-handlers.ts:40-101`
- **Description:** `POST /queue/tasks/:id/output` broadcasts events and persists them without checking if the task ID actually exists. A consumer posting events for a nonexistent task gets `200 { ok: true }` — a silent success with no indication the task ID is wrong. Events are persisted to SQLite with the nonexistent task ID as the agent ID, creating orphaned data.
- **Evidence:** The handler (lines 40-101) never calls `getTask(taskId)` to validate existence. Compare with `handleAgentLog` (agent-handlers.ts lines 43-48) which checks `hasAgent(agentId)` before proceeding.
- **Recommendation:** Add a task existence check at the top of `handleTaskOutput` and return 404 if the task doesn't exist.

### QA-UX-12: Batch endpoint always returns 200 even when all operations fail

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:622-623`
- **Description:** `POST /queue/tasks/batch` returns HTTP 200 with per-operation results regardless of how many operations failed. If all 50 operations fail, the consumer still gets 200. This makes it harder for consumers to detect failures via HTTP status alone — they must parse the response body and check each result's `ok` field.
- **Evidence:** Line 623: `sendJson(res, 200, { results })` — unconditional 200.
- **Recommendation:** Return 207 (Multi-Status) when the batch contains mixed results (some succeed, some fail), or 200 only when all succeed. Add a top-level `{ ok: false, failCount: N, results: [...] }` summary.

### QA-UX-13: No API discovery or documentation endpoint

- **Severity:** low
- **Effort:** M (1-4hr)
- **File(s):** `src/main/queue-api/router.ts`
- **Description:** There is no `GET /queue` or `GET /queue/docs` endpoint that lists available endpoints, expected request formats, or API version. Consumers must read source code to understand the API surface. The health endpoint returns `version: '1.0.0'` but there's no way to discover what that version supports.
- **Recommendation:** Add a `GET /queue` endpoint returning a list of available routes with their methods and brief descriptions. This is low priority since the API is consumed by a small number of known services.

---

## Summary

| Severity | Count      |
| -------- | ---------- |
| Critical | None found |
| High     | 1          |
| Medium   | 4          |
| Low      | 8          |

**Total findings:** 13

**Key themes:**

1. **Field naming inconsistency** (QA-UX-1) is the highest-impact consumer-facing issue — snake_case vs camelCase varies by endpoint.
2. **Silent field dropping** (QA-UX-2) can cause consumers to believe mutations succeeded when key fields were ignored.
3. **Error message quality** varies widely — some endpoints return specific actionable messages while others return opaque `"Internal server error"` (QA-UX-5, QA-UX-6).
4. **Missing REST conventions** — no individual DELETE, batch always returns 200, output endpoint doesn't validate task existence (QA-UX-4, QA-UX-11, QA-UX-12).

**Positive notes:**

- Error response format is consistently JSON `{ error: "..." }` across all endpoints — no plain text or empty responses.
- Auth handling is solid with clear 401 vs 403 differentiation.
- Dependency validation (cycle detection, existence checks) returns helpful specific messages.
- Field mapping (`toCamelCase`/`toSnakeCase`) is well-tested with edge cases (malformed JSON, empty arrays, mixed valid/invalid deps).
- SSE implementation correctly handles client disconnection and has heartbeat keepalive.
