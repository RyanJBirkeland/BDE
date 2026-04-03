# Queue API -- Reliability Engineer Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** 9 source files in `src/main/queue-api/`, 1 shared contract
**Persona:** Reliability Engineer
**Previous audit:** `docs/superpowers/audits/prod-audit/queue-api-reliability.md` (17 findings)

---

## Summary Table

| Finding   | Severity | Status              | Notes                                                                                                                         |
| --------- | -------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| QA-REL-1  | Medium   | **Fixed**           | `settled` flag + `cleanup()` prevents double-rejection and chunk accumulation                                                 |
| QA-REL-2  | Medium   | **Partially Fixed** | `parseBody` guards with `res.writableEnded` before sending; 6 of 7 handler catch blocks still do not                          |
| QA-REL-3  | Low      | **Partially Fixed** | `close()` method properly clears interval; `stopQueueApi()` still does not call `sseBroadcaster.close()`                      |
| QA-REL-4  | Medium   | **Fixed**           | Explicit `if (!patch.status)` guard added at line 359                                                                         |
| QA-REL-5  | Medium   | **Fixed**           | `blocked` added to `RUNNER_WRITABLE_STATUSES` with comment at `queue-api-contract.ts:45`                                      |
| QA-REL-6  | High     | **Fixed**           | Batch operations wrapped in `db.transaction()` at `task-handlers.ts:710-712`                                                  |
| QA-REL-7  | Low      | **Not Fixed**       | SSE handler still only uses `res.on('close')` for disconnect detection                                                        |
| QA-REL-8  | Low      | **Fixed**           | Event broadcast now uses actual event type from payload; filter guards events properly                                        |
| QA-REL-9  | Medium   | **Fixed**           | Empty catch replaced with `logger.error()` at `event-handlers.ts:107`                                                         |
| QA-REL-10 | Medium   | **Fixed**           | Module-level `cachedApiKey` with `clearApiKeyCache()` export at `helpers.ts:12-31`                                            |
| QA-REL-11 | Low      | **Fixed**           | `dependsOn === undefined` now returns 400 at `task-handlers.ts:551-553`                                                       |
| QA-REL-12 | Medium   | **Fixed**           | `BODY_PARSE_TIMEOUT_MS = 30_000` timeout in `parseBody` at `helpers.ts:103-112`                                               |
| QA-REL-13 | Low      | **Fixed**           | Router reordered to match longest routes first; comment block documents ordering constraint at `router.ts:62-66`              |
| QA-REL-14 | Low      | **Fixed**           | `handleHealth` wrapped in try/catch, returns 500 with error details at `task-handlers.ts:101-123`                             |
| QA-REL-15 | Medium   | **Fixed**           | `DELETE /queue/tasks/:id` now routed to `handleDeleteTask` at `router.ts:117`                                                 |
| QA-REL-16 | Low      | **Fixed**           | `createLogger('queue-api:tasks')` used at module level; `validateTaskCreation` receives a logger wrapper at line 196          |
| QA-REL-17 | Low      | **Fixed**           | SSE broadcaster tests now cover `close()`, heartbeat (with `vi.useFakeTimers`), max client limit, and heartbeat error removal |

---

## Detailed Analysis

### QA-REL-1: `parseBody` double-rejection -- FIXED

The `parseBody` function in `helpers.ts:96-162` now uses a `settled` boolean guard (line 100) and a `cleanup()` helper (lines 114-119) that removes all listeners and clears the timeout. The `data` handler checks `if (settled) return` (line 122) before processing. The `end` handler does the same (line 139). The `error` handler also guards with `settled` (line 156). This eliminates double-rejection and prevents chunk accumulation after size rejection.

Additionally, a `BODY_PARSE_TIMEOUT_MS` timeout (30 seconds) was added (lines 103-112), which also uses the `settled` guard and `cleanup()` before rejecting.

**Verdict:** Fully remediated.

### QA-REL-2: Double-send response on `parseBody` rejection -- PARTIALLY FIXED

`parseBody` now guards its own response-sending with `res && !res.writableEnded` (line 107 for timeout, line 129 for size limit). This prevents parseBody from sending a response if the stream is already ended.

However, the handler-side catch blocks in `task-handlers.ts` still unconditionally call `sendJson(res, 400, ...)` when `parseBody` rejects:

