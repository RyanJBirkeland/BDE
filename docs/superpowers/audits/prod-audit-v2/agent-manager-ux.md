# Agent Manager -- UX QA Follow-Up Audit

**Date:** 2026-03-29
**Scope:** Follow-up verification of 14 UX findings (AM-UX-1 through AM-UX-14) from prod-audit v1
**Persona:** UX QA Engineer

---

## Summary Table

| Finding | Title | v1 Severity | Status | Evidence |
|---------|-------|-------------|--------|----------|
| AM-UX-1 | Rate-limit loop requeue note lacks recovery guidance | Medium | **Fixed** | `index.ts:193` now includes full guidance |
| AM-UX-2 | Steer returns misleading "delivered: true" in SDK mode | High | **Fixed** | `sdk-adapter.ts:76` returns `{ delivered: false, error: 'SDK mode does not support steering' }` |
| AM-UX-3 | No user-visible feedback when repo path resolution fails | Medium | **Fixed** | `index.ts:427-438` sets task to error with actionable note and calls `onTaskTerminal` |
| AM-UX-4 | `claimed_by` not cleared on watchdog max-runtime and idle kills | High | **Fixed** | `index.ts:158` and `index.ts:177` both include `claimed_by: null` |
| AM-UX-5 | `emitAgentEvent` silently swallows SQLite write failures | Low | **Fixed** | `agent-event-mapper.ts:80-87` now logs with rate-limited `console.warn` (1/min) |
| AM-UX-6 | `resolveFailure` returns false on DB error, leaving task stuck | High | **Fixed** | `completion.ts:428-431` now returns `isTerminal` even on DB failure, so caller triggers `onStatusTerminal` correctly |
| AM-UX-7 | Task terminal service rebuilds entire dep index on every terminal event | Low | **Not Fixed** | `task-terminal-service.ts:32` still calls `rebuildIndex()` every time |
| AM-UX-8 | `killAgent` throws uncaught Error for missing agents | Medium | **Fixed** | `index.ts:749-759` returns `{ killed: boolean; error?: string }` result type |
| AM-UX-9 | Worktree setup error notes truncated to 500 chars, loses diagnostic info | Low | **Fixed** | `index.ts:461-463` now keeps the tail of the message (truncates from the front with `'...'` prefix) |
| AM-UX-10 | No agent:started event emitted for agents that fail during spawn | Medium | **Fixed** | `run-agent.ts:198-202` emits `agent:error` event before updating task status on spawn failure |
| AM-UX-11 | Completion handler does not emit agent events for worktree eviction/branch failures | Medium | **Fixed** | `completion.ts:246-251`, `272-277`, `296-301` all emit `agent:error` events via `broadcast` before early returns |
| AM-UX-12 | `pr_status='branch_only'` has no UI guidance for manual PR creation | Medium | **Fixed** | `completion.ts:390` now includes `gh pr create --head ${branch} --repo ${ghRepo}` in notes |
| AM-UX-13 | Dependency check failure in drain loop silently falls through to claim | Medium | **Fixed** | `index.ts:374-387` now sets task to `error` with note and returns `true` (blocks task) instead of proceeding |
| AM-UX-14 | `mapRawMessage` returns empty array for unrecognized message types | Low | **Not Fixed** | `agent-event-mapper.ts:60-63` logs to `console.debug` but still returns empty array with no fallback event |

---

## Detailed Findings

### Fixed (12 of 14)

#### AM-UX-1: Rate-limit loop requeue note -- Fixed

The note at `index.ts:193` now reads: *"Agent hit API rate limits 10+ times and was re-queued with lower concurrency. This usually resolves automatically. If it persists, reduce maxConcurrent in Settings or wait for rate limit cooldown."* This matches the recommendation exactly.

#### AM-UX-2: Steer in SDK mode -- Fixed

`sdk-adapter.ts:72-77` now returns `{ delivered: false, error: 'SDK mode does not support steering' }` instead of the misleading `{ delivered: true }`. The log message is also clearer: `"Steer not supported in SDK mode"`. The UI will now correctly show the steer was not delivered.

#### AM-UX-3: Repo path resolution -- Fixed

`index.ts:427-438` now sets the task to `error` status with the note: `'Repo "${task.repo}" is not configured in BDE settings. Add it in Settings > Repos, then reset this task to queued.'` It also clears `claimed_by: null` and calls `onTaskTerminal`. Users will see the actionable error in the Pipeline view.

#### AM-UX-4: `claimed_by` on watchdog kills -- Fixed

Both `max-runtime` (line 158) and `idle` (line 177) now include `claimed_by: null` in their `updateTaskFn` calls. This prevents orphan recovery from contradicting the error status.

