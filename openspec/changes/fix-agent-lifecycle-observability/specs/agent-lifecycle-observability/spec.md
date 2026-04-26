## ADDED Requirements

### Requirement: agent.completed event reflects actual task status
After an agent run finishes and `resolveAgentExit` has executed, the system SHALL emit a `logger.event('agent.completed', ...)` whose `status` field contains the task's actual post-resolution status as read from the database, not a hardcoded constant.

#### Scenario: Agent completes successfully and task reaches review
- **WHEN** an agent exits cleanly and `resolveAgentExit` transitions the task to `review`
- **THEN** the `agent.completed` event contains `status: 'review'`

#### Scenario: Agent fast-fails and task is requeued
- **WHEN** an agent exits with a fast-fail and `resolveAgentExit` transitions the task to `queued`
- **THEN** the `agent.completed` event contains `status: 'queued'`

#### Scenario: Agent exhausts fast-fail budget and task is set to error
- **WHEN** an agent exhausts the fast-fail window and `resolveAgentExit` transitions the task to `error`
- **THEN** the `agent.completed` event contains `status: 'error'`

#### Scenario: Task not found in DB after resolution
- **WHEN** `deps.repo.getTask(task.id)` returns null after `resolveAgentExit`
- **THEN** the `agent.completed` event contains `status: 'unknown'`

### Requirement: agent:error abort events include taskId
When the message consumer aborts an agent run due to max-turns exceeded or cost-budget cap, the system SHALL include `taskId` in the emitted `agent:error` event.

#### Scenario: Max-turns abort
- **WHEN** the assistant message count exceeds `maxTurns` and `handle.abort()` is called
- **THEN** the emitted `agent:error` event contains a `taskId` field equal to `task.id`

#### Scenario: Budget-cap abort
- **WHEN** `agent.costUsd` exceeds `agent.maxCostUsd` and `handle.abort()` is called
- **THEN** the emitted `agent:error` event contains a `taskId` field equal to `task.id`

### Requirement: TaskStateService.transition logs every successful status change
On every successful call to `TaskStateService.transition()`, the system SHALL emit one `info`-level log line containing the task ID, the from-status, the to-status, and the caller attribution.

#### Scenario: Normal queued → active transition
- **WHEN** `transition(taskId, 'active', { caller: 'drain-loop' })` succeeds
- **THEN** `bde.log` contains a line matching `[task-state] task <id>: queued → active (caller=drain-loop)`

#### Scenario: Terminal transition to review
- **WHEN** `transition(taskId, 'review', { caller: 'run-agent' })` succeeds
- **THEN** `bde.log` contains a line matching `[task-state] task <id>: active → review (caller=run-agent)`

#### Scenario: Transition throws InvalidTransitionError — no log line
- **WHEN** `transition(taskId, 'done', ...)` is called but the current status does not permit that transition
- **THEN** an `InvalidTransitionError` is thrown and no success log line is emitted

### Requirement: Auto-complete path emits a structured event
When `skipIfAlreadyOnMain` determines that a matching commit exists on `main` and transitions the task to `done`, the system SHALL emit a structured `logger.event('task.auto-complete', ...)` with `taskId`, `sha`, and `matchedOn` fields.

#### Scenario: Commit matched by task ID in branch name
- **WHEN** `taskHasMatchingCommitOnMain` returns a match with `matchedOn: 'branch'`
- **THEN** a `task.auto-complete` event is emitted with `{ taskId, sha, matchedOn: 'branch' }`

#### Scenario: Commit matched by commit message content
- **WHEN** `taskHasMatchingCommitOnMain` returns a match with `matchedOn: 'message'`
- **THEN** a `task.auto-complete` event is emitted with `{ taskId, sha, matchedOn: 'message' }`

#### Scenario: Transition fails — no event emitted
- **WHEN** `taskStateService.transition` throws during the auto-complete flow
- **THEN** no `task.auto-complete` event is emitted and the function returns `false`

### Requirement: Task claim logs a dispatch line before agent spawn
Before calling `deps.spawnAgent(...)` in `processQueuedTask`, the system SHALL emit one `info`-level log line stating the task ID and the worktree path.

#### Scenario: Normal claim and dispatch
- **WHEN** `prepareWorktreeForTask` returns successfully and `spawnAgent` is about to be called
- **THEN** `bde.log` contains a line matching `[agent-manager] Task <id> claimed — spawning agent in <worktreePath>`

#### Scenario: Worktree preparation fails — no dispatch line
- **WHEN** `prepareWorktreeForTask` returns `null`
- **THEN** `processQueuedTask` returns early and no "claimed — spawning" line is emitted