- `handleCreateTask` (line 172)
- `handleUpdateTask` (line 286)
- `handleUpdateStatus` (line 348)
- `handleClaim` (line 464)
- `handleRelease` (line 506)
- `handleUpdateDependencies` (line 540)
- `handleBatchTasks` (line 628)

If `parseBody` sends 413 or 408 before rejecting, the catch block's `sendJson` attempts to write headers on an ended response, throwing "Cannot set headers after they are sent". This is caught by the global handler in `server.ts:30-38` and logged, so it does not crash the process. But it produces spurious "Unhandled error" log entries.

The `handleTaskOutput` in `event-handlers.ts:53` correctly checks `if (!res.writableEnded)` before sending -- this pattern should be applied to the 7 task-handler catch blocks.

**Verdict:** Partially fixed. The root cause (double-rejection in parseBody) is fixed. The symptom (double-send in handler catch blocks) remains in 7 locations.

### QA-REL-3: SSE heartbeat interval leak on shutdown -- PARTIALLY FIXED

The `close()` method in `sse-broadcaster.ts:67-79` now properly clears the interval, ends all client connections, and clears the client set. Tests confirm this works.

However, `stopQueueApi()` in `server.ts:57-72` still does **not** call `sseBroadcaster.close()`. It calls `server.closeAllConnections()` and `server.close()`, which tears down TCP connections but leaves the heartbeat `setInterval` running. The broadcaster is a module-level singleton in `event-handlers.ts:17`, and `server.ts` does not import or reference it.

In practice, `server.closeAllConnections()` will close the underlying sockets, causing subsequent heartbeat writes to throw (which the broadcaster catches and removes clients). But the interval itself continues ticking every 30 seconds until process exit. For Electron's main process this is minor (the process exits shortly after), but it prevents clean shutdown in test environments and would leak in a long-running server context.

**Verdict:** Partially fixed. The `close()` method works correctly but is not called during server shutdown.

### QA-REL-4: Missing `status` validation in `/status` endpoint -- FIXED

`handleUpdateStatus` now has an explicit guard at `task-handlers.ts:359-362`:

```typescript
if (!patch.status) {
  sendJson(res, 400, { error: 'status field is required' })
  return
}
```

The `RUNNER_WRITABLE_STATUSES` check follows on line 364. A request with only `{notes: "foo"}` is now properly rejected.

**Verdict:** Fully remediated.

### QA-REL-5: `blocked` missing from `RUNNER_WRITABLE_STATUSES` -- FIXED

`queue-api-contract.ts:45` now includes `'blocked'` with the comment `// QA-11: Allow runners to set blocked status for dependency management`.

**Verdict:** Fully remediated.

### QA-REL-6: Non-atomic batch operations -- FIXED

`handleBatchTasks` at `task-handlers.ts:709-715` now wraps all operations in `db.transaction()`:

```typescript
if (db && typeof db.transaction === 'function') {
  const executeBatch = db.transaction(executeBatchOperations)
  executeBatch()
} else {
  executeBatchOperations()
}
```

The fallback path (no `db.transaction`) is for test mocks. In production, all operations succeed or fail atomically. The outer try/catch at line 716 catches transaction-level failures and returns 500.

**Verdict:** Fully remediated.

### QA-REL-7: SSE handler no `req.on('close')`/`req.on('aborted')` -- NOT FIXED

`handleEvents` in `event-handlers.ts:36-41` still ignores `_req`. The broadcaster's `addClient` only listens on `res.on('close')`. No `req.on('close')` or `req.on('aborted')` listeners are registered.

**Verdict:** Not fixed. Low severity -- the 30s heartbeat is an adequate backstop for localhost use.

### QA-REL-8: SSE broadcast without event validation -- FIXED

The broadcast loop in `event-handlers.ts:73-78` now extracts the actual event type from each event object:

```typescript
const eventObj = event as Record<string, unknown>
const eventType = typeof eventObj['type'] === 'string' ? eventObj['type'] : 'task:output'
```

This provides a meaningful event type to SSE clients. The filter at lines 85-90 also validates event shape (`typeof e === 'object' && e !== null`) before persistence.

**Verdict:** Fully remediated.

### QA-REL-9: Silent error swallowing in event persistence -- FIXED

The catch block in `event-handlers.ts:105-108` now logs the error:

