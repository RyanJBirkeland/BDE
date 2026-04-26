## Context

`createSprintPrPoller` fires `safePoll()` on a 60s `setInterval`. `safePoll` calls `poll()` which calls `deps.pollPrStatuses(inputs)` — a network call with no timeout. If GitHub is slow, multiple poll cycles can stack. `notifyTaskTerminalBatch` logs a warning on failure but the task's `pr_status` has already been updated by `markTaskDoneByPrNumber`, so the next poll cycle won't include the task — the terminal notification is permanently lost without a retry.

## Goals / Non-Goals

**Goals:**
- 30s per-poll timeout via `Promise.race`
- Single-flight: module-level `_pollInProgress` flag; skip interval tick if already running
- On auth/rate-limit error: `broadcast('manager:warning', { message: '...' })` — triggers in-app toast
- Failed terminal notifies go into `pendingTerminalRetries: Map<taskId, { status, attempts }>` — retried on next successful poll cycle
- Remove `startSprintPrPoller` / `stopSprintPrPoller` legacy singleton
- DEBUG-only `poll:heartbeat` event when no tasks have open PRs

**Non-Goals:**
- Persistent retry queue (across restarts)
- Increasing poll frequency for faster detection

## Decisions

### D1: Single-flight via instance-scoped boolean

```ts
let pollInProgress = false
async function safePoll() {
  if (pollInProgress) { logger.debug('[pr-poller] poll already in progress, skipping'); return }
  pollInProgress = true
  try { await Promise.race([poll(), sleep(POLL_TIMEOUT_MS).then(() => { throw new PollTimeoutError() })]) }
  finally { pollInProgress = false }
}
```

Instance-scoped (not module-global) since the poller is now always created via the DI constructor.

### D2: Retry queue cleared on successful terminal notify

```ts
// On success:
pendingRetries.delete(taskId)
// On failure:
pendingRetries.set(taskId, { status, attempts: (prior?.attempts ?? 0) + 1 })
// Next poll: flush retries first before processing new results
```

Retries capped at 5 attempts. After cap, log ERROR and remove (prevents unbounded growth).

### D3: Legacy singleton removal

`startSprintPrPoller` and `stopSprintPrPoller` in `sprint-pr-poller.ts` are replaced with direct calls to `createSprintPrPoller(deps).start()` in `index.ts`. No callers outside `index.ts` use the singleton.

## Risks / Trade-offs

- **Risk**: Removing the legacy singleton breaks an external caller → Mitigation: grep confirms `startSprintPrPoller` is only called from `index.ts`
- **Trade-off**: In-memory retry queue means retries are lost on crash — acceptable since the next startup's poll will re-detect the merged PR
