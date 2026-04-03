# Queue API -- Red Team Audit

**Date:** 2026-03-29
**Scope:** 15 files in Queue API (`src/main/queue-api/` + shared contract + integration tests)
**Persona:** Red Team (penetration-test-style code review)

---

## Cross-Reference with March 28 Audit

### Previously Reported -- Now Fixed

| March 28 ID | Issue                                                                                                                                       | Status                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-5       | **CORS `*` on auth-protected localhost API** -- `helpers.ts` had `Access-Control-Allow-Origin: *` allowing any browser tab to probe the API | **Fixed.** `CORS_HEADERS` is now an empty object `{}` (line 57 of `helpers.ts`). Comment at line 55-56 documents the rationale. CORS headers are no longer emitted on any response. |

### Previously Reported -- Still Open

| March 28 ID        | Issue                                                                                                                                    | Status                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main-process-sd C4 | **SSE token exposure via query params** -- `?token=` query parameter for SSE auth is logged in access logs and visible in network traces | **Still open.** `checkAuth()` at `helpers.ts:29-35` still accepts `?token=` query param. See QA-RED-1 below for full analysis.                                                            |
| main-process-sd S7 | **SQL column allowlist entries not regex-asserted** -- column names interpolated into SQL via string concatenation                       | **Still open.** `sprint-queries.ts:200` still uses `${key} = ?` interpolation. The allowlist protects it in practice, but the pattern remains fragile. See QA-RED-4 below.                |
| ARCH-2             | **Repository pattern inconsistently applied** -- Queue API bypasses `ISprintTaskRepository`, creating different side-effect paths        | **Still open.** `task-handlers.ts` imports `sprint-queries` directly. Not a direct security issue but means security controls (audit trail, notifications) can be inconsistently applied. |

### New Findings

See Findings section below.

---

## Findings

### QA-RED-1: SSE Token Exposed in Query String

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/queue-api/helpers.ts:29-35`, `src/main/queue-api/router.ts:52-54`
- **Description:** The `checkAuth()` function accepts API keys via the `?token=` query parameter as a fallback for SSE clients (which cannot set custom headers in the browser `EventSource` API). Tokens passed in query strings are:
  1. Logged in server access logs and any HTTP proxy logs
  2. Stored in browser history if accessed from a web context
  3. Visible in `netstat`/`lsof` output on some systems
  4. Potentially leaked via `Referer` headers on subsequent requests

  Since the API key is a long-lived secret (auto-generated `randomBytes(32)`, never rotated), exposure through any of these channels grants persistent access.

- **Evidence:**
  ```typescript
  // helpers.ts:29-35
  } else {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const queryToken = url.searchParams.get('token')
    if (queryToken) {
      token = queryToken
    }
  }
  ```
  The SSE integration test at `queue-api-sse.test.ts:93` confirms this is the intended auth path for SSE:
  ```typescript
  const req = http.get({ ..., headers: { Authorization: `Bearer ${SSE_TEST_KEY}` } }, ...)
  ```
  (The test uses headers, but the production SSE path via browser `EventSource` would use `?token=`.)
- **Recommendation:** Implement a short-lived session token endpoint: `POST /queue/auth/session` (authenticated with the API key via header) returns a time-limited token (e.g., 5-minute TTL) that can be used in the `?token=` query param for SSE connections only. This limits the blast radius of query-string token exposure.

---

### QA-RED-2: No Rate Limiting on Authentication Attempts

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/queue-api/helpers.ts:20-48`, `src/main/queue-api/server.ts:28-37`
- **Description:** The `checkAuth()` function performs a constant-time-unsafe string comparison (`token !== apiKey` at line 43) and has no rate limiting. An attacker on the local network (or via a compromised browser tab, since CORS is now removed but `fetch()` can still be used for simple requests) can brute-force the API key. The API key is 64 hex characters (256 bits), making brute force computationally infeasible in practice, but the lack of rate limiting also enables credential stuffing if the key is partially leaked.

  More importantly, the string comparison `token !== apiKey` at line 43 uses JavaScript's `!==` operator, which is not constant-time. This creates a theoretical timing side-channel, though exploitation over localhost HTTP is extremely difficult.

- **Evidence:**
  ```typescript
  // helpers.ts:43
  if (token !== apiKey) {
    sendJson(res, 403, { error: 'Invalid API key' })
    return false
  }
  ```