#### AM-UX-5: `emitAgentEvent` SQLite write logging -- Fixed

`agent-event-mapper.ts:80-87` now has rate-limited error logging (at most once per minute via `_lastSqliteErrorLog` timestamp tracking). The log message includes the error details: `"[agent-event-mapper] SQLite write failed (will retry next event): ${err}"`.

#### AM-UX-6: `resolveFailure` DB error handling -- Fixed

`completion.ts:428-431` now returns `isTerminal` (the correct terminal-status value) even when the DB write fails, with a comment: *"Still return correct terminal status even if DB update failed so caller knows to trigger onStatusTerminal callback."* This means the caller in `run-agent.ts` will correctly call `onTaskTerminal` for terminal failures even when the DB update throws.

**Residual concern (low):** If the DB write failed, the task is still in `active` status with `claimed_by` set. The caller now correctly triggers dependency resolution, but the task itself is stuck until orphan recovery picks it up. This is acceptable given orphan recovery runs periodically.

#### AM-UX-8: `killAgent` return type -- Fixed

`index.ts:749-759` now returns `{ killed: boolean; error?: string }`. Missing agents return `{ killed: false, error: 'No active agent for task ${taskId}' }`. Abort failures return `{ killed: false, error: String(err) }`. The interface declaration at line 228 confirms the type signature.

#### AM-UX-9: Worktree error note truncation -- Fixed

`index.ts:459-463` now truncates from the front (keeping the diagnostic tail):
```ts
const notes = fullNote.length > NOTES_MAX_LENGTH
  ? '...' + fullNote.slice(-(NOTES_MAX_LENGTH - 3))
  : fullNote
```
The comment at line 459 confirms intent: *"For git errors, keep the tail of the message (contains key diagnostic info)"*.

#### AM-UX-10: Spawn failure agent event -- Fixed

`run-agent.ts:197-202` now emits an `agent:error` event before updating the task:
```ts
emitAgentEvent(task.id, {
  type: 'agent:error',
  message: `Spawn failed: ${errMsg}`,
  timestamp: Date.now()
})
```
This uses `task.id` as the agent ID so the event correctly associates with the task in the agent console.

#### AM-UX-11: Completion handler agent events -- Fixed

All three early-return paths in `resolveSuccess` now emit `agent:error` events via `broadcast('agent:event', ...)`:
- Worktree eviction: line 246-251 -- message: `"Worktree evicted before completion"`
- Branch detection failure: line 272-277 -- message: `"Failed to detect branch"`
- Empty branch name: line 296-301 -- message: `"Empty branch name"`

#### AM-UX-12: `branch_only` recovery guidance -- Fixed

`completion.ts:390` now includes the manual PR creation command in the notes: `"Branch ${branch} pushed to ${ghRepo} but PR creation failed after ${PR_CREATE_MAX_ATTEMPTS} attempts. To create the PR manually: gh pr create --head ${branch} --repo ${ghRepo}"`.

#### AM-UX-13: Dependency parse failure handling -- Fixed

`index.ts:374-387` now catches parse failures and:
1. Logs at error level: `"Task ${taskId} has malformed depends_on data: ${err}"`
2. Sets task to `error` status with note: `"Malformed depends_on field - cannot validate dependencies"`
3. Clears `claimed_by: null`
4. Returns `true` (blocks task from proceeding)

This is the safer approach -- blocking rather than silently proceeding.

### Not Fixed (2 of 14)

#### AM-UX-7: Dependency index full rebuild on every terminal event -- Not Fixed

**File:** `src/main/services/task-terminal-service.ts:32`

`rebuildIndex()` is still called on every `onStatusTerminal` invocation. No caching, dirty-flag, or incremental update has been implemented.

**Current impact:** Low. The rebuild is O(n) over tasks with dependencies. For the typical BDE user with <200 tasks, this is sub-millisecond. This becomes a concern only at scale (1000+ tasks with many dependency edges), which is unlikely in the near term.

**Recommendation:** Defer unless performance profiling shows this is a bottleneck. If addressed, add a dirty flag that marks the index stale on task create/update and only rebuilds when stale.

#### AM-UX-14: Unrecognized message types return empty array -- Partially Fixed

**File:** `src/main/agent-event-mapper.ts:60-63`

A `console.debug` log was added for unrecognized message types, which is an improvement for debugging. However, no fallback event is emitted -- the agent console still shows gaps when SDK protocol introduces new message types.

```ts
} else if (msgType && msgType !== 'assistant' && msgType !== 'tool_result' && msgType !== 'result') {
  console.debug(`[agent-event-mapper] Unrecognized message type: ${msgType}`)
}
```

