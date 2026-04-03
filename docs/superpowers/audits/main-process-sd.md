# Main Process Audit — Senior Developer

**Auditor:** SD (Code Quality, Security, Performance)
**Date:** 2026-03-27
**Scope:** Agent Manager, Queue API, Data layer, Services, IPC handlers, Core modules

---

## 1. Executive Summary

The BDE main process is well-architected with proper separation of concerns, consistent use of parameterized SQL queries, and layered authentication on the Queue API. The codebase demonstrates mature patterns: atomic task claiming (eliminating TOCTOU races), field-level allowlists for updates, path traversal guards on IDE file operations, and a unified terminal-status service for dependency resolution. However, there are several significant issues: a SQL interpolation concern in `backupDatabase()`, `CORS: *` on a localhost API that handles auth tokens, sandbox disabled in the renderer, and subtle race conditions in the worktree lock mechanism. Error handling is generally good but some critical paths silently swallow errors that could mask data corruption.

---

## 2. Critical Issues

### C1. SQL String Interpolation in `backupDatabase()` — `src/main/db.ts:31`

```typescript
db.exec(`VACUUM INTO '${backupPath}'`)
```

The `backupPath` is `DB_PATH + '.backup'` where `DB_PATH` is `join(homedir(), '.bde', 'bde.db')`. While `homedir()` is not directly user-controllable at runtime, this is the **only place** in the entire codebase that uses string interpolation in SQL. If `DB_PATH` were ever made configurable (e.g., via a setting or env var), this becomes a direct SQL injection vector. The `VACUUM INTO` statement cannot use parameterized queries in SQLite, but the path should at minimum be validated for dangerous characters (quotes, semicolons).

**Severity:** Medium-High (low exploitability today, high blast radius if the path ever becomes configurable)
**Fix:** Validate `backupPath` contains no `'` characters, or use a fixed path constant.

### C2. Renderer Sandbox Disabled — `src/main/index.ts:60`

```typescript
sandbox: false,
```

The TODO comment acknowledges this. With `sandbox: false`, a compromised renderer (e.g., via XSS in PR comments rendered in the diff viewer) gets full Node.js access through the preload bridge. This is the single biggest security surface in the application.

**Severity:** High
**Fix:** Migrate preload to message-port IPC and re-enable sandbox.

### C3. CORS `Access-Control-Allow-Origin: *` on Auth-Protected API — `src/main/queue-api/helpers.ts:56`

```typescript
'Access-Control-Allow-Origin': '*',
```

The Queue API runs on `127.0.0.1:18790` and requires Bearer auth, but the wildcard CORS allows any browser tab on the machine to make cross-origin requests. A malicious website open in the user's browser could probe `localhost:18790` with fetch requests. Since the API key is auto-generated and not available to the attacker, the risk is limited to probing existence and timing attacks, but this violates the principle of defense-in-depth.

**Severity:** Medium (mitigated by auth requirement; risk increases if token leaks)
**Fix:** Set `Access-Control-Allow-Origin` to the Electron app's origin, or remove it entirely since only same-process and CLI clients consume this API.

### C4. Auth Token Exposed in Query String — `src/main/queue-api/helpers.ts:32-35`

```typescript
const queryToken = url.searchParams.get('token')
```

The `?token=` query parameter is used for SSE clients. Query parameters are logged in HTTP server access logs, browser history, and proxy logs. While this is localhost-only, it reduces the security posture of the token.

**Severity:** Low-Medium (localhost only, but query strings can leak into process listings)
**Fix:** Document this as SSE-only. Consider cookie-based auth for SSE or a separate SSE token with reduced scope.

---

## 3. Significant Issues

### S1. Worktree Lock TOCTOU Race — `src/main/agent-manager/worktree.ts:56-83`

The lock mechanism reads the lock file, checks PID liveness, deletes the stale lock, then re-creates it. Between `rmSync(lockFile)` at line 79 and `writeFileSync(lockFile, ..., { flag: 'wx' })` at line 83, another process can acquire the lock. This is a classic TOCTOU race in the lock-recovery path. The window is small but real when multiple BDE instances or rapid drain cycles occur.

**File:** `src/main/agent-manager/worktree.ts:56-83`
**Fix:** Use `O_CREAT | O_EXCL` atomically after removing, or use `flock()`/advisory locking.

### S2. Orphan Recovery vs. In-Flight Completion Handler Race — `src/main/agent-manager/orphan-recovery.ts:17`

If an agent completes and `resolveSuccess` is still running (pushing branch, creating PR), the agent is removed from `activeAgents` at `run-agent.ts:438` only AFTER the completion handler finishes. However, if `resolveSuccess` is slow (network I/O for git push + PR creation can take 30+ seconds) and the orphan recovery runs during that window, it checks `isAgentActive(task.id)` which returns `true` since the agent is still in the map. This is correct.

