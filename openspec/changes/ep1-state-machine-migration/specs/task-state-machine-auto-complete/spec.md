## ADDED Requirements

### Requirement: State machine permits queued-to-done auto-complete transition
The task state machine SHALL allow a direct `queued → done` transition to support the auto-complete path where the agent-manager detects that matching work already landed on the main branch out-of-band (prior pipeline run, manual commit, cherry-pick). This transition MUST be documented in `VALID_TRANSITIONS` with a comment explaining its semantics so future maintainers do not remove it as an apparent anomaly.

#### Scenario: Queued task transitions to done when already-on-main match is found
- **WHEN** `skipIfAlreadyOnMain` detects a matching commit on the main branch for a queued task
- **THEN** the state machine SHALL accept a `queued → done` transition without error

#### Scenario: Auto-complete transition fires TerminalDispatcher
- **WHEN** a queued task transitions to `done` via the auto-complete path
- **THEN** `TerminalDispatcher.dispatch` SHALL be called with `(taskId, 'done')` so dependency resolution and metrics run as they would for any other terminal status

#### Scenario: Auto-complete audit note identifies the path
- **WHEN** a queued task is auto-completed
- **THEN** the `notes` field written to the DB SHALL contain the matching commit SHA, the field matched on, and the caller attribution `'task-claimer:auto-complete'` so operators can reconstruct what happened from the audit trail alone

### Requirement: All agent-manager status writes route through TaskStateService
The agent-manager SHALL NOT call `repo.updateTask` with a `status` field directly. All status transitions MUST go through `TaskStateService.transition()` so that state-machine validation, the audit trail write, and terminal dispatch are applied uniformly to every lifecycle event.

#### Scenario: resolveFailure requeue path uses TaskStateService
- **WHEN** `resolveFailure` determines the task is non-terminal (retry count below MAX_RETRIES)
- **THEN** the status write to `queued` SHALL be performed via `taskStateService.transition(taskId, 'queued', ...)` rather than `repo.updateTask`

#### Scenario: resolveFailure terminal path uses TaskStateService
- **WHEN** `resolveFailure` determines the task has exhausted retries
- **THEN** the status write to `failed` SHALL be performed via `taskStateService.transition(taskId, 'failed', ...)` rather than `repo.updateTask`

#### Scenario: failTaskExhaustedNoCommits uses TaskStateService
- **WHEN** the no-commits retry cap is hit
- **THEN** the status write to `failed` SHALL be performed via `taskStateService.transition(taskId, 'failed', ...)` rather than `repo.updateTask`

#### Scenario: Acceptance grep returns zero matches
- **WHEN** the implementation is complete
- **THEN** `grep -rn "repo\.updateTask" src/main/agent-manager/ | grep "status"` SHALL return zero lines

### Requirement: resolveFailure is async
`resolveFailure` SHALL be an async function so it can await `TaskStateService.transition()`. All call sites in `agent-manager` SHALL `await` the result.

#### Scenario: Caller awaits resolveFailure
- **WHEN** any agent-manager module calls `resolveFailure`
- **THEN** the call SHALL use `await`, and TypeScript SHALL enforce this via the `Promise<ResolveFailureResult>` return type

#### Scenario: ResolveFailureResult structure is preserved
- **WHEN** `resolveFailure` completes
- **THEN** it SHALL return the same `{ isTerminal, writeFailed?, error? }` shape as before, so all existing callers that check `result.isTerminal` and `result.writeFailed` continue to work without modification