**Recommendation:** Emit a generic fallback event for unrecognized types so the agent console timeline stays complete:
```ts
events.push({ type: 'agent:text', text: `[${msgType}]`, timestamp: now })
```

---

## New Findings

### AM-UX-15: `sdk-streaming.ts` timeout throws instead of returning truncated result

- **Severity:** Low
- **File(s):** `src/main/sdk-streaming.ts:74-76`
- **Description:** When the streaming timeout fires, `queryHandle.return()` is called and then the function throws `new Error('SDK streaming timed out...')`. The caller (workbench chat) receives an unhandled error rather than the partial text that was already collected in `fullText`. Users who submit complex prompts that take >180s see an error toast instead of the partial response that was already streaming to them.
- **Recommendation:** Return the partial `fullText` with a `[truncated due to timeout]` suffix instead of throwing, or return a structured result `{ text: fullText, timedOut: boolean }` so the caller can decide how to handle it.

### AM-UX-16: `_mapQueuedTask` logs full task JSON on missing `id` field

- **Severity:** Low
- **File(s):** `src/main/agent-manager/index.ts:318`
- **Description:** When a queued task has no `id` field, the log includes `JSON.stringify(raw)` which may contain the full task spec, prompt, and other large content. This can produce multi-kilobyte log lines that make `agent-manager.log` harder to read.
- **Recommendation:** Log only the keys present: `Object.keys(raw).join(', ')` or truncate the JSON to 200 chars.

---

## Cross-Reference: Synthesis Findings (AM-1 through AM-30)

The synthesis document consolidated the 14 UX findings with Red Team and Reliability findings into AM-1 through AM-30. The UX-relevant items that overlap:

| Synthesis ID | UX Finding | Status |
|---|---|---|
| AM-4 | AM-UX-4 (`claimed_by` on watchdog) | **Fixed** |
| AM-5 | AM-UX-6 (`resolveFailure` DB error) | **Fixed** |
| AM-6 | AM-UX-2 (Steer misleading result) | **Fixed** |
| AM-10 | AM-UX-13 (Dep parse failure bypass) | **Fixed** |
| AM-11 | AM-RED-8 (Agent env inherits full process.env) | **Fixed** -- `env-utils.ts:17-33` now uses an `ENV_ALLOWLIST` |
| AM-20 | AM-REL-16 (`_mapQueuedTask` validation) | **Fixed** -- `index.ts:317-328` validates id, title, repo |
| AM-21 | AM-UX-1 (Rate-limit note) | **Fixed** |
| AM-22 | AM-UX-3 (Repo path feedback) | **Fixed** |
| AM-23 | AM-UX-8 (`killAgent` throws) | **Fixed** |
| AM-24 | AM-UX-10 (Spawn event) | **Fixed** |
| AM-25 | AM-UX-11 (Completion events) | **Fixed** |
| AM-26 | AM-UX-12 (`branch_only` guidance) | **Fixed** |

Additionally notable from the synthesis: **AM-3** (task title sanitization in git commits) is now **Fixed** -- `completion.ts:24-30` defines `sanitizeForGit()` which strips backticks, command substitution, and markdown links. Used at lines 120 and 187. **AM-7** (git push --no-verify) is now **Fixed** -- `completion.ts:358` uses `git push origin branch` without `--no-verify`, so pre-push hooks run.

---

## Overall Assessment

**12 of 14 findings fixed. 2 low-severity items remain open. 2 new low-severity findings identified.**

The Agent Manager's UX feedback loops have been substantially hardened since the v1 audit. All three high-severity findings (AM-UX-2, AM-UX-4, AM-UX-6) are resolved. The most impactful fixes are:

1. **Steer honesty** (AM-UX-2): Users are no longer told steering succeeded when it did not.
2. **Watchdog state consistency** (AM-UX-4): Tasks killed by the watchdog no longer get caught in orphan-recovery loops.
3. **Failure resolution correctness** (AM-UX-6): DB errors during failure resolution no longer silently leave tasks stuck.
4. **Agent console visibility** (AM-UX-10, AM-UX-11): Spawn failures and completion errors now emit events visible in the agent console, closing the "task errored but agent console is blank" gap.
5. **Dependency safety** (AM-UX-13): Malformed dependency data now blocks tasks rather than bypassing checks.

The two remaining open items (dep index rebuild and unrecognized message fallback) are both low-severity with minimal user impact in current usage patterns. The env-utils allowlist fix (AM-11 from synthesis) is a significant security improvement that also happened to resolve UX concerns about credential leakage.

**Remediation quality: Excellent.** Fixes address root causes rather than symptoms, follow consistent patterns, and include defensive coding (e.g., rate-limited logging in emitAgentEvent, tail-truncation for git errors, structured error returns instead of thrown exceptions).
