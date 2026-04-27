## 1. SpawnRegistry — new collaborator

- [x] 1.1 Create `src/main/agent-manager/spawn-registry.ts` with `SpawnRegistry` class owning `activeAgents`, `processingTasks`, `agentPromises`, and `pendingSpawns`; implement all verb methods from spec (`registerAgent`, `removeAgent`, `getAgent`, `hasActiveAgent`, `allAgents`, `activeAgentCount`, `markProcessing`, `unmarkProcessing`, `isProcessing`, `trackPromise`, `forgetPromise`, `allPromises`, `incrementPendingSpawns`, `decrementPendingSpawns`, `pendingSpawnCount`); ensure `decrementPendingSpawns` floors at 0
- [x] 1.2 Create `src/main/agent-manager/__tests__/spawn-registry.test.ts` with unit tests covering each verb, the no-negative floor, and read-only iteration

## 2. TerminalGuard — new collaborator

- [x] 2.1 Create `src/main/agent-manager/terminal-guard.ts` with `TerminalGuard` class owning the idempotency Map; implement `guardedCall(taskId, fn): Promise<void>` with deduplication and `finally` cleanup
- [x] 2.2 Create `src/main/agent-manager/__tests__/terminal-guard.test.ts` covering: first-call executes fn, concurrent same-taskId receives same promise, entry deleted after resolution, two independent tasks proceed independently

## 3. ErrorRegistry — add verb methods

- [x] 3.1 Add `incrementFailure(taskId)`, `clearFailure(taskId)`, `failureCountFor(taskId)` methods to `ErrorRegistry` in `error-registry.ts`; make `drainFailureCounts` field `private`
- [x] 3.2 Update `AgentManagerImpl._drainFailureCounts` getter — remove it; update `__testInternals` to expose `errorRegistry.failureCountFor` if tests need the count
- [x] 3.3 Update `DrainLoopDeps` in `drain-loop.ts`: replace `drainFailureCounts: Map<string, number>` with three verb callback fields (`incrementDrainFailure`, `clearDrainFailure`, `drainFailureCountFor`); update all four call sites inside `drain-loop.ts` that mutate/read the map
- [x] 3.4 Update `AgentManagerImpl._drainLoop()` to wire the three verb callbacks from `this._errorRegistry` into `DrainLoopDeps`
- [x] 3.5 Update `__tests__/drain-loop.test.ts` stubs to supply the three verb callbacks instead of `drainFailureCounts: Map`

## 4. Wire SpawnRegistry into AgentManagerImpl

- [x] 4.1 Add `private readonly spawnRegistry: SpawnRegistry` to `AgentManagerImpl`; instantiate in constructor; remove the four raw `_activeAgents`, `_processingTasks`, `_agentPromises`, `_pendingSpawns` fields; update `WipTracker` callback to use `this.spawnRegistry.activeAgentCount()`
- [x] 4.2 Update `runAgentDeps` construction: replace direct Map/Set refs with `spawnRegistry: this.spawnRegistry`
- [x] 4.3 Update `_spawnAgent`: replace direct Map/Set mutations with `spawnRegistry` verb calls (`incrementPendingSpawns`, `trackPromise`, `forgetPromise`)
- [x] 4.4 Update `getStatus()` to iterate via `this.spawnRegistry.allAgents()` instead of `this._activeAgents.values()`

## 5. Wire SpawnRegistry into dependent modules

- [x] 5.1 Update `RunAgentDeps` in `run-agent.ts`: replace `activeAgents: Map<string, ActiveAgent>` with `spawnRegistry: SpawnRegistry`; update all `deps.activeAgents.*` call sites to use verb methods
- [x] 5.2 Update `TaskClaimerDeps` in `task-claimer.ts`: replace `processingTasks: Set<string>` and `activeAgents: Map<string, ActiveAgent>` with `spawnRegistry: SpawnRegistry`; update call sites
- [x] 5.3 Update `WatchdogLoopDeps` in `watchdog-loop.ts`: replace `activeAgents` and `processingTasks` with `spawnRegistry: SpawnRegistry`; update call sites
- [x] 5.4 Update `ShutdownDeps` in `shutdown-coordinator.ts`: replace `activeAgents`, `agentPromises` with `spawnRegistry: SpawnRegistry`; update promise-drain and active-agent iteration to use verb methods
- [x] 5.5 Update `AgentManagerTestInternals` seam: add `activeAgents`, `processingTasks`, `agentPromises`, `pendingSpawns` properties that delegate through `spawnRegistry`; verify all `__tests__/index*.test.ts` use `__testInternals` for these (not `mgr._*` directly)

