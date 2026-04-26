## Context

The agent manager lifecycle spans four files: `run-agent.ts` (orchestration), `message-consumer.ts` (SDK stream), `task-state-service.ts` (status transitions), and `task-claimer.ts` (claim + dispatch). Operators debug agent failures by reading `~/.bde/bde.log`, but five structural gaps make log reconstruction unreliable:

1. `agent.completed` always records `status: 'review'` — it was written before `resolveAgentExit` could produce failure/requeue outcomes.
2. Two hard-abort paths in the message consumer (`max_turns_exceeded`, budget cap) emit `agent:error` without `taskId`, breaking any log analysis that joins on task ID.
3. `TaskStateService.transition()` writes to the DB silently — no log line on success — so status timelines cannot be reconstructed without a full DB dump.
4. The auto-complete path in `skipIfAlreadyOnMain` (commit already on main) transitions the task to `done` without a structured event, making it indistinguishable from normal completion in log queries.
5. There is no log line between "task claimed" and "agent spawned" — the window where worktree setup finishes but spawn has not been called.

All five are pure observability additions. No function signatures, return types, or behavioral logic change.

## Goals / Non-Goals

**Goals:**
- `agent.completed` event carries the task's actual post-resolution status from the DB.
- `agent:error` abort events always include `taskId`.
- Every successful `TaskStateService.transition()` call produces an `info`-level log line with from-status, to-status, and caller.
- `skipIfAlreadyOnMain` emits a structured `task.auto-complete` event with SHA and match reason.
- `processQueuedTask` logs a human-readable "claimed — spawning" line immediately before dispatch.

**Non-Goals:**
- No changes to `agent:error` event schema (only adding an already-existing optional field).
- No changes to `resolveAgentExit` return type.
- No new telemetry sinks, metrics, or IPC channels.
- No UI changes.

## Decisions

**D1 — Read final status via `deps.repo.getTask()` after `resolveAgentExit`**

`resolveAgentExit` returns `void` and drives multiple possible transitions (`review`, `queued`, `error`, `failed`). Changing its return type to surface the status would ripple through tests and callers. Reading the task back from the DB after the call is a zero-signature-change approach that is always accurate. The one additional DB read per agent completion is negligible.

Alternative considered: thread the final status through `resolveAgentExit` via an out-param object. Rejected — adds complexity to a call site that is already at the right abstraction level.

**D2 — Log `transition()` success at `info` level, not `debug`**

`info` is the right level for state-machine transitions: they are relatively low-frequency (one per task per stage), always meaningful for debugging, and should appear in the default log view. `debug` would require enabling a separate log level and would be invisible in production `bde.log` by default.

**D3 — Emit `task.auto-complete` as a structured `logger.event(...)` (not `logger.info`)**

`auto-complete` is a business-significant event — it fires when BDE detects that a commit matching the task is already on `main`. It deserves a structured event (key-value payload: `taskId`, `sha`, `matchedOn`) rather than a free-form info string, so it can be reliably parsed by log analysis tools. The existing `logger.event` method is the right vehicle.

**D4 — "Task claimed — spawning" as `logger.info` (not `logger.event`)**

Claim is already a structured DB operation (`claimTask`). The log line here is purely for human operators reading the tail of `bde.log` to know when a task entered the spawn phase. A free-form `info` line suffices; a structured event would be redundant given the DB audit trail.

## Risks / Trade-offs

- **DB read in hot path (T-9)**: `deps.repo.getTask()` is called once per agent completion. This is a SQLite point-read and is negligible relative to the work already done in `resolveAgentExit`. Risk: minimal.
- **`transition()` log volume**: Every status transition now produces a log line. A task passes through ~3–4 statuses in a normal lifecycle; with concurrent agents the log will grow faster. At current concurrency limits (≤3 agents) and rotation at 10MB this is not a concern. Risk: acceptable.
- **`taskId` field on `agent:error`**: Adding an optional field to an existing event type is backward-compatible for all existing consumers. Risk: none.

## Migration Plan

No migration needed. All changes are additive log emissions. Existing `bde.log` files are unaffected. The changes deploy with the next app build.
