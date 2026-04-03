# Queue API -- Reliability Engineer Audit

**Date:** 2026-03-29
**Scope:** 15 files in Queue API (9 source, 6 test)
**Persona:** Reliability Engineer

---

## Cross-Reference with March 28 Audit

### Previously Reported -- Now Fixed

| #                  | Original Finding                         | Evidence of Fix                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-5              | CORS `*` on auth-protected localhost API | `helpers.ts:57` now exports `CORS_HEADERS = {}` -- wildcard removed. Comment on line 55-56 confirms intentional removal.                                                                                                               |
| main-process-sd C3 | Same CORS wildcard issue                 | Same fix as SEC-5.                                                                                                                                                                                                                     |
| main-process-sd S1 | Worktree lock TOCTOU race                | `claimTask()` in `sprint-queries.ts:248-264` now wraps WIP count check + UPDATE in a single SQLite transaction, eliminating the TOCTOU race. `task-handlers.ts:420` passes `MAX_ACTIVE_TASKS` to `claimTask()` for atomic enforcement. |

### Previously Reported -- Still Open

| #                   | Original Finding                                                                        | Current Status                                                                                                                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCH-2              | Repository pattern inconsistently applied -- Queue API bypasses `ISprintTaskRepository` | Still present. `task-handlers.ts` imports directly from `sprint-queries` (line 6-17). Queue API writes bypass notification channels and any repository-layer side effects.                                                                                                                    |
| main-process-ax 3.2 | Queue API notifications gap -- writes don't emit IPC events to renderer                 | Still present. `handleUpdateTask()`, `handleUpdateStatus()`, `handleUpdateDependencies()` all call `updateTask()` directly but never emit `sprint:externalChange` or any IPC notification. The renderer relies on DB file watcher (500ms debounce) which is an indirect, unreliable coupling. |
| main-process-ax 4.8 | Stale "Supabase proxy" JSDoc in server.ts                                               | Still present. `server.ts:2` reads: `Queue API HTTP server -- lightweight Supabase proxy on port 18790`. This is misleading -- the API operates on local SQLite, not Supabase.                                                                                                                |
| main-process-sd C4  | SSE token via query-string                                                              | Still present. `helpers.ts:30-35` accepts `?token=` query param for SSE clients. Token is visible in server logs, browser history, and proxy logs. Documented as accepted risk but not mitigated.                                                                                             |

---

## Findings

