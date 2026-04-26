## 1. Split completion.ts (T-50)

- [x] 1.1 Create `src/main/agent-manager/success-pipeline.ts` — move `SuccessPhaseContext`, `SuccessPhase`, `PipelineAbortError`, all phase objects, the `successPhases` array, and `resolveSuccess` into this file
- [x] 1.2 Create `src/main/agent-manager/verification-gate.ts` — move `verifyBranchTipOrFail`, `verifyWorktreeOrFail`, and `appendAdvisoryNote` into this file; update internal imports
- [x] 1.3 Create `src/main/agent-manager/pre-review-advisors.ts` — move `PreReviewAdvisor`, `PreReviewAdvisorContext`, `untouchedTestsAdvisor`, `unverifiedFactsAdvisor`, `preReviewAdvisors`, and `runPreReviewAdvisors` into this file; import `appendAdvisoryNote` from `verification-gate.ts`
- [x] 1.4 Rewrite `completion.ts` as a barrel re-export: re-export all public symbols from `success-pipeline.ts`, `pre-review-advisors.ts`, `verification-gate.ts`, plus `deleteAgentBranchBeforeRetry`, `findOrCreatePR`, `resolveFailure`, and the public types; remove all implementation code
- [x] 1.5 Verify `npm run typecheck` passes with zero errors
- [x] 1.6 Update `docs/modules/agent-manager/index.md` — add rows for `success-pipeline.ts`, `pre-review-advisors.ts`, `verification-gate.ts`; update `completion.ts` row to "barrel re-export"

## 2. Inject CircuitObserver port (T-98)

- [x] 2.1 Add `CircuitObserver` interface to `circuit-breaker.ts` — `onCircuitOpen(payload: { consecutiveFailures: number; openUntil: number }): void`
- [x] 2.2 Change the `CircuitBreaker` constructor second parameter from the anonymous callback type to `CircuitObserver | undefined`; rename the stored field from `onCircuitOpen` to `observer`
- [x] 2.3 Update `recordFailure` to call `this.observer?.onCircuitOpen(payload)` instead of `this.onCircuitOpen?.(payload)`
- [x] 2.4 Update `src/main/agent-manager/index.ts` — pass an inline `CircuitObserver` object literal whose `onCircuitOpen` calls `broadcast('agent-manager:circuit-breaker-open', payload)`
- [x] 2.5 Update all existing `CircuitBreaker` unit tests to pass a `CircuitObserver` stub (not a raw callback)
- [x] 2.6 Verify `npm run typecheck` and `npm test` pass

## 3. Promote DrainLoop to a class (T-58)

- [x] 3.1 Add a `DrainLoop` class to `drain-loop.ts` — constructor accepts the read-only collaborators (all current `DrainLoopDeps` fields minus the mutable ones); declare `private drainFailureCounts`, `private drainPausedUntil`, `private lastTaskDeps`, `private recentlyProcessedTaskIds`, `private _isDepIndexDirty` as class fields with safe initial values
- [x] 3.2 Convert `validateDrainPreconditions`, `buildTaskStatusMap`, `drainQueuedTasks`, `runDrain` to methods on `DrainLoop`; replace `deps.xyz` accesses with `this.xyz`; replace `deps.setDepIndexDirty(v)` / `deps.setConcurrency(v)` / `deps.drainPausedUntil = v` with direct `this` field writes
- [x] 3.3 Remove `setDepIndexDirty`, `setConcurrency`, `drainPausedUntil` (mutable), `tickId`, `recentlyProcessedTaskIds`, `lastTaskDeps`, `drainFailureCounts`, and `circuitOpenUntil` from the `DrainLoopDeps` interface
- [x] 3.4 Update `src/main/agent-manager/index.ts` (`AgentManagerImpl`) — construct a `DrainLoop` instance at startup; remove the 4 setter-callback wiring; call `this.drainLoop.runDrain()` in the polling interval
- [x] 3.5 Update drain-loop unit tests — replace `runDrain(deps)` call style with `new DrainLoop(deps).runDrain()`; remove any test setup that wrote to mutable deps fields
- [x] 3.6 Verify `npm run typecheck` and `npm test` pass

## 4. Remove module-scope repo singletons (T-133)

- [x] 4.1 Audit callers of `getSharedSprintTaskRepository` and `setSprintMutationsRepo` across the codebase — list every file that imports them
- [x] 4.2 Convert `sprint-mutations.ts` — replace the module-scope `_repo` + `setSprintMutationsRepo` with a `createSprintMutations(repo: ISprintTaskRepository)` factory that returns an object with all current functions bound to `repo`; remove the free-function exports
- [x] 4.3 Remove `getSharedSprintTaskRepository`, `setSharedSprintTaskRepository`, and `_resetSharedSprintTaskRepository` from `sprint-task-repository.ts`
- [x] 4.4 Update `src/main/index.ts` (composition root) — call `createSprintTaskRepository()` once; call `createSprintMutations(repo)` once; pass the repo instance to `createAgentManager` and any other consumer that previously called `getSharedSprintTaskRepository()`
- [x] 4.5 Update all callers identified in 4.1 — replace `getSharedSprintTaskRepository()` / `setSprintMutationsRepo()` calls with the injected instance
- [x] 4.6 Update unit tests that called `_resetSharedSprintTaskRepository` or `setSprintMutationsRepo` — replace with direct `createSprintTaskRepository()` construction or mock injection
- [x] 4.7 Verify `npm run typecheck` and `npm test` and `npm run test:main` all pass

## 5. Documentation and final checks

- [x] 5.1 Update `docs/modules/services/index.md` — update `sprint-mutations.ts` row to reflect factory export
- [x] 5.2 Update `docs/modules/data/index.md` — update `sprint-task-repository.ts` row to remove singleton exports
- [x] 5.3 Update `CLAUDE.md` `Key File Locations` — point readers to `success-pipeline.ts`, `pre-review-advisors.ts`, `verification-gate.ts` for their respective concerns rather than `completion.ts`
- [x] 5.4 Run full CI suite locally: `npm run typecheck && npm test && npm run test:main && npm run lint` — all must pass