The subtler risk: if the agent's `runAgent` promise rejects unexpectedly between `activeAgents.delete` and the `finally` block, the task could be left `active` without an agent. The orphan recovery would catch this on the next cycle (60s), which is acceptable.

**Severity:** Low (orphan recovery provides the safety net within 60s)

### S3. No Status Transition Validation in `updateTask` — `src/main/data/sprint-queries.ts:180-233`

`updateTask` accepts any status value without validating the transition is legal. For example, nothing prevents transitioning from `done` back to `backlog` via a direct `updateTask` call. The Queue API's `handleUpdateStatus` restricts to `RUNNER_WRITABLE_STATUSES`, and the IPC handler does some checking, but the data layer itself is permissive. Any internal caller can set any status.

**File:** `src/main/data/sprint-queries.ts:180`
**Severity:** Medium (status integrity relies on all callers doing the right thing)
**Fix:** Add a `VALID_TRANSITIONS` map at the data layer, or at minimum the service layer (`sprint-service.ts`).

### S4. `handleBatchTasks` Allows `delete` Without Status Check — `src/main/queue-api/task-handlers.ts:606-608`

The batch endpoint allows deleting any task by ID regardless of status. An active task being worked on by an agent could be deleted, leaving the agent writing to a non-existent task and causing errors when it tries to update the task on completion.

**File:** `src/main/queue-api/task-handlers.ts:606`
**Severity:** Medium
**Fix:** Check task status before delete; reject deletion of `active` tasks.

### S5. Fire-and-Forget `onTaskTerminal` in Watchdog — `src/main/agent-manager/index.ts:149`

```typescript
onTerminal(taskId, 'error').catch((err) => ...)
```

The watchdog calls `onTerminal` with `.catch()` (fire-and-forget). If this fails, the dependent tasks will never be unblocked. The dependency index is rebuilt on next drain cycle, but `resolveDependents` only runs when a task reaches terminal status -- not on rebuild.

**File:** `src/main/agent-manager/index.ts:149`
**Severity:** Low-Medium (unblocking delay until another task completes)
**Fix:** Add a periodic "check all blocked tasks" sweep that re-evaluates dependencies.

### S6. `claimTask` Without WIP Limit in Non-API Path — `src/main/data/sprint-queries.ts:269-278`

When `claimTask` is called without `maxActive` (lines 269-278), there is no WIP limit check. The Agent Manager calls `claimTask(taskId, EXECUTOR_ID)` via the repository (no `maxActive`), relying on the drain loop's `availableSlots()` check. But the repository interface (`ISprintTaskRepository.claimTask`) doesn't pass `maxActive`, so the atomic WIP guard is bypassed for internal claims.

