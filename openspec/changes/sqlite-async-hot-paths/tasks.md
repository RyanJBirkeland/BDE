## 1. Annotate withRetry for cold-path-only use

- [x] 1.1 In `src/main/data/sqlite-retry.ts`, add a JSDoc comment to `withRetry` that explicitly states it is reserved for cold-path callers (migrations, startup reads) and MUST NOT be called from the agent-manager drain loop, watchdog, completion pipeline, or Sprint PR poller — use `withRetryAsync` instead.

## 2. Migrate sprint-task-crud.ts to withRetryAsync

- [x] 2.1 In `src/main/data/sprint-task-crud.ts`, replace `import { withRetry }` with `import { withRetryAsync }` (keep `withRetry` removed from this file — it uses none of the cold-path pattern).
- [x] 2.2 Change `writeTaskUpdate` to `async function writeTaskUpdate(...)` and replace the `withRetry(...)` call with `await withRetryAsync(...)`. Update the return type to `Promise<SprintTask | null>`.
- [x] 2.3 Change `updateTask` to `async function updateTask(...)` returning `Promise<SprintTask | null>` (it delegates to `writeTaskUpdate`).
- [x] 2.4 Change `forceUpdateTask` to async with the same return type.
- [x] 2.5 Change `createTask` to async returning `Promise<SprintTask | null>` — wrap its `conn.prepare(...).get(...)` body in `withRetryAsync` (a fresh write on a WAL-mode DB can also hit `SQLITE_BUSY` under contention from a concurrent agent writing to the same table).
- [x] 2.6 Change `createReviewTaskFromAdhoc` to async (it calls `createTask` and `updateTask`); add `await` to both calls inside.

## 3. Migrate sprint-queue-ops.ts to withRetryAsync

- [x] 3.1 In `src/main/data/sprint-queue-ops.ts`, add `withRetryAsync` to the import from `./sqlite-retry` and remove `withRetry` from the import.
- [x] 3.2 Change `claimTask` to `async function claimTask(...)` returning `Promise<SprintTask | null>`; replace `withRetry(...)` with `await withRetryAsync(...)`.
- [x] 3.3 Change `releaseTask` to `async function releaseTask(...)` returning `Promise<SprintTask | null>`; wrap the bare `conn.transaction()(...)` body in `await withRetryAsync(...)`.

## 4. Migrate sprint-pr-ops.ts to withRetryAsync

- [x] 4.1 In `src/main/data/sprint-pr-ops.ts`, add `import { withRetryAsync } from './sqlite-retry'`.
- [x] 4.2 Change `markTaskDoneByPrNumber` to async returning `Promise<string[]>`; wrap `conn.transaction()(...)` in `await withRetryAsync(...)`.
- [x] 4.3 Change `markTaskCancelledByPrNumber` to async returning `Promise<string[]>`; same wrapping.
- [x] 4.4 Change `updateTaskMergeableState` to async returning `Promise<void>`; wrap `conn.transaction()(...)` in `await withRetryAsync(...)`.

## 5. Update repository interface signatures

- [x] 5.1 In `src/main/data/sprint-task-repository.ts`, update `IAgentTaskRepository`: `updateTask` → `Promise<SprintTask | null>`, `claimTask` → `Promise<SprintTask | null>`.
- [x] 5.2 Update `IDashboardRepository`: `createTask` → `Promise<SprintTask | null>`, `releaseTask` → `Promise<SprintTask | null>`, `forceUpdateTask` → `Promise<SprintTask | null>`, `createReviewTaskFromAdhoc` → `Promise<SprintTask | null>`.
- [x] 5.3 Update `ISprintPollerRepository`: `markTaskDoneByPrNumber` → `Promise<string[]>`, `markTaskCancelledByPrNumber` → `Promise<string[]>`, `updateTaskMergeableState` → `Promise<void>`.
- [x] 5.4 In `createSprintTaskRepository()`, verify the delegation lambdas still compile (TypeScript will confirm — no logic changes needed since the underlying functions are now async).

## 6. Cascade await in agent-manager call sites

