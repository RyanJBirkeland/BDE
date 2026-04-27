## Context

`TaskStateService.transition()` is the designated single gateway for all `sprint_tasks.status` writes. It runs the state-machine check, delegates the DB write (which records the audit trail and fires the file-watcher broadcast), and calls `TerminalDispatcher.dispatch` for every terminal status. Three paths in `agent-manager` were deferred (EP-1) and still call `repo.updateTask({status:...})` directly:

1. **`resolveFailure`** (`resolve-failure-phases.ts:89,100`) — both the requeue path (`queued`) and the terminal path (`failed`) write directly. The function is currently synchronous, which was the stated reason for the deferral.
2. **`failTaskExhaustedNoCommits`** (`resolve-success-phases.ts:502`) — writes `failed` directly. `CommitCheckContext` already has an optional `taskStateService` field but this function doesn't receive the context; it receives individual arguments.
3. **`skipIfAlreadyOnMain`** (`task-claimer.ts:159`) — writes `done` directly because `queued → done` is not a permitted state-machine transition. The comment correctly identifies that either a state-machine relaxation or `forceTerminalOverride` is needed.

`TaskStateService` is already injected into most of the success-phase call chain (e.g., `resolveSuccess`, `failTaskWithError`). The two gaps are `resolveFailure` (separate module, synchronous) and `task-claimer` (no `taskStateService` in `TaskClaimerDeps`).

## Goals / Non-Goals

**Goals:**
- Zero `repo.updateTask` calls with a `status` field remaining in `src/main/agent-manager/` after this change.
- All status writes from agent-manager flow through `TaskStateService.transition()`, gaining audit trail, state-machine validation, and terminal dispatch automatically.
- The `queued → done` auto-complete path is a legitimate, documented state-machine transition — not a bypass.
- `resolveFailure` callers `await` the result; the return type changes from `ResolveFailureResult` to `Promise<ResolveFailureResult>`.

**Non-Goals:**
- Migrating status writes outside `agent-manager` (IPC handlers, PR poller, MCP server) — out of scope for this change.
- Changing `TaskStateService`'s own API or adding new terminal dispatch strategies.
- Removing `forceTerminalOverride` or the operator escape-hatch paths.

## Decisions

### 1. Make `resolveFailure` async instead of extracting a new function

The EP-1 comment cited synchronous signature as the blocker. The simplest fix is to make `resolveFailure` async and inject `taskStateService` as an optional field on `ResolveFailureContext`. All existing callers already `await` the surrounding async call chain, so the async promotion cascades naturally. An alternative would be to split into two functions (sync field-building + async write), but that duplicates the retry-count logic and adds indirection without benefit.

### 2. Add `queued → done` to the state machine with documented `autoComplete` semantics

The `skipIfAlreadyOnMain` path genuinely needs `queued → done` — the work landed on main out-of-band (prior run, manual commit) and FLEET is just reconciling. Using `forceTerminalOverride` is wrong here because that path hard-codes "manually by user" in the audit note, which misleads operators. The clean solution is to permit the transition in the state machine and use `taskStateService.transition()` with a correct `caller` note (`'task-claimer:auto-complete'`). A comment in `VALID_TRANSITIONS` documents why this edge exists.

### 3. Inject `taskStateService` into `TaskClaimerDeps` (required, not optional)

`TaskClaimerDeps` is constructed once at the agent-manager composition root and passed to every drain-loop iteration. Adding `taskStateService` as a required field here (not optional) means the compiler enforces that the composition root wires it up, preventing a silent regression where the bypass silently falls back. The composition root already holds a `TaskStateService` instance.

### 4. Keep `CommitCheckContext.taskStateService` optional, but populate it for `failTaskExhaustedNoCommits`

`CommitCheckContext` already declares `taskStateService?: TaskStateService`. `failTaskExhaustedNoCommits` currently receives individual arguments, not the context struct. The fix is to pass `taskStateService` as an additional argument (keeping the function's small signature) and use it unconditionally — the EP-1 deferral comment says the missing piece was threading `taskStateService` into `CommitCheckContext`, which is already done at the `hasCommitsAheadOfMain` call site. `failTaskExhaustedNoCommits` is called from `hasCommitsAheadOfMain`, which has access to `opts.taskStateService`.

## Risks / Trade-offs

- **`resolveFailure` becoming async is a breaking API change** → All call sites in `agent-manager` already live inside async functions; the only risk is a missed `await` at a new call site. TypeScript will catch this with `@typescript-eslint/no-floating-promises` (already enabled). Mitigation: search for all callers of `resolveFailure` before merging and confirm every call site is `await`-ed.
- **State-machine relaxation (`queued → done`) could be misused** → Any caller can now transition a queued task straight to done without going through the pipeline. The transition table comment documents it as an auto-complete edge; the `TerminalDispatcher` still fires, so audit trail and dependency resolution are preserved. Mitigation: the comment in `VALID_TRANSITIONS` is load-bearing; do not remove it.
- **`taskStateService.transition()` throws `InvalidTransitionError` on invalid moves** → The existing `repo.updateTask` calls do not throw on invalid transitions (the state-machine check lives at the `updateTask` data layer but is enforced differently). Callers must be wrapped in try/catch. All three sites already have try/catch around the DB write, so this is covered.

## Migration Plan

1. Add `'done'` to `queued` adjacency in `task-state-machine.ts`.
2. Add `taskStateService: TaskStateService` to `TaskClaimerDeps`; update `skipIfAlreadyOnMain` to call `taskStateService.transition(task.id, 'done', ...)`.
3. Add optional `taskStateService?: TaskStateService` to `ResolveFailureContext`; make `resolveFailure` async; replace both `repo.updateTask` calls with `taskStateService.transition()` (falling back to `repo.updateTask` only when `taskStateService` is absent, for backward compat during migration).
4. Pass `taskStateService` into `failTaskExhaustedNoCommits` from `hasCommitsAheadOfMain`; replace `repo.updateTask` with `taskStateService.transition()`.
5. Update all `resolveFailure` call sites to `await`.
6. Run acceptance grep: `grep -rn "repo\.updateTask" src/main/agent-manager/ | grep "status"` — expect zero matches.
7. Run `npm run typecheck && npm test && npm run test:main`.

Rollback: The old `repo.updateTask` paths are functionally equivalent for the DB write. If a regression surfaces, reverting the three call sites restores prior behavior; the `queued → done` state-machine edge is additive and safe to leave in place.

## Open Questions

- None. All three bypasses have a clear, agreed path to resolution per the EP-1 deferral comments themselves.