### QA-REL-1: `parseBody` continues to accumulate chunks after rejecting for size

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/helpers.ts:70-80`
- **Description:** When `totalSize > MAX_BODY_SIZE`, the handler calls `req.destroy()` and rejects the promise, but the `data` event listener is never removed. If `req.destroy()` does not synchronously prevent further `data` events (which is not guaranteed by the Node.js stream contract), the listener continues pushing chunks to the array and incrementing `totalSize`. More critically, the `end` event handler still runs after `destroy()` in some cases, calling `Buffer.concat(chunks)` on a partial buffer and attempting `JSON.parse()`, which produces a second rejection on an already-rejected promise -- an unhandled promise rejection.
- **Evidence:**
  ```typescript
  req.on('data', (chunk: Buffer) => {
    totalSize += chunk.length
    if (totalSize > MAX_BODY_SIZE) {
      req.destroy()
      if (res) {
        sendJson(res, 413, { error: 'Payload too large' })
      }
      reject(new Error('Payload too large'))
      return // but 'end' event may still fire
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    // may fire after destroy() + reject()
    // ... JSON.parse → second reject() call
  })
  ```
- **Recommendation:** Add a `let resolved = false` guard. Set it to `true` on first resolve/reject. Check it at the top of both `data` (after size check) and `end` handlers. Remove all listeners after first resolution: `req.removeAllListeners('data'); req.removeAllListeners('end')`.

### QA-REL-2: `handleCreateTask` catches `parseBody` rejection but may double-send response

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:136-142`
- **Description:** When `parseBody` rejects due to payload too large, `parseBody` itself already sends a 413 response via `sendJson(res, 413, ...)` (helpers.ts:75). The `catch` block in `handleCreateTask` then sends a second 400 response. Since `sendJson` calls `res.writeHead()` + `res.end()`, the second call either throws (headers already sent) or is silently ignored. This is not a crash (the outer try/catch in `server.ts:29-37` catches it), but it logs a spurious "Unhandled error" and confuses debugging.
- **Evidence:**
  ```typescript
  // task-handlers.ts:136-142
  try {
    body = await parseBody(req, res) // may send 413 internally
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' }) // second response attempt
    return
  }
  ```
  Same pattern appears in `handleUpdateTask` (line 247-251), `handleUpdateStatus` (line 296-301), `handleClaim` (line 399-405), `handleRelease` (line 441-448), `handleUpdateDependencies` (line 475-481), and `handleBatchTasks` (line 543-548).
- **Recommendation:** In each catch block, check `res.writableEnded` before sending, as `handleTaskOutput` already does correctly at line 50-52. Alternatively, have `parseBody` never send the response itself -- let callers handle it.

### QA-REL-3: SSE broadcaster heartbeat interval leaks on module reload

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/sse-broadcaster.ts:15-23`, `src/main/queue-api/event-handlers.ts:14`
- **Description:** `event-handlers.ts:14` creates a singleton SSE broadcaster at module scope: `export const sseBroadcaster = createSseBroadcaster()`. The broadcaster starts a 30-second `setInterval` heartbeat (line 15). If the module is ever re-evaluated (HMR, test re-imports), a new interval is created without clearing the old one. Additionally, `stopQueueApi()` in `server.ts` calls `server.closeAllConnections()` but never calls `sseBroadcaster.close()`, so the heartbeat timer keeps running after server shutdown and prevents clean process exit.
- **Evidence:**

  ```typescript
  // event-handlers.ts:14 — module-level singleton
  export const sseBroadcaster = createSseBroadcaster()

  // server.ts:56-71 — stopQueueApi never closes broadcaster
  export function stopQueueApi(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!server) { resolve(); return }
      server.closeAllConnections()
      server.close((err) => { ... })
    })
  }
  ```

- **Recommendation:** Call `sseBroadcaster.close()` inside `stopQueueApi()` before `server.close()`. Export `sseBroadcaster` from `server.ts` or pass it as a dependency so the lifecycle is managed.

### QA-REL-4: `handleUpdateStatus` does not validate that `status` field is present

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:308-312`
- **Description:** The status validation at line 309 checks `if (patch.status && !RUNNER_WRITABLE_STATUSES.has(patch.status))` -- but if `patch.status` is `undefined` (caller sends a body with only `notes`), the check passes, and the code proceeds to filter fields and call `updateTask()`. The `STATUS_UPDATE_FIELDS` set includes `notes`, so a PATCH to `/status` endpoint with just `{notes: "foo"}` succeeds as a general field update -- bypassing the `GENERAL_PATCH_FIELDS` restriction and the dedicated `/status` endpoint's semantic purpose. This also means the terminal-status resolution check at line 388-391 never fires, silently skipping dependency resolution if a caller forgets to include `status`.
- **Evidence:**
  ```typescript
  const patch = body as StatusUpdateRequest
  if (patch.status && !RUNNER_WRITABLE_STATUSES.has(patch.status)) {
    // skipped if status is undefined
    sendJson(res, 400, { error: `Invalid status: ${patch.status}` })
    return
  }
  ```
- **Recommendation:** Add an explicit check: `if (!patch.status || typeof patch.status !== 'string') { sendJson(res, 400, { error: 'status field is required' }); return }`.

