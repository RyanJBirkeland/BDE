## Why

Three places in `agent-manager` bypass `TaskStateService` with admitted EP-1 deferral comments, meaning status writes (`failed`, `queued`, `done`) skip state-machine validation, miss the audit trail, and do not fire `TerminalDispatcher`. These gaps make the task lifecycle inconsistent and create hidden failure modes where dependency resolution can fire against a task that never actually transitioned.

## What Changes

- **`resolveFailure` in `resolve-failure-phases.ts`** — make the function async and inject `TaskStateService`; replace both `repo.updateTask({status:'queued',...})` (requeue path) and `repo.updateTask({status:'failed',...})` (terminal path) with `taskStateService.transition()` calls.
- **`failTaskExhaustedNoCommits` in `resolve-success-phases.ts`** — inject `TaskStateService` into `CommitCheckContext` (it is already optional there); replace the `repo.updateTask({status:'failed',...})` call with `taskStateService.transition()`.
- **`skipIfAlreadyOnMain` in `task-claimer.ts`** — add a `queued → done` transition to the state machine (named `autoComplete`) and inject `TaskStateService` into `TaskClaimerDeps`; replace the `repo.updateTask({status:'done',...})` call with `taskStateService.transition()`.
- **`task-state-machine.ts`** — add `'done'` to the `queued` adjacency set to permit the new `autoComplete` path.
- Remove all three EP-1 deferral comments once the bypasses are gone.

## Capabilities

### New Capabilities

- `task-state-machine-auto-complete`: The state machine gains a `queued → done` transition for the auto-complete (already-on-main) path, with documented semantics distinguishing it from the normal pipeline completion path.

### Modified Capabilities

- (none — no existing spec-level requirements are changing; this is an implementation-correctness fix that closes a gap in an already-established policy)

## Impact

- `src/shared/task-state-machine.ts` — add `'done'` to `queued` adjacency set.
- `src/main/agent-manager/resolve-failure-phases.ts` — `ResolveFailureContext` gains optional `taskStateService`; `resolveFailure` becomes async.
- `src/main/agent-manager/resolve-success-phases.ts` — `CommitCheckContext.taskStateService` (already optional) starts being populated by all callers; `failTaskExhaustedNoCommits` uses it.
- `src/main/agent-manager/task-claimer.ts` — `TaskClaimerDeps` gains `taskStateService`; `skipIfAlreadyOnMain` uses it.
- All callers of `resolveFailure` must `await` the call after this change (breaking change for call sites).
- Acceptance grep: zero `repo.updateTask` calls with a `status` field remaining in `src/main/agent-manager/`.
