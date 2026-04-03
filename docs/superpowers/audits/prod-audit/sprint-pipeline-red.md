# Sprint Pipeline — Red Team Audit

**Date:** 2026-03-29
**Scope:** 29 files in Sprint Pipeline (handlers, services, queries, shared validation, renderer components, stores, tests)
**Persona:** Red Team (security / penetration-test-style code review)

---

## Cross-Reference with March 28 Audit

### Previously Reported — Now Fixed

| #     | Issue                                                                                                                                                           | Evidence                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| SEC-5 | **CORS `*` on Queue API** — `helpers.ts` now exports `CORS_HEADERS = {}` (empty object). The wildcard `Access-Control-Allow-Origin: *` header has been removed. | `src/main/queue-api/helpers.ts:57` — `export const CORS_HEADERS = {}`                                                   |
| UX-3  | **Pipeline "Edit" button navigates to blank Workbench** — Now calls `loadTask(selectedTask)` before `setView('task-workbench')`.                                | `src/renderer/src/components/sprint/SprintPipeline.tsx:278` — `useTaskWorkbenchStore.getState().loadTask(selectedTask)` |

### Previously Reported — Still Open

| #                  | Issue                                                                                                                                                                                                                                                                                         | Status                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| SEC-6              | **SQL string interpolation in `backupDatabase()`** — `VACUUM INTO '${backupPath}'` in `db.ts`. Not in this audit's scope files but still referenced by sprint-queries via `getDb()`.                                                                                                          | Still open — outside Sprint Pipeline scope but affects same DB.          |
| ARCH-2             | **Repository pattern inconsistently applied** — IPC handlers (`sprint-local.ts`) call `_createTask`, `_updateTask`, `_deleteTask` directly from sprint-queries in some paths, and `updateTask` from sprint-service in others. Three different write paths with different side effects remain. | Still open — `sprint-local.ts` lines 92, 149, 199, 242 show mixed usage. |
| main-process-sd S7 | **SQL column allowlist needs regex assertion** — Column names from `UPDATE_ALLOWLIST` are interpolated into SQL (`${key} = ?`). While the allowlist is a hardcoded Set of safe names, there is no runtime assertion that values are valid SQL identifiers.                                    | Still open — `sprint-queries.ts:200`. See SP-RED-1 below.                |

---

## Findings

### SP-RED-1: SQL Column Name Interpolation Without Identifier Validation

- **Severity:** medium
- **Effort:** S
- **File(s):** `src/main/data/sprint-queries.ts:200`
- **Description:** The `updateTask()` function builds SQL SET clauses by interpolating key names directly into the query string: `setClauses.push(`${key} = ?`)`. While keys are filtered against `UPDATE_ALLOWLIST` (a hardcoded Set of known column names), there is no runtime assertion that the key is a valid SQL identifier. If a future developer adds a value to `UPDATE_ALLOWLIST` containing SQL metacharacters (e.g., `status; DROP TABLE`), it would become an injection vector. The defense is correct but brittle — it relies on the allowlist contents being safe rather than asserting safety at the interpolation point.
- **Evidence:**
  ```typescript
  // sprint-queries.ts:199-200
  for (const [key, value] of entries) {
    setClauses.push(`${key} = ?`)
  ```
  The `entries` come from `Object.entries(patch).filter(([k]) => UPDATE_ALLOWLIST.has(k))` at line 184. The allowlist at lines 45-69 contains only valid column names today.
- **Recommendation:** Add a regex assertion at the interpolation site: `if (!/^[a-z_]+$/.test(key)) throw new Error(`Invalid column name: ${key}`)`. This makes the defense self-documenting and defense-in-depth.

### SP-RED-2: IPC `sprint:update` Accepts Arbitrary Fields Without Allowlist Filtering

- **Severity:** medium
- **Effort:** S
- **File(s):** `src/main/handlers/sprint-local.ts:98-154`
- **Description:** The `sprint:update` IPC handler passes the `patch` parameter directly to `updateTask()` without any field filtering. In contrast, the Queue API's `handleUpdateTask` filters through `GENERAL_PATCH_FIELDS`, and the IPC `sprint:batchUpdate` handler also filters through `GENERAL_PATCH_FIELDS`. The `sprint:update` handler relies entirely on the downstream `UPDATE_ALLOWLIST` in sprint-queries. This means the renderer can write to security-sensitive fields like `claimed_by`, `agent_run_id`, `pr_url`, `pr_number`, and `pr_status` — fields that the Queue API deliberately excludes from general PATCH operations. A compromised renderer (SEC-1 from the March 28 audit) could manipulate task ownership, fake PR associations, or bypass the claim/release protocol.
- **Evidence:**
  ```typescript
  // sprint-local.ts:98,149
  safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
    // ... no field filtering ...
    const result = updateTask(id, patch)
  ```
  Compare with Queue API at `task-handlers.ts:260-267`:
  ```typescript
  for (const [k, v] of Object.entries(raw)) {
    if (GENERAL_PATCH_FIELDS.has(k)) {
      filtered[k] = v
    }
  }
  ```