### QA-REL-5: `blocked` status missing from `RUNNER_WRITABLE_STATUSES`

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/shared/queue-api-contract.ts:43-50`
- **Description:** `RUNNER_WRITABLE_STATUSES` contains `queued`, `active`, `done`, `failed`, `cancelled`, `error` -- but not `blocked`. External consumers (task runners) cannot set a task to `blocked` via the `/status` endpoint. This is likely intentional (auto-blocking is handled internally), but creates an asymmetry: tasks can arrive at `blocked` status internally but external callers cannot re-block a task after unblocking it. More importantly, a task that should be blocked but was accidentally unblocked cannot be corrected via the API.
- **Evidence:**
  ```typescript
  export const RUNNER_WRITABLE_STATUSES = new Set([
    'queued',
    'active',
    'done',
    'failed',
    'cancelled',
    'error'
    // 'blocked' is absent
  ])
  ```
- **Recommendation:** If `blocked` is intentionally excluded, document this in a comment. If external callers should be able to block tasks, add `blocked` to the set. Either way, the current state should be explicit.

### QA-REL-6: Batch operations are not atomic -- partial failures leave inconsistent state

- **Severity:** high
- **Effort:** M (1-4hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:538-624`
- **Description:** `handleBatchTasks` iterates operations sequentially and catches per-operation errors, but operations are not wrapped in a SQLite transaction. If operation 3 of 5 fails, operations 1-2 are already committed. Callers have no way to roll back. The response returns per-operation results, so callers can detect partial failure, but there is no built-in retry or compensation mechanism. For batch deletes mixed with updates, a failed update leaves the batch in an inconsistent state that the caller cannot easily recover from.
- **Evidence:**
  ```typescript
  for (const rawOp of operations) {
    try {
      if (opType === 'update') {
        const updated = updateTask(id, toSnakeCase(filtered))
        results.push({ id, op: 'update', ok: !!updated, ... })
      } else if (opType === 'delete') {
        deleteTask(id)
        results.push({ id, op: 'delete', ok: true })
      }
    } catch (err) {
      results.push({ id, op: opType, ok: false, error: String(err) })
    }
  }
  ```
- **Recommendation:** Wrap the entire batch loop in `db.transaction(() => { ... })()`. If any operation fails, the transaction rolls back. Change the HTTP response to 500 with the failure details. Alternatively, if partial success is desired (current behavior), document this clearly in the API contract and add a `transactional` boolean option to the request body.

### QA-REL-7: `handleEvents` SSE handler ignores the request object -- no client disconnect detection beyond `res.on('close')`

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/event-handlers.ts:33-38`
- **Description:** `handleEvents` passes `_req` (unused) and `res` to `sseBroadcaster.addClient(res)`. The broadcaster listens for `res.on('close')` to remove clients. However, if the TCP connection drops without a clean close (e.g., client process killed, network partition), Node.js may not emit `close` until the next write attempt. The heartbeat at 30-second intervals will eventually trigger write errors and clean up, but during that window, every `broadcast()` call attempts writes to dead connections. With many dead SSE clients, this adds up to wasted syscalls and error handling overhead.
- **Evidence:**
  ```typescript
  // sse-broadcaster.ts:34 — only cleanup mechanism besides heartbeat errors
  res.on('close', () => clients.delete(res))
  ```
- **Recommendation:** Also listen for `req.on('close')` and `req.on('aborted')` in `addClient()`. This provides earlier notification of disconnected clients. The 30s heartbeat is a reasonable backstop.

### QA-REL-8: `handleTaskOutput` broadcasts all events including non-curated types without validation

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/event-handlers.ts:68-70`
- **Description:** The broadcast loop at line 68-70 spreads each event object directly into the SSE payload without any type or shape validation. A malformed event (e.g., `null`, a string, a deeply nested object) will be serialized via `JSON.stringify` and sent to all SSE clients. While this won't crash the server, it may crash or confuse SSE consumers that expect a specific event shape. The curated event persistence at lines 76-97 is properly filtered, but the broadcast is not.
- **Evidence:**
  ```typescript
  for (const event of events) {
    sseBroadcaster.broadcast('task:output', { taskId, ...(event as Record<string, unknown>) })
  }
  ```
  If `event` is `null` or a primitive, the spread operator produces unexpected results or throws.