- **Recommendation:** Use `crypto.timingSafeEqual()` for the token comparison. Add a simple in-memory rate limiter (e.g., max 10 failed attempts per minute per source IP, with exponential backoff). Example:
  ```typescript
  import { timingSafeEqual } from 'node:crypto'
  const a = Buffer.from(token)
  const b = Buffer.from(apiKey)
  if (a.length !== b.length || !timingSafeEqual(a, b)) { ... }
  ```

---

### QA-RED-3: Batch Delete Has No Authorization Granularity

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:538-624`
- **Description:** The batch endpoint (`POST /queue/tasks/batch`) allows `delete` operations on any task by ID with no additional checks. Any authenticated client can delete any task, including tasks owned by (claimed by) other executors. The same applies to batch `update` operations -- there is no ownership check.

  Combined with the single shared API key (all clients share the same key), this means any task runner can delete or modify tasks belonging to other runners. There is no per-client authorization or ownership enforcement.

- **Evidence:**
  ```typescript
  // task-handlers.ts:606-608
  } else if (opType === 'delete') {
    deleteTask(id)
    results.push({ id, op: 'delete', ok: true })
  }
  ```
  No check on `claimed_by` or task ownership before delete. The `deleteTask()` function at `sprint-queries.ts:235-241` is a bare `DELETE FROM sprint_tasks WHERE id = ?`.
- **Recommendation:** For delete operations, verify the task is not in `active` status (or require the caller to match `claimed_by`). Add an optional `executorId` to batch operations and enforce ownership on active tasks.

---

### QA-RED-4: SQL Column Name Interpolation Pattern

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/data/sprint-queries.ts:200`
- **Description:** The `updateTask()` function builds SQL SET clauses by interpolating key names directly into the query string: `setClauses.push(`${key} = ?`)`. While the `UPDATE_ALLOWLIST` at lines 45-69 contains only safe, hardcoded column names, the defense relies entirely on the caller filtering keys through this allowlist. If any future code path passes unfiltered user input to `updateTask()`, it becomes a SQL injection vector.

  The Queue API's `handleUpdateTask` and `handleUpdateStatus` do filter through `GENERAL_PATCH_FIELDS` and `STATUS_UPDATE_FIELDS` respectively, then through `toSnakeCase()` which maps from a fixed dictionary. However, `toSnakeCase()` has a fallback: `const snakeKey = CAMEL_TO_SNAKE[key] ?? key` (field-mapper.ts:56) -- if a key is not in the mapping, it passes through unchanged. This means a key like `title` (which IS in `GENERAL_PATCH_FIELDS` but NOT in `CAMEL_TO_SNAKE`) would pass through to `updateTask` as-is, which is safe. But if `GENERAL_PATCH_FIELDS` ever included a key with SQL metacharacters, the allowlist in `sprint-queries.ts` would catch it -- unless that allowlist was also updated carelessly.

  This is a defense-in-depth concern, not an active vulnerability.

- **Evidence:**
  ```typescript
  // sprint-queries.ts:200
  setClauses.push(`${key} = ?`)
  ```
  ```typescript
  // field-mapper.ts:56
  const snakeKey = CAMEL_TO_SNAKE[key] ?? key // pass-through fallback
  ```
- **Recommendation:** Add a regex assertion at the `updateTask()` entry point:
  ```typescript
  for (const [key] of entries) {
    if (!/^[a-z_]+$/.test(key)) throw new Error(`Invalid column name: ${key}`)
  }
  ```
  This adds a safety net independent of the allowlist.

---

### QA-RED-5: Unvalidated `status` Query Parameter in Task Listing

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:114-121`
- **Description:** The `handleListTasks` handler passes the `status` query parameter directly to `listTasks()` without validating it against the known set of task statuses. While `listTasks()` uses parameterized queries (safe from SQL injection), an attacker can pass arbitrary strings like `status='; DROP TABLE--` and the query will simply return zero results. This is not exploitable but indicates missing input validation at the trust boundary.
- **Evidence:**
  ```typescript
  // task-handlers.ts:118
  const status = query.get('status') ?? undefined
  const tasks = listTasks(status) // No validation against known statuses
  ```
