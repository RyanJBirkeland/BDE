## 1. T-41 — Decouple `notifySprintMutation` from framework transports (P1)

- [x] 1.1 In `src/main/services/sprint-mutation-broadcaster.ts`, add two registration functions: `registerBroadcastCallback(fn: () => void): void` and `registerWebhookCallback(fn: (event: string, task: SprintTask) => void): void`. Store each in a module-level nullable variable (`_onBroadcast`, `_onWebhook`).
- [x] 1.2 Remove the direct call to `scheduleExternalChangeBroadcast()` inside `notifySprintMutation`; replace it with `_onBroadcast?.()`.
- [x] 1.3 Remove the direct call to `webhookService.fireWebhook(...)` inside `notifySprintMutation`; replace it with a guarded `if (_onWebhook) { const eventName = getWebhookEventName(type, task); _onWebhook(eventName, task) }`.
- [x] 1.4 Keep `scheduleExternalChangeBroadcast` as a private function (it is still called by `_onBroadcast` via the callback wired in T-42's composition-root update). Do NOT delete it yet — it is wired in step 1.7.
- [x] 1.5 In `src/main/index.ts`, after the existing `setSprintBroadcaster(...)` call, add `registerWebhookCallback((event, task) => webhookService.fireWebhook(event, task))` where `webhookService` will be the instance created in T-42.
- [x] 1.6 Add unit tests in `src/main/services/__tests__/sprint-mutation-broadcaster.test.ts` for: (a) `notifySprintMutation` calls `_onBroadcast` when registered; (b) `notifySprintMutation` does not throw when no broadcast callback registered; (c) `notifySprintMutation` calls `_onWebhook` when registered; (d) in-process listeners still fire when neither callback is registered.
- [x] 1.7 Run `npm run typecheck && npm test && npm run lint` — all must pass.

## 2. T-42 — Move `webhookService` singleton to composition root (P2, depends on T-41)

- [x] 2.1 In `src/main/services/sprint-mutation-broadcaster.ts`, remove the module-level `const webhookService = createWebhookService(...)` line. Remove the `import { createWebhookService }` and `import { getWebhooks }` lines if they are no longer used in this file.
- [x] 2.2 In `src/main/index.ts` (inside `initCoreServices` or a dedicated `wireSprintBroadcasting` helper), construct `const webhookService = createWebhookService({ getWebhooks, logger })` and pass it to `registerWebhookCallback` (wired in T-41 step 1.5).
- [x] 2.3 Verify `getWebhookEventName` import in `sprint-mutation-broadcaster.ts` is retained — it is still used by the `_onWebhook` callback logic added in T-41.
- [x] 2.4 Run `npm run typecheck && npm test && npm run lint` — all must pass.

## 3. T-39 — Split `buildReviewGitOpPlan` into validator + builder (P2, independent)

- [x] 3.1 In `src/main/services/review-orchestration-service.ts`, extract a private function `validateReviewAction(input)` that performs the switch on `input.action` and returns the narrowed variant (same logic as the current switch-case arms, but returns the raw input fields rather than a `ReviewGitOp`).
- [x] 3.2 Extract a private function `buildGitOpPlan(validated)` that constructs and returns the `ReviewGitOp` from the narrowed input.
- [x] 3.3 Update the exported `buildReviewGitOpPlan` to compose the two: `return buildGitOpPlan(validateReviewAction(input))`. Public signature is unchanged.
- [x] 3.4 Export `validateReviewAction` and `buildGitOpPlan` for testing (named exports, not part of the public service interface).
- [x] 3.5 Add tests in `src/main/services/__tests__/review-orchestration-service.test.ts`: (a) `validateReviewAction` returns correct shape for each action variant; (b) `validateReviewAction` calls the `assertNeverGitOp` path on an unknown action; (c) `buildGitOpPlan` constructs the expected `ReviewGitOp` for each validated variant.
- [x] 3.6 Run `npm run typecheck && npm test && npm run lint` — all must pass.

## 4. T-37 — Constructor-inject repo into `review-orchestration-service.ts` (P2, depends on T-39)

- [x] 4.1 In `src/main/services/review-orchestration-service.ts`, define and export `ReviewOrchestrationService` interface listing all public functions: `mergeLocally`, `createPr`, `requestRevision`, `discard`, `shipIt`, `rebase`, `checkReviewFreshness`, `markShippedOutsideFleet`.
- [x] 4.2 Create and export `createReviewOrchestrationService(repo: ISprintTaskRepository): ReviewOrchestrationService`. All current module-level functions close over `repo` via the factory closure.
- [x] 4.3 Remove `let _repo`, `setReviewOrchestrationRepo`, and `getRepo` from the module. All internal functions that called `getRepo()` now use the `repo` parameter from the factory closure.
- [x] 4.4 Remove the standalone exported function forms (`export async function mergeLocally(...)`, etc.) — they are replaced by the interface returned by the factory.
- [x] 4.5 In `src/main/index.ts`, replace `setReviewOrchestrationRepo(repo)` with `const reviewOrchestration = createReviewOrchestrationService(repo)`. Thread the service object into `AppHandlerDeps` (or the review handler registration site).
- [x] 4.6 Update all handler call sites (in `src/main/handlers/`) that currently call `mergeLocally(...)` etc. as module imports to call them via the injected service object.
- [x] 4.7 Update or add tests in `src/main/services/__tests__/review-orchestration-service.test.ts` to construct the service via `createReviewOrchestrationService(mockRepo)` rather than calling the setter.
- [x] 4.8 Run `npm run typecheck && npm test && npm run lint` — all must pass.

## 5. T-38 — Eliminate `process.env` reads in `review-orchestration-service.ts` (P2, depends on T-37)

- [x] 5.1 Inside the factory returned by `createReviewOrchestrationService` (after T-37), locate the `requestRevision` implementation. It currently passes `process.env` to `runActionPlan`. Change it to pass `ctx.env` (which is already in scope via the `ExecutionContext`).
- [x] 5.2 Locate the `executeRebaseAction` private helper (or its equivalent in the refactored module). It currently passes `process.env` in its `executeReviewAction` call. Change it to pass the `env` argument that is already a parameter of `executeRebaseAction`.
- [x] 5.3 Confirm zero remaining `process.env` references in `review-orchestration-service.ts` (except any at the top-level that may be acceptable, e.g. type imports).
- [x] 5.4 Add tests for `requestRevision` and `executeRebaseAction` that pass a custom `env` object and assert the custom env is forwarded (mock `executeReviewAction` and verify the `env` it received).
- [x] 5.5 Run `npm run typecheck && npm test && npm run lint` — all must pass.

## 6. T-40 — Constructor-inject repo into `review-ship-batch.ts` (P2, depends on T-37)

- [x] 6.1 In `src/main/services/review-ship-batch.ts`, define and export `ReviewShipBatchService` interface with `shipBatch(input: ShipBatchInput): Promise<ShipBatchResult>`.
- [x] 6.2 Create and export `createReviewShipBatchService(repo: ISprintTaskRepository): ReviewShipBatchService`. Move `shipBatch` inside the factory; all internal calls to `getRepo()` use the `repo` closure parameter.
- [x] 6.3 Remove `let _repo`, `setShipBatchRepo`, and `getRepo` from the module.
- [x] 6.4 In `src/main/index.ts`, replace `setShipBatchRepo(repo)` with `const reviewShipBatch = createReviewShipBatchService(repo)`. Thread the service object into `AppHandlerDeps`.
- [x] 6.5 Update handler call sites that currently call `shipBatch(...)` as a module import to call it via the injected service object.
- [x] 6.6 Update or add tests to construct the service via `createReviewShipBatchService(mockRepo)` rather than calling the setter.
- [x] 6.7 Run `npm run typecheck && npm test && npm run lint` — all must pass.

## 7. T-43 — Remove module-scope `_bound` singleton from `sprint-mutations.ts` (P2, depends on T-37)

- [x] 7.1 In `src/main/services/sprint-mutations.ts`, remove `let _bound: SprintMutations | null = null` and the `getBound()` helper.
- [x] 7.2 Change `createSprintMutations(repo)` to return the `SprintMutations` object without writing to any module-level state. The returned object is the sole authority.
- [x] 7.3 Remove all free-function exports (`getTask`, `listTasks`, `createTask`, etc.) that delegated through `getBound()`. Callers must use the object returned by `createSprintMutations`.
- [x] 7.4 In `src/main/index.ts`, update `createSprintMutations(repo)` to capture the return value: `const sprintMutations = createSprintMutations(repo)`. Ensure this object is threaded into every consumer (primarily `sprint-service.ts` wrappers and any handler that called the free-function exports directly).
- [x] 7.5 Update `sprint-service.ts` to accept the `SprintMutations` object as a parameter (or import it from the composition root via a module init function) rather than calling the free-function exports.
- [x] 7.6 Update unit tests for `sprint-mutations.ts` to construct the mutations object directly via `createSprintMutations(mockRepo)` without any setter.
- [x] 7.7 Run `npm run typecheck && npm test && npm run lint` — all must pass.

## 8. T-45 — Delegate worktree cleanup in `retryTask` to `worktree-lifecycle.ts` (P2, depends on T-43)

- [x] 8.1 In `src/main/services/sprint-service.ts`, add `import { pruneWorktrees, deleteBranch } from '../agent-manager/worktree-lifecycle'` and `import { buildAgentEnv } from '../env-utils'`.
- [x] 8.2 In `retryTask`, replace the inline `execFileAsync('git', ['worktree', 'prune'], ...)` call with `await pruneWorktrees(repoPath, buildAgentEnv()).catch(() => { /* best-effort */ })`.
- [x] 8.3 Replace the inline `execFileAsync('git', ['branch', '-D', branch], ...)` calls (inside the branch loop) with `await deleteBranch(repoPath, branch, buildAgentEnv()).catch((err) => { logger.warn(...) })`.
- [x] 8.4 Remove the now-unused `import { execFileAsync } from '../lib/async-utils'` from `sprint-service.ts` if it is no longer needed elsewhere in the file.
- [x] 8.5 Add or update tests for `retryTask` to verify `pruneWorktrees` and `deleteBranch` from `worktree-lifecycle.ts` are called (mock the module), and that errors from those calls are swallowed.
- [x] 8.6 Run `npm run typecheck && npm test && npm run lint` — all must pass.

## 9. T-27 — Encapsulate review-service wiring in `wireReviewServices` (P3, depends on T-37, T-40)

- [x] 9.1 In `src/main/index.ts`, extract a function `wireReviewServices(repo: ISprintTaskRepository)` that calls `createReviewOrchestrationService(repo)` and `createReviewShipBatchService(repo)` and returns both service instances.
- [x] 9.2 In `initCoreServices()`, replace the three-setter block (`setReviewOrchestrationRepo`, `setShipBatchRepo`, `setSprintBroadcaster`) with a call to `wireReviewServices(repo)` (plus the remaining `setSprintBroadcaster` call, which belongs to the broadcaster module pattern from T-41).
- [x] 9.3 Add a JSDoc comment to `wireReviewServices` noting: "Add any new review service wired at startup to this function only."
- [x] 9.4 Run `npm run typecheck && npm test && npm run lint` — all must pass.

## 10. T-44 — Reduce `sprint-service.ts` to type re-exports + broadcaster-wrapped use cases (P2)

- [x] 10.1 Audit all files in `src/main/handlers/` and `src/main/mcp-server/` that `import { X } from '../services/sprint-service'` (or the equivalent relative path). Identify which imports are pure mutations (`getTask`, `listTasks`, `getQueueStats`, etc.) versus broadcaster-wrapped use cases.
- [x] 10.2 For each handler file that imports a pure mutation function, update the import to come from `'../services/sprint-mutations'` (or the `SprintMutations` object injected via deps — whichever pattern is established after T-43).
- [x] 10.3 In `sprint-service.ts`, remove the re-export lines for pure mutation functions that are no longer needed there (i.e. `export const getTask = mutations.getTask`, `export const listTasks = mutations.listTasks`, etc.).
- [x] 10.4 Retain in `sprint-service.ts`: all type re-exports, the broadcaster-wrapped use cases (`createTask`, `updateTask`, `deleteTask`, `releaseTask`, `claimTask`, `forceUpdateTask`, `createReviewTaskFromAdhoc`, `createTaskWithValidation`, `buildClaimedTask`, `forceReleaseClaim`, `retryTask`), and the use-case re-exports from `sprint-use-cases.ts`.
- [x] 10.5 Run `npm run typecheck` — zero errors required (this step is likely to surface import path issues).
- [x] 10.6 Run `npm test && npm run lint` — all must pass.

## 11. T-19 — Extract `CoalescedBroadcaster` class in `broadcast.ts` (P3)

- [x] 11.1 In `src/main/broadcast.ts`, define and export `class CoalescedBroadcaster` with `private readonly pending: Map<string, unknown[]>`, `private flushTimer: ReturnType<typeof setTimeout> | null = null`, a `send<K>(channel: K, payload)` method, and a `private flush()` method (body matching the current `flush()` free function).
- [x] 11.2 Remove the module-level `const _pending` and `let _flushTimer` variables and the module-level `flush()` free function.
- [x] 11.3 Add `const _coalesced = new CoalescedBroadcaster()` as the module-level singleton.
- [x] 11.4 Update the exported `broadcastCoalesced` function to delegate: `_coalesced.send(channel, payload)`.
- [x] 11.5 In `src/main/__tests__/broadcast.test.ts` (create if absent), add tests using a `CoalescedBroadcaster` instance with a mocked `BrowserWindow`: (a) `send()` batches multiple events into a single flush; (b) `send()` on different channels flushes them as separate batch events; (c) the flush timer is set only once when multiple `send()` calls arrive before the timer fires.
- [x] 11.6 Run `npm run typecheck && npm test && npm run lint` — all must pass.

## 12. Documentation and pre-commit checks

- [x] 12.1 Update `docs/modules/services/index.md` for every service file touched (rows for `sprint-mutation-broadcaster.ts`, `sprint-mutations.ts`, `sprint-service.ts`, `review-orchestration-service.ts`, `review-ship-batch.ts`).
- [x] 12.2 Update `docs/modules/lib/main/index.md` for `broadcast.ts` (T-19).
- [x] 12.3 Confirm `npm run typecheck`, `npm test`, and `npm run lint` all pass before final commit.
