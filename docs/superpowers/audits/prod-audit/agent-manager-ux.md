# Agent Manager — UX QA Audit

**Date:** 2026-03-29
**Scope:** 35 files (18 source, 17 tests) in Agent Manager subsystem
**Persona:** UX QA Engineer

---

## Cross-Reference with March 28 Audit

### Previously Reported — Now Fixed

1. **UX-1 (partial): Agent failure notes are not actionable** — The March 28 synthesis flagged `main-process-pm C1` noting that users see "Fast-fail exhausted", "Idle timeout", "Empty prompt" with no recovery guidance. This has been **substantially improved**:
   - Fast-fail exhausted (`run-agent.ts:377-379`) now says: _"Agent failed 3 times within 30s of starting. Common causes: expired OAuth token (~/.bde/oauth-token), missing npm dependencies, or invalid task spec. Check ~/.bde/agent-manager.log for details. To retry: reset task status to 'queued' and clear claimed_by."_
   - Idle timeout (`index.ts:164-166`) now says: _"Agent produced no output for 15 minutes. The agent may be stuck or rate-limited. Check agent events for the last activity. To retry: reset task status to 'queued'."_
   - Max runtime (`index.ts:146-148`) now says: _"Agent exceeded the maximum runtime of N minutes. The task may be too large for a single agent session. Consider breaking it into smaller subtasks."_
   - Empty prompt (`run-agent.ts:145`) now says: _"Agent failed to start: task has no prompt, spec, or title. To fix: edit the task and provide a prompt or spec describing what the agent should do."_

2. **main-process-pm C2 (partial): Orphan recovery sets notes explaining re-queue** — `orphan-recovery.ts:31` now writes: _"Task was re-queued by orphan recovery (was claimed but agent is no longer running)."_

3. **main-process-pm C3 (partial): Shutdown re-queue sets notes** — `index.ts:647` now writes: _"Task was re-queued due to BDE shutdown while agent was running."_

### Previously Reported — Still Open

1. **UX-1 (remaining gap): Rate-limit loop note is still terse** — `index.ts:181` sets notes to `'Rate-limit loop — re-queued'` with no guidance on what to do. Unlike the other watchdog verdicts, this lacks recovery instructions. (Addressed in AM-UX-1 below.)

2. **ARCH-6: Fragile `onStatusTerminal` wiring** — The `TaskTerminalService` pattern is in place (`task-terminal-service.ts`), but `AgentManagerImpl.onTaskTerminal` (`index.ts:280-289`) still has a dual-path: if `config.onStatusTerminal` is set it calls that, otherwise it falls back to inline `resolveDependents`. The wiring fragility concern from the March 28 audit remains relevant — there are two code paths for the same terminal-status logic.

3. **main-process-sd M1 / main-process-ax 2.1: Duplicate `runSdkStreaming`** — `sdk-streaming.ts` exists as an extracted utility, but it hardcodes `model: 'claude-sonnet-4-5'` (line 30) while `sdk-adapter.ts` accepts the model as a parameter. The agent manager does not use `sdk-streaming.ts` (it has its own streaming via `run-agent.ts` message loop). The duplication concern persists.

---

## Findings