- **Recommendation:** Validate `status` against the known set before querying:
  ```typescript
  const VALID_STATUSES = new Set([
    'backlog',
    'queued',
    'blocked',
    'active',
    'done',
    'failed',
    'cancelled',
    'error'
  ])
  if (status && !VALID_STATUSES.has(status)) {
    sendJson(res, 400, { error: `Invalid status: ${status}` })
    return
  }
  ```

---

### QA-RED-6: Agent Log Access Lacks Task-Level Authorization

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/queue-api/agent-handlers.ts:38-75`, `src/main/queue-api/router.ts:65-68`
- **Description:** The `GET /queue/agents/:id/log` endpoint provides access to any agent's log file by ID. There is no check that the requesting client owns or is associated with the agent/task. Any authenticated client can read the full log output of any agent, which may contain:
  1. File contents from the repository being worked on
  2. Environment variable values leaked in error messages
  3. API responses containing sensitive data
  4. Internal code structure and implementation details

  The `GET /queue/agents` endpoint similarly exposes all agent metadata (model, repo, cost data) without scoping to the caller's tasks.

- **Evidence:**
  ```typescript
  // agent-handlers.ts:38-75
  export async function handleAgentLog(
    res: http.ServerResponse,
    agentId: string,         // User-controlled, no ownership check
    query: URLSearchParams
  ): Promise<void> {
    const exists = await hasAgent(agentId)
    if (!exists) { ... }
    // Reads log file directly from disk -- no task ownership verification
    const result = await readLog(agentId, fromByte, maxBytes)
  ```
- **Recommendation:** Add an optional `executorId` query parameter and verify the agent's associated task is owned by (or was created by) the caller. At minimum, log access should require the caller to know the associated `taskId` and verify it matches.

---

### QA-RED-7: SSE Broadcast Leaks All Task Events to All Clients

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/queue-api/sse-broadcaster.ts:44-53`, `src/main/queue-api/event-handlers.ts:67-69`
- **Description:** The SSE broadcaster sends every event to every connected client. There is no per-client filtering by task ID or executor ownership. A client connected to `/queue/events` receives `task:output` events for ALL tasks, including those claimed by other executors. This exposes:
  1. Real-time agent activity (tool calls, errors, completions) for all tasks
  2. Task IDs and metadata for tasks the client did not create

  In a multi-tenant scenario (multiple task runners sharing the queue), this is an information disclosure vulnerability.

- **Evidence:**
  ```typescript
  // sse-broadcaster.ts:44-53
  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const c of clients) {  // ALL clients receive ALL events
      try {
        c.write(payload)
      } catch {
        clients.delete(c)
      }
    }
  }
  ```
  ```typescript
  // event-handlers.ts:67-69
  for (const event of events) {
    sseBroadcaster.broadcast('task:output', { taskId, ...(event as Record<string, unknown>) })
  }
  ```
- **Recommendation:** Support per-client task ID filtering. Allow SSE clients to subscribe to specific task IDs via query parameter: `/queue/events?taskIds=task-1,task-2`. The broadcaster should only forward events matching the client's subscription. This is a common pattern for multi-tenant SSE systems.

---

### QA-RED-8: OPTIONS Preflight Bypasses Authentication

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/router.ts:19-23`
- **Description:** The CORS preflight handler responds to `OPTIONS` requests without authentication. While this is standard behavior for CORS preflight (browsers require it), the current implementation responds with `204` and the (now-empty) `CORS_HEADERS` to ANY path, regardless of whether the path exists. This allows unauthenticated path enumeration -- an attacker can `OPTIONS /queue/tasks` to confirm the endpoint exists (gets 204) vs `OPTIONS /nonexistent` (also gets 204, so actually this is NOT useful for enumeration since all paths return 204).

  With `CORS_HEADERS` now empty, the preflight response provides no useful CORS permissions, which means cross-origin requests will be blocked by browsers. This is largely a non-issue now that CORS `*` is fixed.

- **Evidence:**
  ```typescript
  // router.ts:19-23
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS) // CORS_HEADERS = {} (no CORS headers)
    res.end()
    return
  }
  ```
- **Recommendation:** Since CORS headers are now empty, the OPTIONS handler serves no purpose. Consider removing it entirely, or return 404 for OPTIONS to avoid confusion. If CORS support is needed in the future, scope it to specific origins and paths.

---

### QA-RED-9: `skipValidation` Query Parameter Bypasses Spec Quality Gates

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:174`, `src/main/queue-api/task-handlers.ts:317`
- **Description:** Both `handleCreateTask` (line 174) and `handleUpdateStatus` (line 317) accept a `?skipValidation=true` query parameter that bypasses semantic spec validation checks entirely. This means any authenticated client can queue tasks with no spec, a malformed spec, or a spec that fails semantic checks. There is no audit trail showing that validation was skipped.

  While this is documented as intentional for programmatic use, it creates a path to queue low-quality tasks that may waste agent compute time and cost money (each agent run incurs API costs).

