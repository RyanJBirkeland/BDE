## Context

IPC handlers are supposed to be thin: parse → delegate → return. Three handlers break this contract by embedding business logic directly. The current state per handler:

- **`review:checkFreshness`** — 35 lines inline: git fetch, SHA comparison, `rev-list --count`. No service owns this.
- **`review:markShippedOutsideBde`** — inline status guard (`task.status !== 'review'`) + direct `taskStateService.transition()` call. Review-orchestration-service has no method for this action.
- **`sprint:claimTask`** — inline template lookup: reads `task.templates` setting, finds matching template, merges `promptPrefix` into the returned struct. Sprint-service has a `claimTask(id, claimedBy)` for the agent drain loop but nothing for the renderer-facing claim with template enrichment.
- **`sprint:forceReleaseClaim`** — 20 lines: status guard, optional agent cancellation, `resetTaskForRetry`, `taskStateService.transition`, `notifySprintMutation`, return. All inline.
- **`sprint:retry`** — 55 lines: status guard, repo lookup from settings, git `worktree prune`, branch pattern delete, `resetTaskForRetry`, `updateTask`. Entire body is business logic.

## Goals / Non-Goals

**Goals:**
- Each of the five handlers becomes ≤5 lines (validate → call service → return)
- Business logic lives in a service function with a clear, testable signature
- New service functions are unit-testable without registering IPC handlers
- No behavior change — all observable side effects and return shapes are preserved

**Non-Goals:**
- Refactoring handlers that are already thin (`review:mergeLocally`, `sprint:delete`, `sprint:healthCheck`, etc.)
- Introducing new abstractions or interfaces beyond what the extractions require
- Moving `deps` injection patterns established in Epic 5

## Decisions

### D1 — checkReviewFreshness lives in review-orchestration-service.ts

`review-orchestration-service.ts` already owns the git-aware review actions. Adding `checkReviewFreshness(taskId: string, env: NodeJS.ProcessEnv): Promise<FreshnessResult>` keeps all review git operations in one file. The handler becomes:

```ts
safeHandle('review:checkFreshness', (_e, { taskId }) => {
  if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
  return reviewOrchestration.checkReviewFreshness(taskId, env)
})
```

**Rejected:** a new `review-freshness-service.ts` — unnecessary new file for a single function.

### D2 — markShippedOutsideBde lives in review-orchestration-service.ts

Same reasoning as D1. Signature: `markShippedOutsideBde(taskId: string, deps: { taskStateService: TaskStateService }): Promise<{ success: true }>`. The status guard (`task.status !== 'review'`) is review business policy and belongs here alongside the other review action guards.

### D3 — buildClaimedTask in sprint-service.ts (not claimTask)

`sprint-service.ts` already exports `claimTask(id, claimedBy)` for the agent drain loop. The renderer-facing operation is distinct: it fetches the task and enriches it with a template prefix. Naming it `buildClaimedTask(taskId: string): ClaimedTask | null` avoids collision and accurately describes the operation. No side effects — pure read + enrich.

### D4 — forceReleaseClaim in sprint-service.ts

Signature: `forceReleaseClaim(taskId: string, deps: ForceReleaseClaimDeps): Promise<SprintTask>` where `ForceReleaseClaimDeps = { cancelAgent?: (id: string) => Promise<void>; taskStateService: TaskStateService }`. This mirrors the existing `SprintLocalDeps` subset the handler already receives. The handler passes its `deps` directly.

### D5 — retryTask in sprint-service.ts

Signature: `retryTask(taskId: string): Promise<SprintTask>`. No extra deps — reads repo config from `getSettingJson('repos')` internally, same as the handler does today. Keeps the function self-contained for the simple case of re-queuing a failed task.

### D6 — No new files

All five extracted functions land in existing service files. Adding files for single functions introduces navigation overhead without cohesion benefit.

## Risks / Trade-offs

- **deps threading for forceReleaseClaim**: `cancelAgent` is an optional closure passed from `index.ts` at app start. The handler already holds it via `SprintLocalDeps` — threading it into the service call is straightforward but adds a parameter object. Mitigation: use a named `ForceReleaseClaimDeps` interface, not positional args.
- **sprint-service.ts growth**: Adding three more exports to an already-large barrel. Acceptable — the file is a delegation barrel, not a logic host; actual implementations remain small and focused.
- **Test coverage for retryTask git paths**: The git cleanup is best-effort with caught errors. Tests should cover the happy path and the case where `repoPath` is absent; branch-delete failures are already swallowed and don't need dedicated test paths.

## Migration Plan

Extraction order (each step independently verifiable):

1. `checkReviewFreshness` in review-orchestration-service + thin handler + tests
2. `markShippedOutsideBde` in review-orchestration-service + thin handler + tests
3. `buildClaimedTask` in sprint-service + thin handler + tests
4. `forceReleaseClaim` in sprint-service + thin handler + tests
5. `retryTask` in sprint-service + thin sprint-retry-handler + tests

Each step: extract → test → confirm handler is ≤5 lines → move on. No DB migrations, no IPC surface changes, no new dependencies.
