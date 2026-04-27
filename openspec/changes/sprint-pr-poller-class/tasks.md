## 1. Convert factory to SprintPrPoller class (T-105)

- [x] 1.1 Add `import { createLogger } from './logger'` and declare `const moduleLogger = createLogger('sprint-pr-poller')` at module scope in `sprint-pr-poller.ts`
- [x] 1.2 Declare `SprintPrPoller` class with private instance fields: `timer`, `pollInProgress`, `pendingTerminalRetries`, `initialDelayTimer`, `log`
- [x] 1.3 Move constructor guard (`!deps.onTaskTerminal → throw`) and logger init (`this.log = deps.logger ?? moduleLogger`) into the constructor
- [x] 1.4 Promote `flushPendingRetries`, `enqueueRetry`, `notifyTaskTerminalBatch`, `poll`, and `safePoll` to private class methods
- [x] 1.5 Implement `start()` and `stop()` as public methods (same logic as current factory return object)
- [x] 1.6 Remove `createSprintPrPoller` factory export; export `SprintPrPoller` class instead
- [x] 1.7 Update `src/main/index.ts` call site: `new SprintPrPoller(deps)` in place of `createSprintPrPoller(deps)`

## 2. Surface rejection causes in retry logs (T-106)

- [x] 2.1 Change `attemptTerminalNotifications` return type to `Array<{ id: string; reason: string }>` and populate `reason` from `result.reason` on each rejected outcome (convert to string via `String(result.reason)`)
- [x] 2.2 Update `notifyTaskTerminalBatch` to destructure `{ id, reason }` from the failed array and log `warn('onTaskTerminal failed for ${id}: ${reason}; queued for retry')`
- [x] 2.3 Update `flushPendingRetries` catch block to log `warn('terminal notify retry ${nextAttempts}/${MAX} failed for ${taskId}: ${String(err)}')` instead of only the count

## 3. Add exponential backoff on GitHub 5xx responses (T-107)

- [x] 3.1 Add module-level pure function `isServerError(err: unknown): boolean` that returns true when the error message matches `/5\d\d/` or when a `status` property is in the 500–599 range
- [x] 3.2 Add private instance fields `errorCount = 0` and `nextPollAt = 0` to `SprintPrPoller`
- [x] 3.3 At the top of `safePoll`, add backoff gate: if `Date.now() < this.nextPollAt` log debug and return early
- [x] 3.4 In `safePoll` catch block, add an `else if (isServerError(err))` branch: increment `this.errorCount`, compute `backoffMs = Math.min(POLL_INTERVAL_MS * Math.pow(2, this.errorCount - 1), 300_000)`, set `this.nextPollAt = Date.now() + backoffMs`, log warn with backoff duration
- [x] 3.5 In `safePoll`, after `await` of poll resolves without throwing, reset `this.errorCount = 0; this.nextPollAt = 0`

## 4. Parallelize onTaskTerminal notifications in flushPendingRetries (T-108)

- [x] 4.1 Replace the `for…of await` loop in `flushPendingRetries` with a `Promise.allSettled` fan-out over all current entries, mirroring the shape in `attemptTerminalNotifications`
- [x] 4.2 After `allSettled` resolves, iterate results: delete successful entries, increment attempt counters for failed entries (evict at `MAX_TERMINAL_RETRY_ATTEMPTS`)

## 5. Emit per-cycle outcome event (T-109)

- [x] 5.1 Add `let mergedCount = 0`, `let cancelledCount = 0`, `let unchangedCount = 0` local counters at the top of the result-processing loop in `poll()`
- [x] 5.2 Increment the appropriate counter in each branch (`merged` → `mergedCount++`, `CLOSED` → `cancelledCount++`, neither → `unchangedCount++`)
- [x] 5.3 After the loop, call `this.log.event('pr-poller.tick.complete', { taskCount: tasks.length, merged: mergedCount, cancelled: cancelledCount, unchanged: unchangedCount })`

## 6. Replace console.* fallback logger (T-110)

- [x] 6.1 Verify no `console.log / console.warn / console.error / console.debug` calls remain in `sprint-pr-poller.ts` after the class migration (the module-level `createLogger` instance covers the production path; `deps.logger` covers the test path)

## 7. Tests

- [x] 7.1 Update all `createSprintPrPoller(deps)` call sites in `src/main/__tests__/sprint-pr-poller.test.ts` to `new SprintPrPoller(deps)`
- [x] 7.2 Add test: constructor throws when `onTaskTerminal` is absent
- [x] 7.3 Add test: `start()` + `stop()` lifecycle — timer is cleared, no further polls after stop
- [x] 7.4 Add test: 5xx error sets `errorCount=1` and skips next tick within backoff window
- [x] 7.5 Add test: two consecutive 5xx errors produce `errorCount=2` and a doubled backoff window
- [x] 7.6 Add test: successful poll after 5xx resets `errorCount=0` and `nextPollAt=0`
- [x] 7.7 Add test: non-5xx error does not increment `errorCount`
- [x] 7.8 Add test: `onTaskTerminal` rejection cause string appears in `log.warn` call
- [x] 7.9 Add test: `flushPendingRetries` fans out two entries concurrently (both `onTaskTerminal` calls started before either resolves)
- [x] 7.10 Add test: non-idle cycle with no status changes emits `pr-poller.tick.complete` with `merged=0, cancelled=0`
- [x] 7.11 Add test: cycle with one merge emits `merged=1, unchanged=N-1`

## 8. Pre-commit verification

- [x] 8.1 Run `npm run typecheck` — zero errors required
- [x] 8.2 Run `npm run test:main` — all sprint-pr-poller tests pass
- [x] 8.3 Run `npm test` — renderer suite unaffected
- [x] 8.4 Run `npm run lint` — zero errors
- [x] 8.5 Update `docs/modules/` entry for `sprint-pr-poller.ts` (public API changed: `SprintPrPoller` class replaces `createSprintPrPoller` factory)
