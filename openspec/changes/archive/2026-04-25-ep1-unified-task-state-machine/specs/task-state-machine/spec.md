## ADDED Requirements

### Requirement: Single transition entry point
The system SHALL route all `sprint_tasks.status` writes through `TaskStateService.transition(taskId, target, ctx)`. No module outside `TaskStateService` SHALL write the `status` field of a sprint task directly.

#### Scenario: Valid transition succeeds
- **WHEN** a caller invokes `transition(taskId, 'active', ctx)` and the task exists in a state that permits moving to `active`
- **THEN** the task status is updated to `active`, the audit trail records the change, and any registered side-effects fire in order

#### Scenario: Invalid transition is rejected
- **WHEN** a caller invokes `transition(taskId, 'queued', ctx)` and the task is already in a terminal state (`done`, `cancelled`, `failed`, `error`)
- **THEN** `transition()` throws a `InvalidTransitionError` and no DB write occurs

#### Scenario: Terminal transition dispatches to TerminalDispatcher
- **WHEN** `transition()` writes a terminal status (`done`, `cancelled`, `failed`, `error`)
- **THEN** `TerminalDispatcher.dispatch(taskId, status)` is called exactly once, after the DB write completes

### Requirement: TerminalDispatcher port
The system SHALL define a `TerminalDispatcher` interface with a single `dispatch(taskId, status)` method. Existing terminal implementations (`terminal-handler.ts`, `task-terminal-service.ts`) SHALL implement this interface.

#### Scenario: Agent-manager terminal path uses TerminalDispatcher
- **WHEN** a pipeline agent reaches a terminal state via `terminal-handler.ts`
- **THEN** the terminal handler's `dispatch()` is called by `TaskStateService`, not invoked directly by the agent-manager

#### Scenario: PR-poller terminal path uses TerminalDispatcher
- **WHEN** the sprint PR poller detects a merged or closed PR and calls `onTaskTerminal`
- **THEN** `task-terminal-service.ts`'s `dispatch()` is called by `TaskStateService`

### Requirement: State-machine validation owned by TaskStateService
The system SHALL validate status transitions using `isValidTransition` inside `TaskStateService` before any DB write. The data layer (`sprint-task-crud.ts`) MAY retain a secondary assertion for defense-in-depth but SHALL NOT be the primary enforcement point.

#### Scenario: Data layer assertion fires on bypass attempt
- **WHEN** code bypasses `TaskStateService` and calls `updateTask` with an invalid status transition directly
- **THEN** the data layer assertion throws, preventing the invalid write from persisting