- **Recommendation:** Add a guard: `if (!event || typeof event !== 'object') continue;` before broadcasting. Optionally validate the `type` field exists.

### QA-REL-9: Event persistence silently swallows all errors with empty catch

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/event-handlers.ts:96-98`
- **Description:** The `try/catch` around event persistence (lines 72-98) has an empty catch block. If `insertEventBatch` fails, the error is silently discarded. This is documented as "best-effort" behavior, and there is a test confirming it (queue-api.test.ts:1063-1069). However, without even logging the error, operators have no visibility into persistent event storage failures. If the SQLite database is corrupted or the `agent_events` table is missing, every event write silently fails, and the task event history endpoint returns empty results -- with no indication of the cause.
- **Evidence:**
  ```typescript
  } catch {
    // Best-effort -- do not fail the request
  }
  ```
- **Recommendation:** Add `catch (err) { logger.warn('Event persistence failed:', err) }` using the module-level logger pattern used elsewhere in the codebase.

### QA-REL-10: `getApiKey()` generates a new key on every call if `getSetting` returns null and `setSetting` is not persisted

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/helpers.ts:12-18`
- **Description:** `getApiKey()` has no caching. It calls `getSetting('taskRunner.apiKey')` on every request. If `getSetting` returns null (e.g., SQLite not initialized yet, or setting deleted), and `setSetting` fails silently, then `randomBytes(32).toString('hex')` generates a new key on every request. This means: (1) every request gets a different expected key, so all authenticated requests fail with 403; (2) `setSetting` is called on every request, hammering the SQLite settings table with writes. The CLAUDE.md gotcha notes that the key is "auto-generated on first access" but doesn't mention the no-cache behavior.
- **Evidence:**
  ```typescript
  function getApiKey(): string {
    const existing = getSetting('taskRunner.apiKey') ?? process.env['SPRINT_API_KEY']
    if (existing) return existing
    const generated = randomBytes(32).toString('hex')
    setSetting('taskRunner.apiKey', generated)
    return generated
  }
  ```
- **Recommendation:** Cache the generated key in a module-level variable: `let cachedKey: string | null = null`. Return it immediately if set. Clear the cache on explicit reset only.

### QA-REL-11: `handleUpdateDependencies` allows undefined `dependsOn` to pass through as an update

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:488-521`
- **Description:** If the request body is `{}` (no `dependsOn` field), `dependsOn` is `undefined`. The validation block at lines 491-519 is skipped entirely (condition `dependsOn !== null && dependsOn !== undefined`). Control falls through to line 521: `toSnakeCase({ dependsOn: undefined })`, which maps to `{ depends_on: undefined }`. When `updateTask` receives this, the behavior depends on whether SQLite treats `undefined` as NULL or skips the column -- potentially overwriting existing dependencies with NULL.
- **Evidence:**
  ```typescript
  const { dependsOn } = body as { dependsOn?: unknown }
  // If dependsOn is undefined, validation is skipped
  if (dependsOn !== null && dependsOn !== undefined) { ... }
  // Falls through to:
  const snaked = toSnakeCase({ dependsOn })  // { depends_on: undefined }
  updated = updateTask(id, snaked)
  ```
- **Recommendation:** Add a guard: if `dependsOn === undefined`, return 400 with "dependsOn field is required". This endpoint's purpose is to set dependencies -- omitting the field entirely is likely a caller error.

### QA-REL-12: No request timeout on body parsing -- slow clients can hold connections indefinitely

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/queue-api/helpers.ts:66-96`, `src/main/queue-api/server.ts:28-37`
- **Description:** `parseBody` waits indefinitely for the request stream to end. A slow or malicious client that sends data one byte at a time (slowloris-style) can hold the connection open indefinitely. The server has no `server.timeout` or `server.requestTimeout` configured, and no per-request timeout wrapping `parseBody`. While this is a localhost API, external services (Life OS, claude-chat-service, claude-task-runner) connect to it, and a hung connection from any of these consumes a file descriptor and an event loop slot.
- **Evidence:**

  ```typescript
  // server.ts — no timeout configuration
  server = http.createServer(async (req, res) => { ... })
  server.listen(port, host, () => { ... })
  // No server.timeout = ... or server.requestTimeout = ...

  // helpers.ts — parseBody has no timeout
  return new Promise((resolve, reject) => {
    req.on('data', ...)
    req.on('end', ...)
    req.on('error', reject)
    // no setTimeout
  })
  ```

