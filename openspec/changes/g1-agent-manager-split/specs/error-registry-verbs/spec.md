## ADDED Requirements

### Requirement: ErrorRegistry exposes verb methods for drain-failure accounting
`ErrorRegistry` SHALL expose three verb methods that replace direct external mutation of `drainFailureCounts`: `incrementFailure(taskId: string): void`, `clearFailure(taskId: string): void`, and `failureCountFor(taskId: string): number`. The underlying `drainFailureCounts` Map SHALL be made `private` so no external code can access it as a Map reference.

#### Scenario: incrementFailure increments per-task count
- **WHEN** `errorRegistry.incrementFailure(taskId)` is called
- **THEN** the internal count for `taskId` increases by 1 and `errorRegistry.failureCountFor(taskId)` returns the incremented value

#### Scenario: clearFailure removes the task entry
- **WHEN** `errorRegistry.clearFailure(taskId)` is called
- **THEN** `errorRegistry.failureCountFor(taskId)` returns 0

#### Scenario: failureCountFor returns 0 for unknown task
- **WHEN** `errorRegistry.failureCountFor(taskId)` is called for a task that has never had a failure recorded
- **THEN** it returns 0

#### Scenario: drainFailureCounts is not accessible outside ErrorRegistry
- **WHEN** any module outside `error-registry.ts` needs to read or mutate drain failure counts
- **THEN** it calls `incrementFailure`, `clearFailure`, or `failureCountFor` on the `ErrorRegistry` instance and cannot access `drainFailureCounts` directly

### Requirement: DrainLoopDeps uses verb callbacks instead of a Map reference
`DrainLoopDeps` in `drain-loop.ts` SHALL replace the `drainFailureCounts: Map<string, number>` field with three verb callback fields: `incrementDrainFailure: (taskId: string) => void`, `clearDrainFailure: (taskId: string) => void`, and `drainFailureCountFor: (taskId: string) => number`. All call sites inside `drain-loop.ts` that previously mutated the Map directly SHALL be updated to call the corresponding verb.

#### Scenario: Drain loop increments failure via callback
- **WHEN** a task fails during a drain tick
- **THEN** `deps.incrementDrainFailure(taskId)` is called instead of `deps.drainFailureCounts.set(taskId, count + 1)`

#### Scenario: Drain loop clears failure on success via callback
- **WHEN** a task is successfully processed during a drain tick
- **THEN** `deps.clearDrainFailure(taskId)` is called instead of `deps.drainFailureCounts.delete(taskId)`

#### Scenario: Drain loop reads failure count via callback
- **WHEN** the drain loop evaluates whether to quarantine a task
- **THEN** it reads `deps.drainFailureCountFor(taskId)` instead of `deps.drainFailureCounts.get(taskId) ?? 0`

#### Scenario: AgentManagerImpl wires verb callbacks from ErrorRegistry
- **WHEN** `AgentManagerImpl._drainLoop()` constructs the `DrainLoopDeps` struct
- **THEN** the three verb callbacks are bound to `this._errorRegistry.incrementFailure`, `this._errorRegistry.clearFailure`, and `this._errorRegistry.failureCountFor`

### Requirement: _spawnAgent decomposed into named private helpers
`AgentManagerImpl._spawnAgent` SHALL be decomposed into four named private methods, each with a single responsibility:
- `incrementSpawnAccounting(): { decrementPendingOnce: () => void }` — increments metrics and `pendingSpawns`, returns a guard function that decrements exactly once.
- `dispatchToRunAgent(task, worktree, repoPath, spawnDeps): Promise<void>` — calls `_runAgent` and wires the agent promise into `agentPromises`.
- `recordCircuitBreakerFailure(taskId: string, err: unknown, spawnPhaseReported: boolean): void` — trips the circuit breaker only when the spawn phase never reported an outcome.
- `releaseClaimAsLastResort(taskId: string, err: unknown): void` — attempts to write `status='error'` and then falls back to `claimed_by=null` if the status write is rejected.

#### Scenario: incrementSpawnAccounting returns idempotent decrement guard
- **WHEN** `incrementSpawnAccounting()` is called
- **THEN** the returned `decrementPendingOnce` function decrements `pendingSpawns` on first call and is a no-op on subsequent calls

#### Scenario: recordCircuitBreakerFailure skips post-spawn errors
- **WHEN** `recordCircuitBreakerFailure` is called with `spawnPhaseReported = true`
- **THEN** the circuit breaker is NOT incremented (the failure is a task-level issue, not a systemic spawn failure)

#### Scenario: recordCircuitBreakerFailure trips on pre-spawn errors
- **WHEN** `recordCircuitBreakerFailure` is called with `spawnPhaseReported = false`
- **THEN** the circuit breaker IS incremented

#### Scenario: releaseClaimAsLastResort falls back to claim-only patch
- **WHEN** `releaseClaimAsLastResort` is called and the status-write attempt throws a transition-guard error
- **THEN** it retries with a `claimed_by: null` only patch so the claim is always cleared even when the status cannot be changed
