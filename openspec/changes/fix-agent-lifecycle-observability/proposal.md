## Why

Five logging gaps in the agent lifecycle make it impossible to reconstruct what happened to a task from `bde.log` alone: the `agent.completed` event always claims `status: 'review'` regardless of actual outcome, two hard-abort paths omit `taskId` from their `agent:error` events, every status transition is silent on success, and there is no structured record of task claim or auto-complete.

## What Changes

- **`run-agent.ts`**: Read the task's actual status from the DB after `resolveAgentExit` returns and emit it in `logger.event('agent.completed', { status: <actual> })` instead of the hardcoded `'review'`.
- **`message-consumer.ts`**: Add `taskId: task.id` to the `agent:error` event emitted on max-turns exceeded and on budget-cap abort.
- **`task-state-service.ts`**: After `updateTask` succeeds in `transition()`, emit one `this.logger.info(...)` line: `[task-state] task <id>: <from> → <to> (caller=<caller>)`.
- **`task-claimer.ts` (auto-complete path)**: After `taskStateService.transition` succeeds in `skipIfAlreadyOnMain`, emit `logger.event('task.auto-complete', { taskId, sha, matchedOn })`.
- **`task-claimer.ts` (dispatch path)**: Before `deps.spawnAgent(...)` in `processQueuedTask`, log `[agent-manager] Task <id> claimed — spawning agent in <worktreePath>`.

All changes are observability-only. No function signatures change. No behavioral changes.

## Capabilities

### New Capabilities

- `agent-lifecycle-observability`: Accurate structured log events for agent completion status, abort-event routing, status transitions, auto-complete, and task claim.

### Modified Capabilities

<!-- None — these are new log emissions, not changes to existing specified behavior. -->

## Impact

- **`src/main/agent-manager/run-agent.ts`** — one DB read added after `resolveAgentExit`; `logger.event` payload corrected.
- **`src/main/agent-manager/message-consumer.ts`** — two `emitAgentEvent` call-sites gain `taskId` field.
- **`src/main/services/task-state-service.ts`** — one `logger.info` added to `transition()`.
- **`src/main/agent-manager/task-claimer.ts`** — one `logger.event` and one `logger.info` added.
- No new npm dependencies. No IPC surface changes. No UI changes.