- **Recommendation:** Set `server.requestTimeout = 30000` (30 seconds) after creating the server in `server.ts`. This automatically closes connections that take too long to send a complete request.

### QA-REL-13: Route matching is order-dependent and `/queue/tasks/:id` matches before `/queue/tasks/:id/status`

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/router.ts:77-88`
- **Description:** In the router, `/queue/tasks/:id` is matched at line 77 before `/queue/tasks/:id/status` at line 85. This works correctly because `matchRoute` requires exact segment count matching (line 113: `patternParts.length !== pathParts.length`). However, if someone adds a trailing-slash variant (`/queue/tasks/:id/`) or a sub-route without updating the order, routes will silently shadow each other. The code relies on implicit ordering for correctness with no documentation or assertion.
- **Evidence:**

  ```typescript
  // Line 77 — matches /queue/tasks/abc (3 segments after split)
  params = matchRoute('/queue/tasks/:id', path)
  if (params) { ... }

  // Line 85 — matches /queue/tasks/abc/status (4 segments after split)
  params = matchRoute('/queue/tasks/:id/status', path)
  ```

- **Recommendation:** Add a comment block at the top of the route section documenting the ordering constraint. Consider refactoring to match longer routes first (most-specific-first ordering).

### QA-REL-14: `handleHealth` is not wrapped in try/catch -- `getQueueStats()` exceptions propagate to global handler

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:96-112`
- **Description:** `handleHealth` calls `getQueueStats()` directly without a try/catch. If SQLite is unavailable, the exception propagates to the global error handler in `server.ts:31-36`, which returns a generic 500. While this works, it means the health endpoint -- the primary mechanism for monitoring the API -- fails with an opaque error instead of returning a structured degraded/unhealthy response. Integration test at `queue-api-integration.test.ts:144-151` confirms this returns 500, but the error provides no diagnostic information.
- **Evidence:**
  ```typescript
  export async function handleHealth(res: http.ServerResponse): Promise<void> {
    const stats = getQueueStats()  // throws if DB is unavailable
    sendJson(res, 200, { status: 'ok', ... })
  }
  ```
- **Recommendation:** Wrap in try/catch and return `sendJson(res, 503, { status: 'unhealthy', error: err.message })` on failure. This lets monitoring tools distinguish between "API is up, DB is down" and "API is down".