```typescript
logger.error(
  `Failed to persist events for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`
)
```

Uses the module-level `createLogger('queue-api:events')` instance.

**Verdict:** Fully remediated.

### QA-REL-10: No API key caching -- FIXED

`helpers.ts:12-31` now has a module-level `cachedApiKey: string | null = null` with a `clearApiKeyCache()` export for testing. `getApiKey()` returns the cached value immediately if set (line 16), and caches after generation (line 24). This eliminates repeated `getSetting` reads and the key regeneration storm scenario.

**Verdict:** Fully remediated.

### QA-REL-11: Undefined `dependsOn` passes through -- FIXED

`handleUpdateDependencies` at `task-handlers.ts:551-553` now explicitly rejects `undefined`:

```typescript
if (dependsOn === undefined) {
  sendJson(res, 400, { error: 'dependsOn field is required (use null or array)' })
  return
}
```

**Verdict:** Fully remediated.

### QA-REL-12: No request timeout -- FIXED

`parseBody` now includes a `setTimeout` at `helpers.ts:103-112` with `BODY_PARSE_TIMEOUT_MS = 30_000` (line 94). The timeout sends 408, destroys the request, and rejects the promise. Uses the `settled` guard and `cleanup()` to prevent double-rejection.

Note: `server.requestTimeout` is not set at the server level, but the per-request timeout in `parseBody` covers all body-parsing routes. Routes that don't parse a body (GET handlers) are inherently safe since they don't wait on request data.

**Verdict:** Fully remediated.

### QA-REL-13: Order-dependent route matching -- FIXED

The router at `router.ts:62-66` now has a comment block documenting the ordering constraint. More importantly, the routes are now ordered most-specific-first: all `/tasks/:id/*` sub-routes (status, dependencies, claim, release, output, events) are matched before the generic `/tasks/:id` catch-all at line 112.

**Verdict:** Fully remediated.

### QA-REL-14: `handleHealth` not wrapped in try/catch -- FIXED

`handleHealth` at `task-handlers.ts:100-124` now wraps `getQueueStats()` in a try/catch and returns a structured error:

```typescript
sendJson(res, 500, {
  error: 'Failed to get queue stats',
  details: err instanceof Error ? err.message : String(err)
})
```

This returns 500 (not 503 as recommended) but includes diagnostic details. The status code could be improved to 503 to signal "service unavailable" to monitoring tools, but this is a minor distinction.

**Verdict:** Fully remediated.

### QA-REL-15: No DELETE endpoint for individual tasks -- FIXED

`handleDeleteTask` added at `task-handlers.ts:605-614`. Router dispatches `DELETE /queue/tasks/:id` at `router.ts:117`. The handler wraps `deleteTask(id)` in try/catch and returns `{ ok: true, id }` on success.

**Verdict:** Fully remediated.

### QA-REL-16: `console` logger in `handleCreateTask` -- FIXED

Module-level `const logger = createLogger('queue-api:tasks')` at `task-handlers.ts:39`. The `validateTaskCreation` call at line 194-196 passes a logger wrapper that delegates to `logger.warn()`:

```typescript
{
  logger: {
    warn: (...args: unknown[]) => logger.warn(String(args[0]))
  }
}
```

All task creation validation logs now go through the structured logging system.

**Verdict:** Fully remediated.

### QA-REL-17: SSE broadcaster tests incomplete -- FIXED

`sse-broadcaster.test.ts` now has 7 tests (up from 3):

1. Broadcast events to connected clients
2. Remove disconnected clients on error
3. Send `:connected` on addClient
4. Close all clients and clear interval on `close()`
5. Reject connections when max client limit (100) reached
6. Send heartbeat to all clients (using `vi.useFakeTimers()`)
7. Remove clients that fail during heartbeat

**Verdict:** Fully remediated.

---

## Previously Reported Cross-Audit Findings (Status Check)

