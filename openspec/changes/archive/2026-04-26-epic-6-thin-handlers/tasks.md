## 1. review:checkFreshness → service

- [x] 1.1 Add `checkReviewFreshness(taskId: string, env: NodeJS.ProcessEnv): Promise<FreshnessResult>` to `src/main/services/review-orchestration-service.ts` — move the git fetch + SHA comparison + `rev-list --count` logic from the handler verbatim; define `FreshnessResult` as `{ status: 'fresh' | 'stale' | 'unknown'; commitsBehind?: number }`
- [x] 1.2 Slim `review:checkFreshness` handler in `src/main/handlers/review.ts` to: validate task ID → `return reviewOrchestration.checkReviewFreshness(taskId, env)` (≤5 lines)
- [x] 1.3 Write unit tests for `checkReviewFreshness` covering: fresh (matching SHA), stale (count > 0), unknown (no `rebase_base_sha`), unknown (git throws)

## 2. review:markShippedOutsideBde → service

- [x] 2.1 Add `markShippedOutsideBde(taskId: string, deps: { taskStateService: TaskStateService }): Promise<{ success: true }>` to `src/main/services/review-orchestration-service.ts` — move the task fetch, status guard, transition call, and log from the handler
- [x] 2.2 Slim `review:markShippedOutsideBde` handler in `src/main/handlers/review.ts` to: validate task ID → `return reviewOrchestration.markShippedOutsideBde(taskId, { taskStateService: deps.taskStateService })` (≤5 lines)
- [x] 2.3 Write unit tests for `markShippedOutsideBde` covering: successful transition from `review` → `done`, throws for non-review task, throws for missing task

## 3. sprint:claimTask → service

- [x] 3.1 Add `buildClaimedTask(taskId: string): ClaimedTask | null` to `src/main/services/sprint-service.ts` — move template lookup (settings read, match by `template_name`, merge `promptPrefix`) from the handler; return `null` when task not found
- [x] 3.2 Slim `sprint:claimTask` handler in `src/main/handlers/sprint-local.ts` to: validate task ID → `return buildClaimedTask(taskId)` (≤5 lines)
- [x] 3.3 Write unit tests for `buildClaimedTask` covering: task with matching template (returns promptPrefix), task with no template_name (returns null prefix), task not found (returns null), templates setting absent (returns null prefix)

## 4. sprint:forceReleaseClaim → service

- [x] 4.1 Define `ForceReleaseClaimDeps = { cancelAgent?: (id: string) => Promise<void>; taskStateService: TaskStateService }` in `src/main/services/sprint-service.ts`
- [x] 4.2 Add `forceReleaseClaim(taskId: string, deps: ForceReleaseClaimDeps): Promise<SprintTask>` to `src/main/services/sprint-service.ts` — move the task fetch, active-status guard, agent cancellation, `resetTaskForRetry`, transition, `notifySprintMutation`, and return from the handler
- [x] 4.3 Slim `sprint:forceReleaseClaim` handler in `src/main/handlers/sprint-local.ts` to: validate task ID → `return forceReleaseClaim(taskId, deps)` (≤5 lines)
- [x] 4.4 Write unit tests for `forceReleaseClaim` covering: active task with cancelAgent (cancel called, task re-queued), active task without cancelAgent (skips cancel), non-active task throws, task not found throws

## 5. sprint:retry → service

- [x] 5.1 Add `retryTask(taskId: string): Promise<SprintTask>` to `src/main/services/sprint-service.ts` — move status guard, repo/path lookup from settings, git `worktree prune`, branch-pattern deletion (best-effort), `resetTaskForRetry`, `updateTask` transition to queued from `sprint-retry-handler.ts`
- [x] 5.2 Slim `sprint:retry` handler in `src/main/handlers/sprint-retry-handler.ts` to: validate task ID → `return retryTask(taskId)` (≤5 lines)
- [x] 5.3 Write unit tests for `retryTask` covering: failed task re-queues successfully, error/cancelled tasks re-queue, non-terminal task throws, git cleanup failure does not block retry, missing repo path skips git cleanup

## 6. Verification

- [x] 6.1 Run `npm run typecheck` — zero errors
- [x] 6.2 Run `npm test` — all tests pass
- [x] 6.3 Run `npm run lint` — zero errors
- [x] 6.4 Update `docs/modules/handlers/index.md` for review.ts and sprint-local.ts rows; update `docs/modules/services/index.md` for review-orchestration-service.ts and sprint-service.ts rows