### QA-REL-15: Test gap -- no test for `DELETE` method on `/queue/tasks/:id`

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/router.ts:77-82`
- **Description:** The router matches `/queue/tasks/:id` for both GET and PATCH (lines 80-81), but there is no DELETE handler. The batch endpoint supports `op: 'delete'`, but single-task deletion is not exposed. However, there is also no test verifying that `DELETE /queue/tasks/:id` returns 404. If someone adds a DELETE handler in the router without proper validation, it could bypass the batch-only delete restriction. The tests in `queue-api.test.ts` do not cover the DELETE method at all for individual task routes.
- **Evidence:** No `DELETE` case in the router's `/queue/tasks/:id` block, and no test asserting `DELETE /queue/tasks/:id` returns 404.
- **Recommendation:** Add a test confirming `DELETE /queue/tasks/:id` returns 404, documenting the intentional design that deletions go through the batch endpoint only.

### QA-REL-16: `handleCreateTask` uses `console` as logger instead of `createLogger`

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:163-165`
- **Description:** `validateTaskCreation` is called with `{ logger: console }` (line 164). The rest of the Queue API uses the structured `createLogger('queue-api')` logger. Using `console` bypasses the file-based logging system (`~/.bde/bde.log`), rotation, and the `[LEVEL] [module]` format. Validation errors during task creation are only visible in stdout, not in the persistent log.
- **Evidence:**
  ```typescript
  const validation = validateTaskCreation(
    body as Parameters<typeof createTask>[0],
    { logger: console } // should use createLogger
  )
  ```
- **Recommendation:** Import `createLogger` from `../logger` and use `{ logger: createLogger('queue-api') }` or a module-level logger instance.

### QA-REL-17: SSE broadcaster test does not test heartbeat cleanup or `close()` method

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/__tests__/sse-broadcaster.test.ts`
- **Description:** The SSE broadcaster test file has only 3 tests covering `addClient`, `broadcast`, and error removal. It does not test: (1) `close()` -- that it clears the interval and closes all clients; (2) heartbeat behavior -- that `:heartbeat\n\n` is sent every 30s; (3) `removeClient()` -- explicit client removal; (4) `clientCount()` after add/remove cycles. The `close()` method is the primary resource cleanup mechanism and is untested.
- **Evidence:** Only 3 tests in the file, none covering `close()`, heartbeat, or `removeClient()`.
- **Recommendation:** Add tests for `close()` (verifies `clearInterval` was called and clients are ended), `removeClient()`, and `clientCount()` after various operations. Use `vi.useFakeTimers()` to test heartbeat emission.

---

## Summary

| Severity | Count      |
| -------- | ---------- |
| Critical | None found |
| High     | 1          |
| Medium   | 7          |
| Low      | 9          |

**Total findings:** 17

### Priority Remediation Order

1. **QA-REL-6** (high) -- Batch operations not atomic. Risk of partial state corruption in multi-operation batches.
2. **QA-REL-1** (medium) -- `parseBody` double-rejection on oversized payloads. Can cause unhandled promise rejection warnings.
3. **QA-REL-2** (medium) -- Double-send response on `parseBody` rejection in 7 handler functions.
4. **QA-REL-4** (medium) -- Missing `status` field validation in `/status` endpoint allows field-level updates without status transition.
5. **QA-REL-10** (medium) -- No API key caching -- potential key regeneration storm if settings not persisted.
6. **QA-REL-9** (medium) -- Silent error swallowing in event persistence.
7. **QA-REL-12** (medium) -- No request timeout. Slow clients can exhaust connections.
8. **QA-REL-3** (low) -- SSE heartbeat interval leak on shutdown.
9. Remaining low-severity items in any order.

### Positive Observations

- **Claim atomicity is solid.** The `claimTask()` function uses a single SQLite transaction for WIP check + UPDATE, properly eliminating the TOCTOU race that was reported in the March 28 audit.
- **CORS wildcard was removed.** The SEC-5 finding from March 28 has been addressed.
- **Dependency validation is thorough.** Cycle detection, ID existence checks, and structural validation all run BEFORE task creation -- no create-then-rollback patterns.
- **Body size limits are enforced.** The 5MB `MAX_BODY_SIZE` prevents memory exhaustion from large payloads.
- **Field allowlisting is consistent.** Both `GENERAL_PATCH_FIELDS` and `STATUS_UPDATE_FIELDS` use Set-based allowlisting to prevent field injection.
- **Test coverage is reasonable.** The main `queue-api.test.ts` covers claim, release, status transitions, dependency validation, batch operations, auth, and error paths. Integration tests cover real HTTP with auth scenarios.