- [x] 6.1 `src/main/agent-manager/task-claimer.ts` — `await` the `repo.claimTask(...)` call.
- [x] 6.2 `src/main/agent-manager/drain-loop.ts` — `await` any `repo.updateTask(...)` or `repo.claimTask(...)` calls; ensure the drain loop function is already `async` (it should be).
- [x] 6.3 `src/main/agent-manager/run-agent.ts` — `await` all `repo.updateTask(...)` calls.
- [x] 6.4 `src/main/agent-manager/resolve-success-phases.ts` — `await` all `repo.updateTask(...)` calls; mark affected functions `async` if not already.
- [x] 6.5 `src/main/agent-manager/resolve-failure-phases.ts` — same treatment.
- [x] 6.6 `src/main/agent-manager/watchdog-loop.ts` — `await` `repo.updateTask(...)` calls.
- [x] 6.7 `src/main/agent-manager/completion.ts` — `await` `repo.updateTask(...)` calls.
- [x] 6.8 `src/main/agent-manager/terminal-handler.ts` — `await` `repo.updateTask(...)` calls.
- [x] 6.9 `src/main/agent-manager/orphan-recovery.ts` — `await` `repo.updateTask(...)` and `repo.releaseTask(...)` calls.
- [x] 6.10 `src/main/agent-manager/shutdown-coordinator.ts` — `await` `repo.releaseTask(...)` or `repo.updateTask(...)` calls.
- [x] 6.11 `src/main/agent-manager/auto-merge-coordinator.ts` — `await` any `repo.updateTask(...)` calls.
- [x] 6.12 `src/main/agent-manager/spawn-and-wire.ts` — `await` any `repo.updateTask(...)` calls.
- [x] 6.13 `src/main/agent-manager/agent-initialization.ts` — `await` any `repo.updateTask(...)` calls.

## 7. Cascade await in Sprint PR poller and other main-process callers

- [x] 7.1 `src/main/sprint-pr-poller.ts` — `await` `repo.markTaskDoneByPrNumber(...)`, `repo.markTaskCancelledByPrNumber(...)`, and `repo.updateTaskMergeableState(...)` calls; ensure the polling callback is `async`.
- [x] 7.2 Check `src/main/services/sprint-service.ts`, `src/main/services/sprint-mutations.ts`, `src/main/services/task-state-service.ts`, `src/main/services/task-terminal-service.ts`, and `src/main/lib/resolve-dependents.ts` for any direct `repo.updateTask(...)`, `repo.createTask(...)`, or `repo.releaseTask(...)` calls; add `await` and mark surrounding functions `async` as needed.
- [x] 7.3 Check `src/main/handlers/sprint-local.ts`, `src/main/handlers/sprint-batch-handlers.ts`, and `src/main/handlers/sprint-retry-handler.ts` for direct repo or sprint-queries calls to the now-async functions; add `await` where needed.

## 8. Update agent-manager test mocks

- [x] 8.1 Audit all `IAgentTaskRepository` mock objects across `src/main/agent-manager/__tests__/` (drain-loop, task-claimer, run-agent, resolve-*-phases, watchdog-loop, completion, orphan-recovery, shutdown-coordinator, spawn-and-wire, auto-merge-coordinator, agent-initialization); update mock method return values for `updateTask`, `claimTask`, `releaseTask` to return `Promise.resolve(...)` instead of bare values.
- [x] 8.2 Update any `ISprintPollerRepository` mocks in `src/main/sprint-pr-poller` test vicinity if they exist.

## 9. Add focused async-path integration tests

- [x] 9.1 Create `src/main/data/__tests__/sqlite-async-hot-paths.test.ts`. Use `better-sqlite3` with an in-memory DB (`:memory:`) and the project's migration runner to set up schema. Verify:
  - `claimTask` returns a `Promise` (check `result instanceof Promise` before resolving).
  - The resolved value is the claimed `SprintTask` with `status === 'active'`.
  - `updateTask` returns a `Promise` that resolves to the patched task.
- [x] 9.2 Add a test that stubs `withRetryAsync` to throw `SQLITE_BUSY` once then succeed, confirming the retry path resolves correctly (spy/mock approach or custom db that throws once).

## 10. Verify and finalise

- [x] 10.1 Run `npm run typecheck` — zero errors required.
- [x] 10.2 Run `npm test` — all tests must pass.
- [x] 10.3 Run `npm run lint` — zero lint errors required (pre-existing errors in unrelated files confirmed unchanged by stash test).
- [x] 10.4 Update `docs/modules/data/index.md` — mark `sprint-task-crud.ts`, `sprint-queue-ops.ts`, `sprint-pr-ops.ts`, and `sprint-task-repository.ts` rows to reflect async signatures.
