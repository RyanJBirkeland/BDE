## 1. Drain Tick Deadline (T-1)

- [x] 1.1 Add `DRAIN_TICK_TIMEOUT_MS = 10_000` constant in `drain-loop.ts`
- [x] 1.2 Wrap `repo.getQueuedTasks()` call in `Promise.race([runInNextTick(() => repo.getQueuedTasks()), sleep(DRAIN_TICK_TIMEOUT_MS).then(() => { throw new DrainTimeoutError() })])` — add `runInNextTick` helper and `DrainTimeoutError` class
- [x] 1.3 On `DrainTimeoutError`: log `logger.event('drain.tick.timeout', { tickId })` and return early (skip tick)
- [x] 1.4 Add unit test: mock `getQueuedTasks` that hangs → tick skips, error logged

## 2. Double-Start Guard (T-6)

- [x] 2.1 Add `_started: boolean` flag to `AgentManagerImpl`
- [x] 2.2 In `start()`: if `_started` is true, log WARN and return; otherwise set `_started = true`
- [x] 2.3 In `stop()`: reset `_started = false`
- [x] 2.4 Add unit test: `start(); start()` → one set of timers, one WARN

## 3. Extract WipTracker + ErrorRegistry (T-2)

- [x] 3.1 Extract `WipTracker` class: `claim()`, `release()`, `count`, `isFull(max)` — wraps the active-agent count logic from `AgentManagerImpl`
- [x] 3.2 Extract `ErrorRegistry` class: circuit-breaker state, fast-fail counts, drain-failure counts — wraps the error tracking maps
- [x] 3.3 `AgentManagerImpl` holds instances of both; delegates to them

## 4. Shutdown Coordination (T-34)

- [x] 4.1 `stop()` sets shutdown flag, calls `lifecycleController.stopTimers()`
- [x] 4.2 Add `waitForAgentsToSettle(gracePeriodMs): Promise<void>` — polls `activeAgents.size === 0` up to grace period
- [x] 4.3 After grace period, re-queue remaining `active` tasks (skip `review` tasks)
- [x] 4.4 Add unit test: stop() with active agent → re-queued after grace period

## 5. LifecycleController Timer Stagger (T-83)

- [x] 5.1 Add `initialDelayMs?: number` per-timer option to `startTimers()` in `lifecycle-controller.ts`
- [x] 5.2 Pass staggered delays from `AgentManagerImpl.start()` so drain/watchdog/prune don't all fire at t=0

## 6. run-agent.ts Stepdown Split (T-16)

- [x] 6.1 Read `src/main/agent-manager/run-agent.ts` fully — identify the mixed abstraction levels
- [x] 6.2 Extract `runStreamingPhase(deps): Promise<StreamResult>` 
- [x] 6.3 Extract `runCompletionPhase(deps, streamResult): Promise<void>`
- [x] 6.4 `runAgent` becomes a pure orchestrator calling the two phases
- [x] 6.5 All existing run-agent tests still pass

## 7. Verification

- [x] 7.1 `npm run typecheck` — zero errors
- [x] 7.2 `npx vitest run --config src/main/vitest.main.config.ts` — all pass
- [x] 7.3 `npm run lint` — zero errors
- [x] 7.4 Update `docs/modules/agent-manager/index.md` for all changed files

> Phase A note: scope-coordination with `pipeline-stop-the-bleeding`. This epic owns the drain-loop deadline and `run-agent.ts` split. The Phase A coordination change owns audit task T-21 (drain-loop dep-index dirty-flag preservation) — make sure this epic's drain-loop work does not also touch the `_depIndexDirty` clear path.
