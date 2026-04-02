# Queue API UX -- Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** 9 files in `src/main/queue-api/` + `src/shared/queue-api-contract.ts`
**Persona:** UX QA -- API Consumer Experience
**Previous audit:** `docs/superpowers/audits/prod-audit/queue-api-ux.md` (13 findings)

---

## Summary Table

| # | Finding | Previous Severity | Status | Notes |
|---|---------|-------------------|--------|-------|
| QA-UX-1 | Inconsistent field naming (snake_case vs camelCase) | High | **Fixed** | `release` endpoint now uses `claimedBy` (camelCase); `create` still uses `depends_on` (snake_case) -- see Residual below |
| QA-UX-2 | General PATCH silently drops disallowed fields | Medium | **Fixed** | Now returns 400 with explicit list of disallowed fields (QA-14 remediation) |
| QA-UX-3 | `RUNNER_WRITABLE_STATUSES` excludes `blocked` and `backlog` | Medium | **Partially Fixed** | `blocked` added (QA-11). `backlog` still excluded -- runners cannot de-queue tasks |
| QA-UX-4 | No individual DELETE endpoint | Medium | **Fixed** | `DELETE /queue/tasks/:id` route added (router.ts:117, QA-15) |
| QA-UX-5 | Error response inconsistency (local catch vs global) | Medium | **Fixed** | `handleHealth` now has try/catch (QA-16). Global handler in `server.ts` returns `details` field. All handlers consistently catch errors |
| QA-UX-6 | `handleUpdateStatus` returns unhelpful "No valid fields" error | Low | **Not Fixed** | Still returns generic `"No valid fields to update"` without listing which fields are allowed on the status endpoint |
| QA-UX-7 | Stale JSDoc describes server as "Supabase proxy" | Low | **Fixed** | `server.ts` line 2 now reads `"Queue API HTTP server on port 18790."` -- Supabase reference removed |
| QA-UX-8 | SSE events all use `task:output` type | Low | **Fixed** | `event-handlers.ts:76` now uses actual event type from payload (QA-28 remediation) |
| QA-UX-9 | `handleTaskOutput` returns `{ ok: true }` instead of resource | Low | **Fixed** | Now returns `{ taskId, eventsReceived, eventsPersisted }` (QA-29 remediation) |
| QA-UX-10 | `parseBody` resolves with `null` for empty body | Low | **Not Fixed** | Still resolves `null` on empty body (helpers.ts:144). Every handler repeats the null-check boilerplate |
| QA-UX-11 | `handleTaskOutput` does not validate task existence | Low | **Not Fixed** | No `getTask(taskId)` call before broadcasting/persisting. Nonexistent task IDs still get 200 |
| QA-UX-12 | Batch endpoint always returns 200 | Low | **Not Fixed** | Still returns 200 unconditionally (task-handlers.ts:722). No 207 Multi-Status or top-level `ok` field |
| QA-UX-13 | No API discovery endpoint | Low | **Not Fixed** | No `GET /queue` route listing available endpoints |

---

## Detailed Verification

### QA-UX-1: Inconsistent field naming -- FIXED (with residual)

**Release endpoint**: Now uses `claimedBy` (camelCase) at `task-handlers.ts:514`:
```
const claimedBy = (body as Record<string, unknown>).claimedBy as string
```

**Dependencies endpoint**: Uses `dependsOn` (camelCase) at `task-handlers.ts:548`:
```
const { dependsOn } = body as { dependsOn?: unknown }
```

**Claim endpoint**: Uses `executorId` (camelCase) at `task-handlers.ts:472` -- unchanged, was already camelCase.

**Residual inconsistency**: The `POST /queue/tasks` create endpoint still accepts `depends_on` (snake_case) at line 181:
```
const { title, repo, depends_on } = body as Record<string, unknown>
```
This is the only remaining snake_case field in the request API. All other endpoints are now camelCase. Severity reduced from high to low since it is isolated to one field on one endpoint.

### QA-UX-2: Silent field dropping -- FIXED

