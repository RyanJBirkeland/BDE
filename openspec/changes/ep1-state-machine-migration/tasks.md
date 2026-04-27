## 1. State Machine — add queued-to-done transition

- [x] 1.1 In `src/shared/task-state-machine.ts`, add `'done'` to the `queued` adjacency set in `VALID_TRANSITIONS`, with a comment documenting it as the auto-complete edge (work landed on main out-of-band)

## 2. TaskClaimerDeps — inject TaskStateService

- [x] 2.1 In `src/main/agent-manager/task-claimer.ts`, add `taskStateService: TaskStateService` as a required field on `TaskClaimerDeps`
- [x] 2.2 Update `skipIfAlreadyOnMain` to call `await taskStateService.transition(task.id, 'done', { fields: { completed_at: nowIso(), claimed_by: null, notes: autoCompleteNote }, caller: 'task-claimer:auto-complete' })` in place of the direct `deps.repo.updateTask` call
- [x] 2.3 Remove the EP-1 deferral comment from `skipIfAlreadyOnMain`
- [x] 2.4 Update the composition root (`src/main/agent-manager/index.ts`) to pass `taskStateService` when constructing the `TaskClaimerDeps` object

## 3. resolveFailure — make async and route through TaskStateService

- [x] 3.1 In `src/main/agent-manager/resolve-failure-phases.ts`, add `taskStateService?: TaskStateService` to `ResolveFailureContext`
- [x] 3.2 Change `resolveFailure` signature to `async function resolveFailure(...): Promise<ResolveFailureResult>`
- [x] 3.3 Replace the non-terminal `repo.updateTask({status:'queued',...})` call with `await taskStateService.transition(taskId, 'queued', { fields: {...}, caller: 'resolve-failure:requeue' })` (falling back to `repo.updateTask` when `taskStateService` absent)
- [x] 3.4 Replace the terminal `repo.updateTask({status:'failed',...})` call with `await taskStateService.transition(taskId, 'failed', { fields: {...}, caller: 'resolve-failure:terminal' })` (same fallback)
- [x] 3.5 Remove the two EP-1 deferral comments from `resolveFailure`
- [x] 3.6 Update all call sites of `resolveFailure` in `agent-manager` to `await` the result (search for `resolveFailure(` across `src/main/agent-manager/`)

## 4. failTaskExhaustedNoCommits — route through TaskStateService

- [x] 4.1 In `src/main/agent-manager/resolve-success-phases.ts`, add `taskStateService?: TaskStateService` as a parameter to `failTaskExhaustedNoCommits` (or thread it via the existing `CommitCheckContext` — whichever the caller path supports; `hasCommitsAheadOfMain` already has `opts.taskStateService`)
- [x] 4.2 Replace the `repo.updateTask({status:'failed',...})` call inside `failTaskExhaustedNoCommits` with `await taskStateService.transition(taskId, 'failed', { fields: {...}, caller: 'resolve-success:no-commits-exhausted' })`
- [x] 4.3 Remove the EP-1 deferral comment from `failTaskExhaustedNoCommits`
- [x] 4.4 Ensure `hasCommitsAheadOfMain` passes `opts.taskStateService` through to `failTaskExhaustedNoCommits`

## 5. Acceptance and verification

- [x] 5.1 Run `grep -rn "repo\.updateTask" src/main/agent-manager/ | grep "status"` — confirm zero matches
- [x] 5.2 Run `npm run typecheck` — zero errors required
- [x] 5.3 Run `npm test` — all tests pass
- [x] 5.4 Run `npm run test:main` — all main-process integration tests pass
- [x] 5.5 Run `npm run lint` — zero errors
- [x] 5.6 Update `docs/modules/agent-manager/index.md` rows for `resolve-failure-phases.ts`, `resolve-success-phases.ts`, and `task-claimer.ts` to reflect the changed signatures and removed bypasses