- **Evidence:**
  ```typescript
  // task-handlers.ts:174
  const skipValidation = url.searchParams.get('skipValidation') === 'true'
  if (!skipValidation) {
    const semantic = await checkSpecSemantic({ ... })
  ```
  ```typescript
  // task-handlers.ts:317
  const skipValidation = url.searchParams.get('skipValidation') === 'true'
  ```
- **Recommendation:** Add an audit log entry when `skipValidation` is used. Consider requiring a separate permission or a distinct API key scope for validation bypass. At minimum, tag tasks created with `skipValidation=true` so they can be identified and reviewed.

---

### QA-RED-10: Unbounded SSE Client Connections

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/sse-broadcaster.ts:26-39`
- **Description:** The SSE broadcaster has no limit on the number of connected clients. Each client holds an open HTTP connection and receives heartbeats every 30 seconds. An attacker with a valid API key could open hundreds of SSE connections, exhausting file descriptors and memory in the main Electron process. Since BDE runs as a desktop app, this could degrade or crash the entire application.
- **Evidence:**
  ```typescript
  // sse-broadcaster.ts:26-39
  addClient(res) {
    res.writeHead(200, { ... })
    clients.add(res)  // No limit check
    res.on('close', () => clients.delete(res))
  ```
- **Recommendation:** Add a maximum client limit (e.g., 20):
  ```typescript
  addClient(res) {
    if (clients.size >= MAX_SSE_CLIENTS) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Too many SSE connections' }))
      return
    }
    // ... existing logic
  }
  ```

---

### QA-RED-11: Error Messages Leak Internal State

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/queue-api/task-handlers.ts:278-280`, `src/main/queue-api/task-handlers.ts:375-378`
- **Description:** Several error handlers include the raw error message in the HTTP response. While this is useful for debugging, it can leak internal implementation details (stack traces, file paths, SQL error messages) to API clients.
- **Evidence:**
  ```typescript
  // task-handlers.ts:278-280
  sendJson(res, 500, {
    error: `Failed to update task ${id}: ${err instanceof Error ? err.message : String(err)}`
  })
  ```
  If the SQLite query fails (e.g., schema mismatch, disk full), the error message may contain file paths like `/Users/ryan/.bde/bde.db` or SQL fragments.
- **Recommendation:** Log the full error server-side and return a generic message to the client:
  ```typescript
  logger.error(`Failed to update task ${id}:`, err)
  sendJson(res, 500, { error: 'Failed to update task' })
  ```

---

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | 0     |
| High     | 0     |
| Medium   | 5     |
| Low      | 5     |

**None found at Critical or High severity.** The Queue API has a solid security foundation: authentication is always enforced, SQL queries use parameterized statements for values, the server binds to `127.0.0.1` (localhost only), the CORS wildcard has been fixed, and request body size is limited. The remaining findings are primarily around authorization granularity (no per-client/per-task scoping), information disclosure through SSE broadcasts and error messages, and defense-in-depth hardening.

## Priority Remediation Order

1. **QA-RED-2** (timing-safe compare) -- trivial fix, eliminates a class of attacks
2. **QA-RED-4** (SQL column regex) -- trivial fix, defense-in-depth
3. **QA-RED-1** (SSE session tokens) -- medium effort but reduces token exposure risk
4. **QA-RED-10** (SSE client limit) -- trivial fix, prevents resource exhaustion
5. **QA-RED-11** (error message sanitization) -- trivial fix, reduces information leakage
6. **QA-RED-7** (SSE per-client filtering) -- medium effort, important for multi-tenant scenarios
7. **QA-RED-9** (skipValidation audit trail) -- small effort, improves observability
8. **QA-RED-6** (agent log authorization) -- medium effort, requires ownership model
9. **QA-RED-3** (batch delete authorization) -- small effort, needs design decision on ownership
10. **QA-RED-5** (status validation) -- trivial fix, input hygiene
