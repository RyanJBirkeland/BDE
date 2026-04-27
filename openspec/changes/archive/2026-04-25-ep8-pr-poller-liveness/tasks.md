## 1. Timeout + Single-Flight

- [x] 1.1 Read `src/main/sprint-pr-poller.ts` fully
- [x] 1.2 Add `POLL_TIMEOUT_MS = 30_000` and wrap `poll()` call with `Promise.race([poll(), sleep(POLL_TIMEOUT_MS).then(() => { throw new PollTimeoutError() })])`
- [x] 1.3 Add instance-scoped `_pollInProgress` flag in `createSprintPrPoller` closure; skip tick if set
- [x] 1.4 Unit tests: timeout fires → WARN logged; concurrent poll → second tick skipped

## 2. Terminal Notify Retry Queue

- [x] 2.1 Add `pendingTerminalRetries: Map<string, { status, attempts }>` in the poller closure
- [x] 2.2 In `notifyTaskTerminalBatch`: on failure, add to retry map; on success, remove from map
- [x] 2.3 At start of each poll cycle: flush retry queue (attempt each pending retry)
- [x] 2.4 Cap retries at 5; after cap, log ERROR and remove
- [x] 2.5 Unit test: terminal notify fails → queued; succeeds on retry → removed

## 3. Auth/Rate-Limit Warning Toast

- [x] 3.1 In `safePoll` catch: detect auth (401/403) and rate-limit errors by message/status code
- [x] 3.2 On detection: `broadcast('manager:warning', { message: 'GitHub PR poll failed: ...' })`
- [x] 3.3 Unit test: 401 error → broadcast called with warning message

## 4. Legacy Singleton Removal + Heartbeat

- [x] 4.1 Grep callers of `startSprintPrPoller` / `stopSprintPrPoller` — confirm only `index.ts` (already removed)
- [x] 4.2 Update `index.ts` to use `createSprintPrPoller(deps).start()` directly
- [x] 4.3 Remove `startSprintPrPoller`, `stopSprintPrPoller`, `_instance` from `sprint-pr-poller.ts`
- [x] 4.4 Add DEBUG-only heartbeat when no tasks have open PRs: `logger.event('pr-poller.tick.idle', { taskCount: 0 })`

## 5. Verification

- [x] 5.1 `npm run typecheck` zero errors
- [x] 5.2 `npx vitest run --config src/main/vitest.main.config.ts` all pass
- [x] 5.3 `npm run lint` zero errors
- [x] 5.4 Update `docs/modules/` for `sprint-pr-poller.ts`

> Phase A invariant: this change satisfies the **bounded retry queues with structured exhaustion events** invariant in `pipeline-stop-the-bleeding/specs/pipeline-correctness-baseline/spec.md`. Implements `MAX_PENDING_TASKS=500` cap with `terminal-retry.evicted` (oldest entry evicted when cap hit) and `terminal-retry.exhausted` (5-attempt drop) events.