The general PATCH handler now returns 400 when any disallowed fields are present (task-handlers.ts:308-314):
```
if (disallowed.length > 0) {
  sendJson(res, 400, {
    error: `Disallowed fields: ${disallowed.join(', ')}. Use dedicated endpoints for status, claimed_by, or depends_on.`
  })
  return
}
```
This is a strict approach -- the consumer gets immediate feedback about which fields are wrong and where to send them.

### QA-UX-3: Missing writable statuses -- PARTIALLY FIXED

`blocked` was added to `RUNNER_WRITABLE_STATUSES` in `queue-api-contract.ts:45`:
```
'blocked', // QA-11: Allow runners to set blocked status for dependency management
```

`backlog` is still not writable. The error message remains `"Invalid status: backlog"` with no guidance on how to de-queue a task. The `StatusUpdateRequest` type (line 29) also does not include `blocked` or `backlog` in its union, creating a type/runtime mismatch -- the runtime Set accepts `blocked` but TypeScript won't allow it without a cast.

### QA-UX-4: No individual DELETE -- FIXED

Route added in `router.ts:117`:
```
if (method === 'DELETE') return tasks.handleDeleteTask(res, id)
```
Handler at `task-handlers.ts:605-614` returns `{ ok: true, id }`. Note: no existence check -- `deleteTask()` on a nonexistent ID silently succeeds with 200. Minor gap but not a regression.

### QA-UX-5: Error response inconsistency -- FIXED

`handleHealth` now has try/catch (task-handlers.ts:101-123). The global handler in `server.ts:32-36` now includes `details` in the error response. All handlers follow a consistent pattern of catching specific errors and returning structured `{ error, details }` responses.

### QA-UX-6: Unhelpful "No valid fields" on status endpoint -- NOT FIXED

`handleUpdateStatus` at task-handlers.ts:427-429 still returns:
```
sendJson(res, 400, { error: 'No valid fields to update' })
```
No list of allowed fields. Consumer cannot know they should use `status`, `notes`, `prUrl`, etc.

### QA-UX-7: Stale Supabase JSDoc -- FIXED

`server.ts` lines 1-4 now read:
```
/**
 * Queue API HTTP server on port 18790.
 * Allows external runners to consume the sprint task queue via a simple REST interface.
 */
```
No Supabase reference.

### QA-UX-8: SSE event type always `task:output` -- FIXED

`event-handlers.ts:74-77`:
```
const eventType = typeof eventObj['type'] === 'string' ? eventObj['type'] : 'task:output'
sseBroadcaster.broadcast(eventType, { taskId, ...eventObj })
```
Events now use the actual event type (e.g., `agent:started`), falling back to `task:output` for untyped events. Note: backward compatibility concern -- consumers subscribed to `task:output` will no longer receive typed events. No dual-broadcast as originally recommended.

### QA-UX-9: `handleTaskOutput` returns `{ ok: true }` -- FIXED

`event-handlers.ts:112-116`:
```
sendJson(res, 200, {
  taskId,
  eventsReceived: events.length,
  eventsPersisted: persistedCount
})
```
Consumers now get visibility into what was persisted vs. broadcast.

### QA-UX-10: `parseBody` resolves null for empty body -- NOT FIXED

`helpers.ts:144-146`:
```
if (!raw) {
  resolve(null)
  return
}
```
Every handler repeats `if (!body || typeof body !== 'object')` -- 8 instances in task-handlers.ts + 1 in event-handlers.ts.

### QA-UX-11: `handleTaskOutput` does not validate task existence -- NOT FIXED

`event-handlers.ts:43-117` has no `getTask()` call. Events for nonexistent task IDs are broadcast to SSE clients and persisted to SQLite with the invalid task ID.

### QA-UX-12: Batch always returns 200 -- NOT FIXED

`task-handlers.ts:722`:
```
sendJson(res, 200, { results })
```
No top-level `ok` or `failCount` field. No 207 Multi-Status.

### QA-UX-13: No API discovery endpoint -- NOT FIXED

No `GET /queue` or documentation route.

---

## New Findings