### AM-UX-1: Rate-limit loop requeue note lacks recovery guidance

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:179-182`
- **Description:** When the watchdog detects a rate-limit loop, the task is re-queued with the note `'Rate-limit loop — re-queued'`. Unlike the other watchdog verdicts (max-runtime, idle), this gives the user no guidance on what happened or what to do. A user seeing this in the Pipeline view has no idea whether to wait, reduce concurrency, or take another action.
- **Evidence:**
  ```ts
  } else if (verdict === 'rate-limit-loop') {
    concurrency = applyBackpressure(concurrency, Date.now())
    try {
      updateTaskFn(taskId, {
        status: 'queued',
        claimed_by: null,
        notes: 'Rate-limit loop — re-queued'
      })
    }
  ```
- **Recommendation:** Change notes to: `'Agent hit API rate limits 10+ times and was re-queued with lower concurrency. This usually resolves automatically. If it persists, reduce maxConcurrent in Settings or wait for rate limit cooldown.'`

### AM-UX-2: Steer in SDK mode silently degrades with misleading "delivered: true"

- **Severity:** high
- **Effort:** M (1-4hr)
- **File(s):** `src/main/agent-manager/sdk-adapter.ts:76-89`
- **Description:** When a user steers an agent via the UI (e.g., `/steer` command), the SDK path calls `queryResult.interrupt()` and returns `{ delivered: true }`. However, as the code comment acknowledges, "Steer in SDK mode is limited — message may not reach agent." The user sees a success confirmation for an action that likely did nothing. The steer message content is logged as a warning but never sent to the agent.
- **Evidence:**
  ```ts
  async steer(message: string): Promise<SteerResult> {
    try {
      ;(logger ?? console).warn(
        `[agent-manager] Steer in SDK mode is limited — message may not reach agent: "${message.slice(0, 100)}"`
      )
      await queryResult.interrupt()
      return { delivered: true } // <-- misleading
    }
  ```
- **Recommendation:** Return `{ delivered: false, error: 'Steering is not supported for SDK-spawned agents. The agent was interrupted but your message was not delivered.' }` so the UI can display an appropriate warning. Alternatively, return a new `SteerResult` field like `{ delivered: true, degraded: true }` that the renderer can use to show a yellow warning instead of green success.

### AM-UX-3: No user-visible feedback when repo path resolution fails

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:387-391`
- **Description:** When a queued task references a repo slug that doesn't match any configured repo, the drain loop logs a warning and silently skips the task. The task remains in `queued` status forever with no notes explaining why it's not being picked up. The user sees a stuck task with no indication of the problem.
- **Evidence:**
  ```ts
  const repoPath = this.resolveRepoPath(task.repo)
  if (!repoPath) {
    this.logger.warn(`[agent-manager] No repo path for "${task.repo}" — skipping task ${task.id}`)
    return // <-- task stays queued silently
  }
  ```
- **Recommendation:** Update the task with an error status and notes: `repo.updateTask(task.id, { status: 'error', notes: 'Repo "${task.repo}" is not configured in BDE settings. Add it in Settings > Repos, then reset this task to queued.', claimed_by: null })`. Then call `onTaskTerminal(task.id, 'error')`.

### AM-UX-4: `claimed_by` not cleared on watchdog max-runtime and idle kills

- **Severity:** high
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:142-174`
- **Description:** When the watchdog kills an agent for max-runtime or idle timeout, `handleWatchdogVerdict` sets `status: 'error'` and `needs_review: true` but does NOT set `claimed_by: null`. The `_watchdogLoop` deletes the agent from `_activeAgents` (line 503), but the DB record retains the stale `claimed_by`. This means orphan recovery will find the task as orphaned (claimed but no active agent) and re-queue it — contradicting the intent of marking it as `error`. CLAUDE.md explicitly warns: "Must clear BOTH `status` AND `claimed_by`".
- **Evidence:**
  ```ts
  if (verdict === 'max-runtime') {
    try {
      updateTaskFn(taskId, {
        status: 'error',
        completed_at: now,
        notes: `Agent exceeded the maximum runtime...`,
        needs_review: true
        // <-- missing: claimed_by: null
      })
  ```
- **Recommendation:** Add `claimed_by: null` to the `updateTaskFn` call for both `max-runtime` and `idle` verdicts in `handleWatchdogVerdict`.

### AM-UX-5: `emitAgentEvent` silently swallows SQLite write failures with no alternative feedback

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-event-mapper.ts:71-75`
- **Description:** When SQLite fails to persist an agent event, the error is completely swallowed with an empty catch block. While the broadcast succeeds (real-time display works), the event is lost from history. If the user refreshes or restarts, those events are gone. There's no logging, metric, or indication that events are being lost.
- **Evidence:**
  ```ts
  try {
    appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
  } catch {
    // SQLite write failure is non-fatal
  }
  ```
- **Recommendation:** Add a `console.warn` or use the module's logger to record the failure. This doesn't need to be user-facing but should at least be visible in the app log for debugging when users report missing agent history.

### AM-UX-6: `resolveFailure` returns `false` when DB update fails, leaving task in stale state

- **Severity:** high
- **Effort:** M (1-4hr)
- **File(s):** `src/main/agent-manager/completion.ts:366-392`
- **Description:** When `resolveFailure` tries to update a task to either `queued` (retry) or `failed` (terminal), and the DB write throws, it catches the error, logs it, and returns `false` (not terminal). The caller (`run-agent.ts:419-425`) treats `false` as "retry was queued, don't call onTaskTerminal." But the DB write failed, so the task is still in `active` status with `claimed_by` set. The task is now stuck: orphan recovery will eventually find it and re-queue, but this is an unpredictable delay with no feedback to the user.
- **Evidence:**
  ```ts
  } catch (err) {
    logger?.error(`[completion] Failed to update task ${taskId} during failure resolution: ${err}`)
    return false // <-- caller thinks retry succeeded
  }
  ```
- **Recommendation:** Distinguish between "retry queued" (`false`) and "DB error" (throw or new return value). The caller should attempt a fallback update or at minimum set `needs_review: true` if it catches the error.

### AM-UX-7: Task terminal service rebuilds entire dependency index on every terminal event

- **Severity:** low
- **Effort:** M (1-4hr)
- **File(s):** `src/main/services/task-terminal-service.ts:24-27`
- **Description:** `onStatusTerminal` calls `rebuildIndex()` which fetches ALL tasks with dependencies and rebuilds the entire reverse index from scratch on every single terminal status transition. While the comment in `index.ts:442` says "Rebuild is O(n) and cheap," this is a UX concern for users with hundreds of tasks — every terminal event triggers a full table scan + rebuild. This could cause perceptible delays in status updates propagating to the UI.
- **Evidence:**
  ```ts
  function onStatusTerminal(taskId: string, status: string): void {
    if (!TERMINAL_STATUSES.has(status)) return
    try {
      rebuildIndex() // <-- full rebuild every time
      resolveDependents(taskId, status, depIndex, deps.getTask, deps.updateTask, deps.logger)
    }
  ```
- **Recommendation:** Consider an incremental update strategy or cache the dependency index with a dirty flag that only rebuilds when tasks are created/updated, not on every terminal transition.

### AM-UX-8: `killAgent` throws an uncaught Error for missing agents instead of returning a result

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:684-688`
- **Description:** `killAgent(taskId)` throws `new Error('No active agent for task ${taskId}')` when the agent isn't found. If the IPC handler calling this doesn't catch the error properly, the user sees a raw error message. Compare with `steerAgent` (line 680) which gracefully returns `{ delivered: false, error: 'Agent not found' }`. The inconsistency is confusing for both the calling code and the user.
- **Evidence:**
  ```ts
  killAgent(taskId: string): void {
    const agent = this._activeAgents.get(taskId)
    if (!agent) throw new Error(`No active agent for task ${taskId}`)
    agent.handle.abort()
  }
  ```
- **Recommendation:** Change to return a result type (e.g., `{ killed: boolean; error?: string }`) or at minimum make the IPC handler catch the error and return a user-friendly message. Match the pattern used by `steerAgent`.

### AM-UX-9: Worktree setup error notes truncated to 500 chars, may lose critical diagnostic info

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:414`
- **Description:** When worktree setup fails, the error message is truncated to `NOTES_MAX_LENGTH` (500 chars). Git error messages for worktree failures (lock conflicts, path issues) can be verbose but contain the key diagnostic information at the end of the message. Truncation may cut off the most useful part.
- **Evidence:**
  ```ts
  notes: `Worktree setup failed: ${errMsg}`.slice(0, NOTES_MAX_LENGTH),
  ```
- **Recommendation:** Truncate from the beginning rather than the end for git errors (keep the tail which contains the actual error), or increase `NOTES_MAX_LENGTH` to 1000 for worktree errors specifically.

### AM-UX-10: No agent:started event emitted for agents that fail during spawn

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/run-agent.ts:160-191`
- **Description:** When `spawnAgent` rejects (line 176), the task is marked as error and cleanup happens, but no `agent:started` or `agent:error` event is emitted. The renderer's agent console never shows anything for this task — it appears to have never existed. The user sees the task status change to `error` in the pipeline but has no events in the agent console to explain what happened.
- **Evidence:**
  ```ts
  } catch (err) {
    logger.error(`[agent-manager] spawnAgent failed for task ${task.id}: ${err}`)
    try {
      repo.updateTask(task.id, {
        status: 'error',
        notes: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
        // ...
      })
    } catch (updateErr) { /* ... */ }
    await onTaskTerminal(task.id, 'error')
    cleanupWorktree(/* ... */)
    return  // <-- no agent event emitted
  }
  ```
  Compare with the successful path where `agent:started` is emitted at line 245.
- **Recommendation:** Emit an `agent:error` event before returning from the spawn failure path: `emitAgentEvent(randomUUID(), { type: 'agent:error', message: 'Spawn failed: ' + errMsg, timestamp: Date.now() })`. Use the task ID as the agent ID so the event associates correctly.

### AM-UX-11: Completion handler does not emit agent events for worktree eviction or branch detection failures

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/completion.ts:227-279`
- **Description:** When `resolveSuccess` encounters a worktree eviction (line 227), branch detection failure (line 247), or empty branch name (line 264), it updates the task status and calls `onTaskTerminal` but does not emit any agent events. The agent console shows the agent completed normally (via `agent:completed` from `run-agent.ts:333`), then the task silently transitions to `error`. The user sees a disconnect between "agent completed" and "task errored" with no explanation in the agent event stream.
- **Evidence:** All three early-return paths in `resolveSuccess` (lines 227-279) update task status and call `onTaskTerminal` but never call `emitAgentEvent` or `broadcast`.
- **Recommendation:** Emit an `agent:error` event before each early return, e.g.: `broadcast('agent:event', { agentId: taskId, event: { type: 'agent:error', message: 'Worktree evicted before completion', timestamp: Date.now() } })`.

### AM-UX-12: `pr_status='branch_only'` is set but no UI guidance for what the user should do

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/agent-manager/completion.ts:351-359`
- **Description:** When PR creation fails after all retries, the task is set to `pr_status: 'branch_only'` with notes mentioning the branch was pushed. The code comment says "so the UI shows a 'Create PR' link instead of silently orphaning." However, the notes don't tell the user HOW to create the PR manually, and the `pr_status='branch_only'` value isn't documented in user-facing text.
- **Evidence:**
  ```ts
  repo.updateTask(taskId, {
    pr_status: 'branch_only',
    notes: `Branch ${branch} pushed to ${ghRepo} but PR creation failed after ${PR_CREATE_MAX_ATTEMPTS} attempts`
  })
  ```
- **Recommendation:** Enhance notes to include actionable recovery: `Branch ${branch} pushed to ${ghRepo} but PR creation failed after ${PR_CREATE_MAX_ATTEMPTS} attempts. To create the PR manually: gh pr create --head ${branch} --repo ${ghRepo}`.

### AM-UX-13: Dependency check failure in drain loop silently falls through to claim

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:346-351`
- **Description:** In `_checkAndBlockDeps`, if dependency JSON parsing fails, the outer `catch` block (line 348) returns `false`, allowing the task to proceed to claim and spawn. This means a task with malformed `depends_on` data bypasses all dependency checks and starts running immediately, potentially before its actual dependencies are complete.
- **Evidence:**
  ```ts
  } catch {
    // If dep parsing fails, proceed without blocking
  }
  return false
  ```
- **Recommendation:** Log the malformed deps and set a note on the task warning that dependency validation was skipped: `logger.warn(...)` and optionally `repo.updateTask(taskId, { notes: 'Warning: dependency validation skipped due to malformed depends_on data' })`. Consider returning `true` (block) rather than `false` (proceed) for safety.

### AM-UX-14: `mapRawMessage` returns empty array for unrecognized message types with no logging

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-event-mapper.ts:14-63`
- **Description:** `mapRawMessage` silently returns an empty array for any message type that isn't `assistant`, `tool_result`, or `result`. This means SDK protocol changes that introduce new message types (e.g., `system`, `error`, `progress`) will be invisible to the user. The agent console will show gaps in activity with no indication that messages were received but dropped.
- **Evidence:** The function only handles three message types (`assistant`, `tool_result`/`result`). Any other type returns `[]` with no logging or fallback event.
- **Recommendation:** Add a fallback for unrecognized types that emits a generic event: `events.push({ type: 'agent:text', text: '[system message]', timestamp: now })` or at minimum log unrecognized types at debug level for troubleshooting.

---

## Summary

| Severity | Count      |
| -------- | ---------- |
| Critical | None found |
| High     | 3          |
| Medium   | 7          |
| Low      | 4          |

**Total findings: 14**

### High severity findings:

- **AM-UX-2**: Steer returns misleading "delivered: true" when message is never sent (SDK mode)
- **AM-UX-4**: Missing `claimed_by: null` on watchdog kills causes task state inconsistency
- **AM-UX-6**: `resolveFailure` DB error leaves task stuck in active state with no feedback

### Key positive observations:

- Agent failure notes have been substantially improved since the March 28 audit, with actionable recovery guidance for all major failure modes (fast-fail, idle, max-runtime, empty prompt)
- Orphan recovery and shutdown now set explanatory notes
- The completion handler has robust PR creation retry logic with race condition handling
- The `branch_only` pr_status fallback prevents silent PR orphaning
- Test coverage is thorough across all modules (17 test files covering edge cases, error paths, and race conditions)

### Architectural note:

The Agent Manager is fundamentally a main-process orchestrator. Most "UX" concerns manifest as: (a) what notes/status get written to the task record (visible in Pipeline view), and (b) what events get emitted via `emitAgentEvent` (visible in Agent console). The findings above primarily address gaps in these two feedback channels.