- **Recommendation:** Add the same `GENERAL_PATCH_FIELDS` filter (or a separate `IPC_PATCH_FIELDS` allowlist) at the top of the `sprint:update` handler. If internal callers (agent manager) need to write `claimed_by` or `pr_*` fields, they should use a separate IPC channel or call sprint-queries directly.

### SP-RED-3: `sprint:unblockTask` Bypasses Spec Quality Checks

- **Severity:** medium
- **Effort:** S
- **File(s):** `src/main/handlers/sprint-local.ts:237-245`
- **Description:** The `sprint:unblockTask` handler transitions a task from `blocked` to `queued` without running structural or semantic spec validation. The `sprint:update` handler runs these checks when `patch.status === 'queued'`, but `sprint:unblockTask` calls `_updateTask(taskId, { status: 'queued' })` directly. A user can create a task with no spec in backlog, add a hard dependency to make it blocked, then unblock it to get a spec-less task into the queue — bypassing the quality gate.
- **Evidence:**
  ```typescript
  // sprint-local.ts:237-245
  safeHandle('sprint:unblockTask', async (_e, taskId: string) => {
    const task = _getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.status !== 'blocked')
      throw new Error(`Task ${taskId} is not blocked (status: ${task.status})`)
    const updated = _updateTask(taskId, { status: 'queued' })
    // No spec validation here
  ```
- **Recommendation:** Before transitioning to queued, run `validateStructural()` and optionally `checkSpecSemantic()` on the task, same as the `sprint:update` handler does.

### SP-RED-4: Symlink-Based Path Traversal in `validateSpecPath`

- **Severity:** high
- **Effort:** S
- **File(s):** `src/main/handlers/sprint-spec.ts:27-37`
- **Description:** The `validateSpecPath()` function uses `path.resolve()` to construct the absolute path from a user-provided relative path and checks that the result starts with the specs root. However, `path.resolve()` does not follow symlinks. If an attacker creates a symlink inside the specs root (e.g., `docs/specs/evil -> /etc`), then `validateSpecPath('evil/passwd')` would resolve to `<specsRoot>/evil/passwd` (passes the prefix check) but actually reads `/etc/passwd`. This is the same class of vulnerability as SEC-2 from the March 28 audit (IDE path traversal), now found in the spec file reading path.
- **Evidence:**
  ```typescript
  // sprint-spec.ts:27-36
  export function validateSpecPath(relativePath: string): string {
    const specsRoot = getSpecsRoot()
    if (!specsRoot) {
      throw new Error('Cannot resolve spec path: BDE repo not configured')
    }
    const resolved = resolve(specsRoot, relativePath)
    if (!resolved.startsWith(specsRoot + '/') && resolved !== specsRoot) {
      throw new Error(`Path traversal blocked: "${relativePath}" resolves outside ${specsRoot}`)
    }
    return resolved
    // No fs.realpathSync() to resolve symlinks
  }
  ```
- **Recommendation:** Add `fs.realpathSync()` after `path.resolve()` and re-check the prefix:
  ```typescript
  const resolved = resolve(specsRoot, relativePath)
  const real = fs.realpathSync(resolved)
  const realRoot = fs.realpathSync(specsRoot)
  if (!real.startsWith(realRoot + '/') && real !== realRoot) {
    throw new Error(`Path traversal blocked`)
  }
  return real
  ```

### SP-RED-5: `sprint:readLog` Agent ID Not Validated — Potential Path Traversal

- **Severity:** medium
- **Effort:** S
- **File(s):** `src/main/handlers/sprint-local.ts:209-216`
- **Description:** The `sprint:readLog` handler takes an `agentId` string from the renderer and passes it to `readLog(agentId, fromByte)`. If `readLog()` constructs a file path from the agent ID (e.g., `~/.bde/agent-logs/${agentId}.log`), a crafted agent ID like `../../etc/passwd` could read arbitrary files. The handler does not validate or sanitize the `agentId` parameter.
- **Evidence:**
  ```typescript
  // sprint-local.ts:209-215
  safeHandle('sprint:readLog', async (_e, agentId: string, rawFromByte?: number) => {
    const fromByte = typeof rawFromByte === 'number' ? rawFromByte : 0
    const info = getAgentLogInfo(getDb(), agentId)
    if (!info) return { content: '', status: 'unknown', nextByte: fromByte }
    const result = await readLog(agentId, fromByte)
    // agentId is not validated for path traversal characters
  ```