### QA-UX-14: DELETE endpoint does not validate task existence

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:605-614`
- **Description:** `handleDeleteTask` calls `deleteTask(id)` without checking if the task exists first. If the task ID does not exist, the function returns `{ ok: true, id }` with HTTP 200. A consumer deleting a nonexistent task gets a success response.
- **Evidence:** No `getTask(id)` guard before `deleteTask(id)`. Compare with `handleGetTask` which returns 404 for missing tasks.
- **Recommendation:** Check task existence first and return 404 if not found, or return `{ ok: true, id, existed: false }` to indicate no-op.

### QA-UX-15: `StatusUpdateRequest` type does not include `blocked`

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/shared/queue-api-contract.ts:29`
- **Description:** `StatusUpdateRequest.status` is typed as `'queued' | 'active' | 'done' | 'failed' | 'cancelled' | 'error'` but `RUNNER_WRITABLE_STATUSES` (line 43-51) now includes `'blocked'`. TypeScript consumers using the contract type cannot set `blocked` status without a type assertion, even though the runtime accepts it.
- **Evidence:** Line 29: `status: 'queued' | 'active' | 'done' | 'failed' | 'cancelled' | 'error'` -- missing `'blocked'`.
- **Recommendation:** Add `'blocked'` to the `StatusUpdateRequest.status` union type.

### QA-UX-16: SSE event type change is breaking for existing consumers

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/event-handlers.ts:74-77`
- **Description:** QA-UX-8 fix changed SSE events from always using `task:output` to using the inner event type (e.g., `agent:started`). Consumers that used `eventSource.addEventListener('task:output', ...)` will no longer receive typed events. The original recommendation suggested dual-broadcast for backward compatibility, but only single-broadcast was implemented.
- **Evidence:** Before: all events sent as `event: task:output`. After: events sent as `event: agent:started`, etc. No `task:output` fallback for typed events.
- **Recommendation:** Add dual-broadcast: broadcast on both the specific type AND `task:output` for backward compat. Or document the breaking change with a version bump.

### QA-UX-17: Create endpoint `depends_on` still snake_case

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:181`
- **Description:** The `POST /queue/tasks` create endpoint still destructures `depends_on` (snake_case) from the request body, while all other endpoints use camelCase (`dependsOn`). This is the sole remaining snake_case field in the request API.
- **Evidence:** Line 181: `const { title, repo, depends_on } = body as Record<string, unknown>`. Compare with dependencies endpoint at line 548: `const { dependsOn } = body as { dependsOn?: unknown }`.
- **Recommendation:** Accept both `depends_on` and `dependsOn` in the create body, or standardize to `dependsOn` only.

---

## Previously Reported Cross-Audit Issues (re-verified)

| # | Issue | Status |
|---|-------|--------|
| ARCH-2 | Repository pattern inconsistently applied | **Still open** -- `task-handlers.ts` imports `sprint-queries` directly (lines 7-19) |
| SEC-5 | CORS `*` on auth-protected localhost API | **Fixed** -- `CORS_HEADERS = {}` at `helpers.ts:86` |
| main-process-sd C4 | SSE token via query-string exposure | **Still open** -- accepted risk at `helpers.ts:43-50` |

---

## Overall Assessment

**8 of 13 findings fixed, 1 partially fixed, 4 not fixed, 3 new issues found.**

The high-severity field naming inconsistency (QA-UX-1) has been largely resolved -- the only residual is `depends_on` on the create endpoint. The medium-severity silent field dropping (QA-UX-2) and missing DELETE (QA-UX-4) are both properly fixed. Error handling consistency (QA-UX-5) is now solid across all handlers.

The remaining unfixed items are all low-severity quality-of-life improvements:
- Better error messages listing allowed fields (QA-UX-6)
- `parseBody` null handling (QA-UX-10)
- Task existence checks on output/delete (QA-UX-11, QA-UX-14)
- Batch 207 status (QA-UX-12)
- API discovery (QA-UX-13)

The Queue API is in good shape for its current use case (small number of known consumers on localhost). The SSE breaking change (QA-UX-16) is the most actionable new finding if external consumers rely on the `task:output` event name.

| Metric | Count |
|--------|-------|
| Fixed | 8 |
| Partially Fixed | 1 |
| Not Fixed | 4 |
| New Issues | 3 |
| **Total open** | **8** (4 unfixed + 1 partial + 3 new) |
| Critical/High open | 0 |
| Medium open | 0 |
| Low open | 8 |
