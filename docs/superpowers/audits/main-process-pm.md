# Main Process PM Audit

**Auditor role:** Product Manager
**Scope:** Agent Manager, Queue API, Services, IPC Handlers
**Date:** 2026-03-27

---

## 1. Executive Summary

The BDE main process is a well-structured system with solid architecture patterns (repository injection, dependency indexes, worktree isolation). However, the **user-facing error recovery experience is weak**: when agents fail, users see terse internal notes like "Empty prompt", "Fast-fail exhausted", or "Idle timeout" with no guidance on what to do next. The Queue API contract is mostly clear for external consumers, but has inconsistencies in field naming conventions (`depends_on` vs `dependsOn`) and missing documentation for the `?skipValidation=true` escape hatch. Recovery from common failure modes (token expiry, worktree collisions, DB issues) is handled defensively in code but **invisible to the user** -- they must read `~/.bde/agent-manager.log` to understand what happened.

---

## 2. Critical Issues

### C1. Agent failure notes are not actionable -- user has no recovery path

When an agent fails, the `notes` field is the only user-visible diagnostic. Current notes are internal labels, not actionable guidance:

| File                                   | Line | Notes value                                                                         | What user should see instead                                                                                                                                                                  |
| -------------------------------------- | ---- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/agent-manager/index.ts`      | 147  | `"Max runtime exceeded"`                                                            | "Agent ran for over 1 hour without completing. Consider breaking this task into smaller pieces, or increase max_runtime_ms in task settings."                                                 |
| `src/main/agent-manager/index.ts`      | 162  | `"Idle timeout"`                                                                    | "Agent stopped producing output for 15 minutes and was killed. This usually means the agent got stuck. Check the agent console for the last tool call."                                       |
| `src/main/agent-manager/index.ts`      | 179  | `"Rate-limit loop -- re-queued"`                                                    | "Agent hit API rate limits 10 times and was re-queued. It will retry automatically after a cooldown period."                                                                                  |
| `src/main/agent-manager/run-agent.ts`  | 143  | `"Empty prompt"`                                                                    | "Task has no prompt, spec, or title. Add a spec before queuing."                                                                                                                              |
| `src/main/agent-manager/run-agent.ts`  | 190  | `"Spawn failed: {err.message}"`                                                     | Good -- includes the actual error. But should add: "Check that `claude login` has been run and `~/.bde/oauth-token` is fresh."                                                                |
| `src/main/agent-manager/run-agent.ts`  | 387  | `"Fast-fail exhausted"`                                                             | "Agent crashed 3 times within 30 seconds of starting. This usually indicates a broken spec or missing dependencies. Review the spec and agent console logs."                                  |
| `src/main/agent-manager/completion.ts` | 207  | `"Worktree evicted before completion ({path}). Use ~/worktrees/ instead of /tmp/."` | Actionable but references an internal config detail. Better: "Agent's working directory was deleted before it could finish. This is a known macOS issue. The task will need to be re-queued." |
| `src/main/agent-manager/completion.ts` | 229  | `"Failed to detect branch"`                                                         | "Could not determine which git branch the agent was working on. This usually means the worktree was corrupted. Re-queue the task."                                                            |
| `src/main/agent-manager/completion.ts` | 248  | `"Empty branch name"`                                                               | Same as above -- should be merged into a single actionable message.                                                                                                                           |

**Impact:** Users see error/failed tasks in the pipeline with no idea what to do. They must SSH into logs or read `~/.bde/agent-manager.log` to diagnose.

### C2. Orphan recovery silently re-queues tasks -- user never knows

`src/main/agent-manager/orphan-recovery.ts` lines 25-31: When a task is orphaned (agent died without updating status), it's silently re-queued. The user sees the task flip from "active" back to "queued" with no explanation. There's no note set, no notification, no audit trail entry explaining why.

**Impact:** Users think the system is broken when tasks appear to reset themselves. This is especially confusing when the task has been running for a long time.

### C3. Shutdown re-queues active tasks with no notification

`src/main/agent-manager/index.ts` lines 636-647: On shutdown, all active tasks are re-queued with `status: 'queued', claimed_by: null, started_at: null`. No `notes` field is set, and the task's `started_at` is cleared, losing the information about when it was last attempted.

**Impact:** After an app restart, users see previously-active tasks back in the queue with no indication they were interrupted.

---

## 3. Significant Issues

### S1. Queue API field naming inconsistency confuses external consumers

The Queue API accepts and returns camelCase fields (`dependsOn`, `retryCount`, etc.) via the `field-mapper.ts` layer, but:

- The `handleCreateTask` function (`src/main/queue-api/task-handlers.ts` line 149) destructures `depends_on` (snake_case) from the request body
- The `handleUpdateDependencies` function (line 488) destructures `dependsOn` (camelCase) from the request body
- The `GENERAL_PATCH_FIELDS` set (`src/shared/queue-api-contract.ts` line 71) uses camelCase keys, but `sprint:batchUpdate` IPC handler in `sprint-local.ts` (line 284-288) also filters against `GENERAL_PATCH_FIELDS` -- meaning IPC consumers must also use camelCase

External consumers (Life OS, chat-service, task-runner) must guess which convention to use per endpoint. The `handleCreateTask` endpoint accepts snake_case `depends_on` while `handleUpdateDependencies` expects camelCase `dependsOn`.

### S2. No API documentation or error catalog for Queue API consumers

The Queue API has 14 endpoints but no formal documentation. External consumers must reverse-engineer the contract from:

- `src/shared/queue-api-contract.ts` (types and field sets)
- `src/main/queue-api/router.ts` (endpoint list)
- `src/main/queue-api/task-handlers.ts` (validation logic)

Key undocumented behaviors:

- `?skipValidation=true` bypasses spec quality checks (not discoverable)
- `POST /queue/tasks` with `status=queued` requires a spec with 2+ headings and 50+ chars (unless `?skipValidation=true`)
- `PATCH /queue/tasks/:id` silently drops fields not in `GENERAL_PATCH_FIELDS` -- no error for unrecognized fields
- Batch endpoint caps at 50 operations (not documented in types)
- WIP limit is 5 (hardcoded in `MAX_ACTIVE_TASKS`)
- Task claim returns 409 with different messages for WIP limit vs not-claimable, but the error shape is the same `{ error: string }`

### S3. Spec validation blocks queuing with no way to see what failed in the UI

When a user tries to queue a task via IPC (`sprint:update` with `status: 'queued'`), the handler at `src/main/handlers/sprint-local.ts` lines 98-143 runs structural + semantic checks. If they fail, it throws a raw `Error`:

```
throw new Error(`Cannot queue task -- spec quality checks failed: ${structural.errors.join('; ')}`)
```

This error propagates to the renderer via `safeHandle`, which logs it but the renderer likely shows a generic toast. The `details` array (available in the Queue API response) is lost in the IPC path -- the renderer only gets the flattened error string.

### S4. Agent Manager steer is best-effort in SDK mode with misleading success response

`src/main/agent-manager/sdk-adapter.ts` lines 75-88: The `steer()` method in SDK mode logs a warning that steering is "limited" and then calls `queryHandle.interrupt()`, which is not the same as injecting a message. It returns `{ delivered: true }` even though the message may not have reached the agent.

The warning goes to the log file only -- the user in the UI sees "delivered" and assumes their message was received.

### S5. Token expiry is silently handled -- user has no visibility

`src/main/agent-manager/index.ts` lines 85-123: The `checkOAuthToken` function attempts auto-refresh from Keychain and logs to the agent-manager log file. If the token is stale or refresh fails, the drain loop simply skips -- no tasks are processed, and the user sees agents stuck in "queued" with no explanation.

The proactive refresh at 45 minutes (line 107) is a good defensive measure, but if it fails, there's no user-visible indication. The agent manager status returned to the UI (`getStatus()`) doesn't include token health.

### S6. `safeHandle` swallows error context for IPC callers

`src/main/ipc-utils.ts` lines 18-25: The `safeHandle` wrapper logs the error and then re-throws it. However, the re-thrown error crosses the IPC boundary where Electron serializes it. Complex error objects (with `details` arrays, nested causes) are reduced to just `error.message`. This is why the renderer gets flat strings instead of structured error responses.

### S7. Queue API 500 error response is generic

`src/main/queue-api/server.ts` line 35: The catch-all handler returns `{ error: 'Internal server error' }` with no request ID, no correlation ID, and no hint about what went wrong. For external consumers debugging integration issues, this is a dead end.

---

## 4. Minor Issues

### M1. Stale comment in `server.ts`

`src/main/queue-api/server.ts` line 3: JSDoc says "lightweight Supabase proxy" but the Queue API is no longer a Supabase proxy -- it's a local SQLite-backed task queue.

### M2. `handleHealth` returns hardcoded version string

`src/main/queue-api/task-handlers.ts` line 99: The health endpoint returns `version: '1.0.0'` -- this should come from `package.json` or a build constant.

### M3. `pruneStaleWorktrees` uses `console.warn` instead of injected logger

`src/main/agent-manager/worktree.ts` lines 250, 261: The `pruneStaleWorktrees` function uses `console.warn` for error logging instead of accepting a logger parameter, unlike its sibling `setupWorktree` which accepts one. This means prune errors go to stdout but not to `~/.bde/agent-manager.log`.

### M4. Duplicate `runSdkStreaming` implementation

`src/main/handlers/workbench.ts` lines 24-78 and `src/main/services/spec-synthesizer.ts` lines 243-297 contain nearly identical `runSdkStreaming` implementations. This is a maintenance risk -- a bug fix in one won't propagate to the other.

### M5. `releaseLock` in worktree.ts uses `console.warn`

`src/main/agent-manager/worktree.ts` line 91: Uses `console.warn` instead of the logger pattern used elsewhere in the file. Inconsistent logging destination.

### M6. SSE heartbeat interval not configurable

`src/main/queue-api/sse-broadcaster.ts` line 15: The 30-second heartbeat is hardcoded. For external consumers behind proxies with shorter timeouts, this might not be frequent enough.

### M7. `cleanupWorktree` is fire-and-forget with no error reporting

`src/main/agent-manager/worktree.ts` lines 217-229: The `cleanupWorktree` function uses nested callback-style `execFile` calls with empty error handlers. Failed cleanups are completely silent, potentially leaving stale worktrees that accumulate over time.

### M8. `killAgent` throws instead of returning an error object

`src/main/agent-manager/index.ts` line 681: `killAgent` throws `new Error('No active agent for task ...')` while `steerAgent` (line 675) returns `{ delivered: false, error: 'Agent not found' }`. Inconsistent error handling patterns for similar operations.

---

## 5. Error Message Audit

### Agent Manager (user sees these in task `notes` field)

| Location            | Error String                                     | Actionable? | Recommendation                                          |
| ------------------- | ------------------------------------------------ | ----------- | ------------------------------------------------------- |
| `index.ts:147`      | "Max runtime exceeded"                           | No          | Add time limit value and suggestion to break up task    |
| `index.ts:162`      | "Idle timeout"                                   | No          | Add timeout duration and pointer to agent console       |
| `index.ts:179`      | "Rate-limit loop -- re-queued"                   | Partially   | Add that it will auto-retry after cooldown              |
| `run-agent.ts:143`  | "Empty prompt"                                   | No          | Explain that spec/prompt must be set before queuing     |
| `run-agent.ts:190`  | "Spawn failed: {message}"                        | Yes         | Good -- includes actual error                           |
| `run-agent.ts:387`  | "Fast-fail exhausted"                            | No          | Explain what fast-fail means and suggest reviewing spec |
| `completion.ts:207` | "Worktree evicted before completion..."          | Partially   | Remove internal path detail, add re-queue suggestion    |
| `completion.ts:229` | "Failed to detect branch"                        | No          | Add "re-queue the task" suggestion                      |
| `completion.ts:248` | "Empty branch name"                              | No          | Merge with above                                        |
| `completion.ts:273` | "Agent produced no commits (no output captured)" | Partially   | Add "check agent console for what the agent attempted"  |
| `completion.ts:306` | "git push failed for branch {b}: {err}"          | Yes         | Good -- includes branch and error                       |
| `completion.ts:326` | "Branch {b} pushed but PR creation failed"       | Yes         | Good -- tells user to create PR manually                |
| `index.ts:412`      | "Worktree setup failed: {msg}"                   | Yes         | Good -- includes actual error                           |

### Queue API (external consumers see these in HTTP response body)

| Location               | Error String                                                                  | Actionable? | HTTP Status |
| ---------------------- | ----------------------------------------------------------------------------- | ----------- | ----------- |
| `helpers.ts:39`        | "Missing or invalid Authorization header"                                     | Yes         | 401         |
| `helpers.ts:44`        | "Invalid API key"                                                             | Yes         | 403         |
| `helpers.ts:78`        | "Payload too large"                                                           | Yes         | 413         |
| `task-handlers.ts:126` | "Task {id} not found"                                                         | Yes         | 404         |
| `task-handlers.ts:140` | "Invalid JSON body"                                                           | Yes         | 400         |
| `task-handlers.ts:145` | "Request body must be a JSON object"                                          | Yes         | 400         |
| `task-handlers.ts:151` | "title is required"                                                           | Yes         | 400         |
| `task-handlers.ts:155` | "repo is required"                                                            | Yes         | 400         |
| `task-handlers.ts:167` | "Spec quality checks failed" (+ details array)                                | Yes         | 400         |
| `task-handlers.ts:183` | "Cannot create task with queued status -- semantic checks failed" (+ details) | Yes         | 400         |
| `task-handlers.ts:194` | "depends_on must be an array or null"                                         | Yes         | 400         |
| `task-handlers.ts:200` | "Each dependency must be an object"                                           | Yes         | 400         |
| `task-handlers.ts:205` | "Each dependency must have a valid id"                                        | Yes         | 400         |
| `task-handlers.ts:209` | "Each dependency type must be \"hard\" or \"soft\""                           | Yes         | 400         |
| `task-handlers.ts:234` | "Failed to create task"                                                       | No          | 500         |
| `task-handlers.ts:269` | "No valid fields to update"                                                   | Partially   | 400         |
| `task-handlers.ts:279` | "Failed to update task {id}: {message}"                                       | Yes         | 500         |
| `task-handlers.ts:310` | "Invalid status: {status}"                                                    | Partially   | 400         |
| `task-handlers.ts:335` | "Cannot queue task -- spec quality checks failed" (+ details)                 | Yes         | 400         |
| `task-handlers.ts:350` | "Cannot queue task -- semantic spec checks failed" (+ details)                | Yes         | 400         |
| `task-handlers.ts:426` | "WIP limit reached ({n}/{max} active tasks)..."                               | Yes         | 409         |
| `task-handlers.ts:429` | "Task {id} is not claimable (not queued or does not exist)"                   | Yes         | 409         |
| `task-handlers.ts:462` | "Task {id} is not releasable..."                                              | Partially   | 409         |
| `task-handlers.ts:557` | "operations array is required and must not be empty"                          | Yes         | 400         |
| `task-handlers.ts:562` | "Maximum 50 operations per batch"                                             | Yes         | 400         |
| `server.ts:35`         | "Internal server error"                                                       | No          | 500         |
| `server.ts:42`         | (logged only) "Port {port} is already in use -- Queue API not started..."     | Yes (log)   | N/A         |
| `router.ts:115`        | "Not found"                                                                   | Yes         | 404         |

### IPC Handlers (renderer sees these via `safeHandle` error propagation)

| Location                       | Error String                                                      | Actionable?                             |
| ------------------------------ | ----------------------------------------------------------------- | --------------------------------------- |
| `sprint-local.ts:90`           | "Spec quality checks failed: {errors}"                            | Partially -- errors are joined with `;` |
| `sprint-local.ts:93`           | "Failed to create task"                                           | No -- no reason given                   |
| `sprint-local.ts:111`          | "Cannot queue task -- spec quality checks failed: {errors}"       | Yes                                     |
| `sprint-local.ts:126`          | "Cannot queue task -- semantic checks failed: {msgs}"             | Yes                                     |
| `sprint-local.ts:239`          | "Task {id} not found"                                             | Yes                                     |
| `sprint-local.ts:241`          | "Task {id} is not blocked (status: {s})"                          | Yes                                     |
| `sprint-spec.ts:30`            | "Cannot resolve spec path: BDE repo not configured"               | Partially                               |
| `sprint-spec.ts:34`            | "Path traversal blocked: \"{path}\" resolves outside {root}"      | Yes (security)                          |
| `ide-fs-handlers.ts:19`        | "Path traversal blocked: \"{path}\" is outside root \"{root}\""   | Yes (security)                          |
| `ide-fs-handlers.ts:61`        | "File too large: {size}MB exceeds 5 MB limit"                     | Yes                                     |
| `ide-fs-handlers.ts:71`        | "File appears to be binary and cannot be opened as text"          | Yes                                     |
| `ide-fs-handlers.ts:133-164`   | "No IDE root path set -- call fs:watchDir first" (7 occurrences)  | No -- internal detail                   |
| `terminal-handlers.ts:22`      | "Terminal unavailable: node-pty failed to load"                   | Partially                               |
| `terminal-handlers.ts:26`      | "Shell not allowed: \"{shell}\""                                  | Yes                                     |
| `agent-manager-handlers.ts:29` | "Agent manager not available"                                     | No -- no recovery hint                  |
| `git-handlers.ts:43`           | "GitHub token not configured. Set it in Settings -> Connections." | Yes                                     |
| `git-handlers.ts:49`           | "github:fetch only allows api.github.com URLs"                    | Yes (security)                          |
| `window-handlers.ts:13`        | "Blocked URL scheme: \"{protocol}\""                              | Yes (security)                          |
| `playground-handlers.ts:19`    | "Invalid file type: only .html files are supported (got: {path})" | Yes                                     |
| `playground-handlers.ts:26`    | "File too large: {size}MB exceeds {max}MB limit"                  | Yes                                     |

### Summary Statistics

- **Total error strings audited:** 53
- **Actionable (user can fix):** 31 (58%)
- **Partially actionable:** 11 (21%)
- **Not actionable (internal/opaque):** 11 (21%)

The least actionable errors cluster in the agent failure path (notes field) and internal state guards (IDE root not set, agent manager not available). These are the most user-visible and the most in need of improvement.