| ID                  | Finding                                                                | Status                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ARCH-2              | Repository pattern bypass -- Queue API imports sprint-queries directly | **Still open.** `task-handlers.ts` lines 8-18 import directly from `sprint-queries`.                                                                               |
| main-process-ax 3.2 | Queue API writes don't emit IPC events to renderer                     | **Still open.** No `sprint:externalChange` emission in any handler. Renderer relies on file watcher.                                                               |
| main-process-ax 4.8 | Stale "Supabase proxy" JSDoc in server.ts                              | **Fixed.** `server.ts:1-4` now reads: "Queue API HTTP server on port 18790. Allows external runners to consume the sprint task queue via a simple REST interface." |
| main-process-sd C4  | SSE token via query-string                                             | **Still open (accepted risk).** `helpers.ts:43-45` has a comment documenting this as acceptable for localhost-only.                                                |

---

## New Issues Found

### QA-REL-NEW-1: `stopQueueApi()` does not close SSE broadcaster

- **Severity:** Low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/server.ts:57-72`
- **Description:** `stopQueueApi()` calls `server.closeAllConnections()` and `server.close()` but never calls `sseBroadcaster.close()`. The heartbeat interval (30s `setInterval`) continues running after server shutdown. The broadcaster singleton lives in `event-handlers.ts` and is not imported by `server.ts`. This was identified in QA-REL-3 as part of the original finding -- the `close()` method was added but the call site in `stopQueueApi()` was not wired up.
- **Recommendation:** Import `sseBroadcaster` from `./event-handlers` in `server.ts` and call `sseBroadcaster.close()` before `server.close()`. Or export a `stopEventHandlers()` function from `event-handlers.ts` and call it from `stopQueueApi()`.

### QA-REL-NEW-2: `handleHealth` returns 500 instead of 503 on database failure

- **Severity:** Low (informational)
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:119`
- **Description:** When `getQueueStats()` throws, the health endpoint returns HTTP 500. Monitoring tools and load balancers distinguish between 500 (internal error, may be transient) and 503 (service unavailable, don't send traffic). A health endpoint that returns 503 on database failure is more semantically correct and allows automated tooling to route traffic or suppress alerts appropriately.
- **Recommendation:** Change `sendJson(res, 500, ...)` to `sendJson(res, 503, { status: 'unhealthy', ... })`.

### QA-REL-NEW-3: Handler catch blocks for `parseBody` rejection still attempt double-send

- **Severity:** Low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts` (7 locations)
- **Description:** This is the remaining half of QA-REL-2. While `parseBody` now guards its own response-sending with `res.writableEnded`, the 7 handler catch blocks unconditionally call `sendJson(res, 400, ...)`. When `parseBody` has already sent 413 or 408 and then rejected, the catch block's `sendJson` throws "Cannot set headers after they are sent", which propagates to the global error handler in `server.ts`. This produces noisy log entries but does not crash the process or affect clients.
- **Recommendation:** Add `if (res.writableEnded) return` at the top of each catch block, matching the pattern in `handleTaskOutput` at `event-handlers.ts:53`.

---

## Overall Assessment

**14 of 17 original findings fully fixed. 2 partially fixed. 1 not fixed (low severity, accepted).**

The remediation work was thorough. The highest-priority items (batch atomicity, body parsing double-rejection, API key caching, request timeouts) are all resolved. The remaining gaps are low-severity: the SSE broadcaster shutdown wiring (QA-REL-3/NEW-1), the handler catch block double-send pattern (QA-REL-2/NEW-3), and the SSE disconnect detection (QA-REL-7).

The codebase also shows evidence of additional hardening beyond the original findings:

- **SSE client limit** (MAX_SSE_CLIENTS=100) prevents resource exhaustion from excessive connections
- **Timing-safe API key comparison** prevents timing attacks on auth
- **skipValidation audit logging** provides visibility into validation bypasses
- **Disallowed field rejection** (QA-14) now returns 400 instead of silently dropping fields
- **Status parameter validation** on list endpoint prevents invalid queries
- **Individual DELETE endpoint** added alongside batch delete

The Queue API is in good shape for production use on localhost. The remaining items are cleanup-level improvements, not blockers.

| Metric                       | Value                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Findings fully fixed         | 14 / 17 (82%)                                                                                         |
| Findings partially fixed     | 2 / 17 (12%)                                                                                          |
| Findings not fixed           | 1 / 17 (6%)                                                                                           |
| New issues found             | 3 (all low severity)                                                                                  |
| Cross-audit items still open | 2 of 4                                                                                                |
| Recommended next actions     | Wire `sseBroadcaster.close()` into `stopQueueApi()`; add `res.writableEnded` guards to 7 catch blocks |