- **Recommendation:** Validate that `agentId` matches the expected format (UUID or similar) with a regex like `/^[a-zA-Z0-9_-]+$/` before passing it to `readLog()`. Alternatively, verify the resolved log path starts with the expected log directory.

### SP-RED-6: Unvalidated `href` Construction from Task Notes (Stored XSS via URL)

- **Severity:** medium
- **Effort:** S
- **File(s):** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:222-236`
- **Description:** The TaskDetailDrawer extracts a branch name and GitHub repo from `task.notes` using a regex (`/Branch\s+(\S+)\s+pushed\s+to\s+(\S+)/`) and constructs a URL: `https://github.com/${ghRepo}/pull/new/${branch}`. If an attacker controls the task notes (via Queue API or direct DB manipulation), they could inject a malicious `ghRepo` value like `evil.com/x` resulting in `https://github.com/evil.com/x/pull/new/branch` — or use `javascript:` protocol tricks if the regex captures unexpected content. While React's JSX prevents script injection in `href`, a crafted GitHub-like URL could redirect users to a phishing page.
- **Evidence:**
  ```tsx
  // TaskDetailDrawer.tsx:222-236
  {task.notes && (() => {
    const match = task.notes.match(/Branch\s+(\S+)\s+pushed\s+to\s+(\S+)/)
    if (!match) return null
    const [, branch, ghRepo] = match
    return (
      <a
        className="task-drawer__btn task-drawer__btn--primary"
        href={`https://github.com/${ghRepo}/pull/new/${branch}`}
        target="_blank"
        rel="noreferrer"
      >
  ```
- **Recommendation:** Validate that `ghRepo` matches the expected `owner/repo` format: `/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/`. Validate `branch` similarly. Reject values that don't match.

### SP-RED-7: `sprint:delete` Has No Authorization or Status Guard

- **Severity:** low
- **Effort:** S
- **File(s):** `src/main/handlers/sprint-local.ts:156-163`
- **Description:** The `sprint:delete` handler deletes any task by ID without checking the task's status. An active task with a running agent can be deleted while the agent is still executing, leaving an orphaned agent process. There is no status guard (e.g., preventing deletion of `active` tasks) and no ownership check. While this is a local app with a trusted renderer, it violates the principle that active tasks should only be stopped/cancelled through proper lifecycle transitions.
- **Evidence:**
  ```typescript
  // sprint-local.ts:156-163
  safeHandle('sprint:delete', async (_e, id: string) => {
    const task = getTask(id)
    _deleteTask(id)
    // No status check — active tasks with running agents can be deleted
  ```
- **Recommendation:** Add a guard that prevents deletion of `active` tasks (or at minimum, kills the associated agent first). Consider requiring the task to be in a terminal status or `backlog` before allowing deletion.

### SP-RED-8: `sprint:healthCheck` Uses Direct `_updateTask` Bypassing Notifications

- **Severity:** low
- **Effort:** S
- **File(s):** `src/main/handlers/sprint-local.ts:191-207`
- **Description:** The `sprint:healthCheck` handler calls `_updateTask(task.id, { needs_review: true })` — the raw sprint-queries function — instead of `updateTask()` from sprint-service. This bypasses SSE notifications and IPC push, meaning the renderer won't learn about the `needs_review` flag change until the next poll cycle. While not a direct security issue, it's an inconsistency that could mask stuck-task alerts.
- **Evidence:**
  ```typescript
  // sprint-local.ts:199
  _updateTask(task.id, { needs_review: true })
  // Uses raw query, not sprint-service's updateTask which calls notifySprintMutation
  ```
- **Recommendation:** Use the service-layer `updateTask()` (already imported) instead of `_updateTask()`.

### SP-RED-9: `pr_url` Rendered as Clickable Link Without URL Validation

- **Severity:** low
- **Effort:** S
- **File(s):** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:369-377`
- **Description:** The "View PR" button renders `task.pr_url` directly as an `<a href>`. While `pr_url` is set internally by the completion handler and sprint PR poller (not user-writable via GENERAL_PATCH_FIELDS), it IS in the `UPDATE_ALLOWLIST` in sprint-queries and writable via the IPC `sprint:update` handler (see SP-RED-2). A compromised renderer or direct SQLite manipulation could set `pr_url` to a `javascript:` or phishing URL. React does sanitize `javascript:` URIs in development mode, but production builds may not.
- **Evidence:**
  ```tsx
  // TaskDetailDrawer.tsx:370-376
  <a
    className="task-drawer__btn task-drawer__btn--primary"
    href={task.pr_url}
    target="_blank"
    rel="noreferrer"
  >
    View PR
  </a>
  ```
- **Recommendation:** Validate that `pr_url` starts with `https://github.com/` before rendering it as a link.

### SP-RED-10: `sanitizeDependsOn` Recursive Parsing of Nested JSON Strings

- **Severity:** low
- **Effort:** S
- **File(s):** `src/shared/sanitize-depends-on.ts:14-15`
- **Description:** The `sanitizeDependsOn()` function recursively calls itself when parsing a JSON string: `return sanitizeDependsOn(parsed)`. If a deeply nested JSON string (e.g., `'"[{\"id\":\"x\",\"type\":\"hard\"}]"'` — a JSON string containing a JSON string containing an array) is provided, this could recurse multiple times. While JavaScript's call stack would prevent infinite recursion, a specially crafted deeply nested string could cause a stack overflow. In practice, the depth is bounded by JSON.parse producing a non-string type after at most 2-3 levels, so exploitation is unlikely.
- **Evidence:**
  ```typescript
  // sanitize-depends-on.ts:14-15
  const parsed = JSON.parse(value)
  return sanitizeDependsOn(parsed) // Recursive call
  ```
- **Recommendation:** Add a depth parameter and limit recursion to 2 levels: `sanitizeDependsOn(parsed, depth + 1)` with `if (depth > 2) return null`.

### SP-RED-11: Queue API Status Endpoint Allows `blocked` Status Bypass

- **Severity:** medium
- **Effort:** S
- **File(s):** `src/shared/queue-api-contract.ts:43-50`, `src/main/queue-api/task-handlers.ts:290-392`
- **Description:** `RUNNER_WRITABLE_STATUSES` does not include `blocked`, but it includes `queued`. An external API consumer can transition a `blocked` task directly to `queued` via `PATCH /queue/tasks/:id/status { "status": "queued" }` — the `handleUpdateStatus` handler validates the status against `RUNNER_WRITABLE_STATUSES` but does not check the task's current status or re-evaluate dependencies. This effectively bypasses the dependency blocking system. The `sprint:update` IPC handler has the same gap — it only checks dependencies when transitioning TO queued from a task that was fetched (line 99: `const task = patch.status === 'queued' ? _getTask(id) : null`), but the dependency re-check happens only if the fetched task has `depends_on` set. If a blocked task's dependencies are still unsatisfied, the task shouldn't be manually queued without re-evaluation.
- **Evidence:**
  ```typescript
  // task-handlers.ts:308-309
  const patch = body as StatusUpdateRequest
  if (patch.status && !RUNNER_WRITABLE_STATUSES.has(patch.status)) {
    // Only checks if target status is valid, not if transition is legal
  ```
  ```typescript
  // queue-api-contract.ts:43-50
  export const RUNNER_WRITABLE_STATUSES = new Set([
    'queued',
    'active',
    'done',
    'failed',
    'cancelled',
    'error'
    // 'blocked' is excluded but queued is allowed — so blocked->queued is permitted
  ])
  ```
- **Recommendation:** When transitioning to `queued`, re-evaluate the task's `depends_on` before allowing the transition. If unsatisfied hard dependencies exist, reject the transition or auto-set to `blocked`.

---

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | 0     |
| High     | 1     |
| Medium   | 5     |
| Low      | 5     |

**Overall assessment:** The Sprint Pipeline has solid fundamentals — parameterized SQL queries, field allowlists, dependency cycle detection, and input validation on the Queue API path. The main security gaps are:

1. **Asymmetric validation between IPC and Queue API** (SP-RED-2, SP-RED-11) — the Queue API applies stricter field filtering and status transition guards than the IPC handlers, creating a two-tier security model where the renderer has more write power than external consumers.
2. **Path traversal via symlinks** (SP-RED-4, SP-RED-5) — same class of vulnerability as SEC-2 from the March 28 audit, affecting spec file reading and agent log reading.
3. **Spec quality gate bypass** (SP-RED-3) — the `unblockTask` handler skips spec validation, allowing tasks without adequate specs to enter the queue.

None of these are remotely exploitable (this is a local Electron app), but they represent defense-in-depth gaps that could be exploited by a compromised renderer process (SEC-1 from March 28 audit) or through direct DB manipulation.