## 6. Wire TerminalGuard into AgentManagerImpl

- [x] 6.1 Add `private readonly terminalGuard: TerminalGuard` to `AgentManagerImpl`; instantiate in constructor; remove `private readonly _terminalCalled` field
- [x] 6.2 Update `onTaskTerminal` to delegate to `this.terminalGuard.guardedCall(taskId, () => handleTaskTerminal(...))`; remove the inline Map check and `finally` cleanup now handled by `TerminalGuard`
- [x] 6.3 Update `AgentManagerTestInternals` seam: add `terminalGuard: TerminalGuard` property if tests need it

## 7. Decompose _spawnAgent

- [x] 7.1 Extract `private incrementSpawnAccounting(): { decrementPendingOnce: () => void }` — increments metrics counter and calls `spawnRegistry.incrementPendingSpawns()`; returns a guard that calls `spawnRegistry.decrementPendingSpawns()` exactly once
- [x] 7.2 Extract `private recordCircuitBreakerFailure(taskId: string, err: unknown, spawnPhaseReported: boolean): void` — trips circuit breaker only when `!spawnPhaseReported`
- [x] 7.3 Extract `private releaseClaimAsLastResort(taskId: string, err: unknown): void` — status-write attempt with `error` fallback to `claimed_by: null`; mirrors existing try/catch/warn pattern
- [x] 7.4 Rewrite `_spawnAgent` body to orchestrate the four named helpers: `incrementSpawnAccounting` → `dispatchToRunAgent` → `.catch` → `recordCircuitBreakerFailure` + `releaseClaimAsLastResort` → `.finally` → `decrementPendingOnce` + `forgetPromise`

## 8. Serialize startup orphan recovery

- [x] 8.1 Remove the fire-and-forget `kickOffOrphanRecovery()` call in `start()`; update `_scheduleInitialDrain()` to be the single site that runs orphan recovery before the first drain tick; verify the periodic orphan timer in `LifecycleController` continues unchanged
- [x] 8.2 Review `__tests__/index*.test.ts` for any assertions that expect orphan recovery to be called twice on `start()` and update those assertions

## 9. Real private keyword — eliminate _ convention

- [x] 9.1 Convert all remaining `_`-prefixed fields on `AgentManagerImpl` (`_running`, `_shuttingDown`, `_started`, `_concurrency`, `_drainInFlight`, `_lastTaskDeps`, `_depIndexDirty`, `_recentlyProcessedTaskIds`, `_drainPausedUntil`, `_consecutiveDrainErrors`, `_oauthRefreshPromise`) to TypeScript `private`; leave the `__testInternals` getter public
- [x] 9.2 Update `AgentManagerTestInternals` seam to use the now-private fields (the seam class is `friend` by virtue of being passed `this` — TypeScript `private` does not block same-class or seam access when the seam receives the instance); confirm the seam getter/setter pairs compile without errors
- [x] 9.3 Confirm no production code outside `index.ts` and `agent-manager-test-internals.ts` accesses `mgr._*` by running `grep -r '_running\|_shuttingDown\|_started\|_concurrency\|_drainInFlight\|_depIndexDirty\|_consecutiveDrainErrors' src/` and reviewing each hit

## 10. Verification

- [x] 10.1 Run `npm run typecheck` — zero errors required
- [x] 10.2 Run `npm test` — all unit tests pass
- [x] 10.3 Run `npm run test:main` — all main-process integration tests pass
- [x] 10.4 Run `npm run lint` — zero errors
- [x] 10.5 Update `docs/modules/agent-manager/index.md` with rows for `spawn-registry.ts` and `terminal-guard.ts`; update rows for `error-registry.ts` and `index.ts` to reflect changed exports