**File:** `src/main/data/sprint-task-repository.ts:31` (no `maxActive` param)
**Severity:** Low-Medium (drain loop has its own slot check, but it's not atomic with the claim)

### S7. `updateTask` Dynamic Column Names — `src/main/data/sprint-queries.ts:200`

```typescript
setClauses.push(`${key} = ?`)
```

Column names from `UPDATE_ALLOWLIST` are interpolated into SQL. The allowlist is a hardcoded `Set<string>` of known safe column names. Safe today but fragile: if someone adds a field to `UPDATE_ALLOWLIST` with a name containing SQL metacharacters, injection would occur. Same pattern in `agent-queries.ts:139` with `AGENT_COLUMN_MAP`.

**Fix:** Add a startup-time assertion that all allowlist entries match `/^[a-z_]+$/`.

---

## 4. Minor Issues

### M1. Duplicate `runSdkStreaming` Implementation

`src/main/handlers/workbench.ts:24-78` and `src/main/services/spec-synthesizer.ts:243-297` contain nearly identical `runSdkStreaming` functions. Both manage separate `activeStreams` maps.

**Fix:** Extract to a shared utility in `src/main/services/sdk-streaming.ts`.

### M2. `backupDatabase` Catches and Logs But Doesn't Propagate — `src/main/db.ts:32-34`

If the backup fails (e.g., disk full), it's logged to console but the app continues. The 24-hour backup interval silently fails repeatedly.

**Fix:** Track consecutive failures and surface a warning to the user after N failures.

### M3. `getQueuedTasks` Doesn't Filter Tasks With Unsatisfied Dependencies — `src/main/data/sprint-queries.ts:461-476`

The SQL query returns all `queued` tasks with `claimed_by IS NULL`, but some may have unsatisfied dependencies. The drain loop handles this with `_checkAndBlockDeps`, but it's an extra DB round-trip per incorrectly-queued task.

**Fix:** Either add a SQL join to check deps, or ensure all creation/transition paths correctly set `blocked` status.

### M4. `console.warn` Used Instead of Logger in Several Places

- `src/main/agent-manager/worktree.ts:91` -- `console.warn` in `releaseLock`
- `src/main/agent-manager/worktree.ts:251` -- `console.warn` in `pruneStaleWorktrees`

These bypass the structured file logger.

### M5. `err: any` Usage — `src/main/handlers/workbench.ts:318`, `src/main/services/spec-synthesizer.ts:48,66,104,132`

Multiple `catch` blocks use `err: any` instead of typed error handling.

### M6. `buildAgentEnv()` Returns Mutable Copy But Caches Internal State — `src/main/env-utils.ts:18`

`buildAgentEnv()` returns `{ ..._cachedEnv }` which is a shallow copy. If a caller mutates a nested value (unlikely since all values are strings), it could affect the cache. The current usage is safe, but the comment "safe to mutate" in CLAUDE.md could mislead.

### M7. No Rate Limiting on Queue API — `src/main/queue-api/server.ts`

The Queue API has no request rate limiting. A misbehaving external client could flood the API with requests, causing SQLite contention and high CPU.

**Fix:** Add a simple token-bucket rate limiter per IP or per token.

### M8. Missing Audit Trail for `claimTask`/`releaseTask` — `src/main/data/sprint-queries.ts:243-302`

`claimTask` and `releaseTask` modify task fields (`status`, `claimed_by`, `started_at`) but don't call `recordTaskChanges`. Only `updateTask` records changes.

**Fix:** Add `recordTaskChanges` calls to `claimTask` and `releaseTask`.

### M9. `handleRelease` Uses `claimed_by` Field Name (snake_case) — `src/main/queue-api/task-handlers.ts:454`

The Queue API generally expects camelCase from clients, but `handleRelease` reads `claimed_by` (snake_case) from the request body. Inconsistent with the rest of the API surface which uses `executorId`, `dependsOn`, etc.

### M10. Token Comparison Uses `===` (Not Constant-Time) — `src/main/queue-api/helpers.ts:43`

```typescript
if (token !== apiKey) {
```

String comparison with `!==` is vulnerable to timing attacks. While this is localhost-only and the risk is extremely low, using `crypto.timingSafeEqual()` is the standard defense.

---

## 5. Security Checklist

| Category             | Status             | Notes                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQL Injection**    | PASS (with caveat) | All queries use parameterized `?` placeholders. Dynamic column names in `updateTask` and `updateAgentMeta` are gated by hardcoded allowlists. One exception: `VACUUM INTO '${backupPath}'` uses string interpolation but the path is not user-controllable today (see C1).                                              |
| **Auth Bypass**      | PASS               | Queue API enforces auth on all routes except OPTIONS (CORS preflight). `checkAuth()` runs before any handler in `router.ts:26`.                                                                                                                                                                                         |
| **Shell Injection**  | PASS               | All subprocess calls use `execFile`/`execFileAsync` with argument arrays, never string interpolation. `spawn` in `sdk-adapter.ts` also uses argument arrays. The `grep` call in `workbench.ts:289` and `spec-synthesizer.ts:87` pass the query as a separate argument via `['--', keyword, '.']`, preventing injection. |
| **Path Traversal**   | PASS               | IDE file operations validate paths against `ideRootPath` via `validateIdePath()`. Git operations validate against configured repo paths via `validateRepoPath()`. Spec file reads validate against `getSpecsRoot()`.                                                                                                    |
| **CORS**             | WARN               | `Access-Control-Allow-Origin: *` is overly permissive for a local API that handles auth tokens (see C3).                                                                                                                                                                                                                |
| **Token Handling**   | PASS (with note)   | OAuth token file is written with `mode: 0o600`. Token is cached in memory for 5 min. Keychain access is async (no main-thread hang). Query-string token for SSE is a minor concern (C4).                                                                                                                                |
| **Input Validation** | PASS               | Task creation validates title/repo presence, depends_on structure, cycle detection, and spec quality. Field updates are filtered through allowlists (`GENERAL_PATCH_FIELDS`, `STATUS_UPDATE_FIELDS`, `UPDATE_ALLOWLIST`).                                                                                               |
| **DoS Protection**   | WARN               | Request body size is capped at 5MB. Batch operations capped at 50. But no rate limiting on API requests (M7).                                                                                                                                                                                                           |
| **Sandbox**          | FAIL               | Renderer sandbox is disabled (C2).                                                                                                                                                                                                                                                                                      |
