## ADDED Requirements

### Requirement: Field-wise task equality in poll merge
The system SHALL compare incoming task data against existing store state using field-wise comparison on a defined set of mutable fields, not JSON serialization. Tasks whose mutable fields are unchanged SHALL NOT trigger a store update.

#### Scenario: Unchanged task skips update
- **WHEN** a poll returns a task whose `status`, `claimed_by`, `completed_at`, `failure_reason`, `pr_status`, `pr_url`, `retry_count`, and `notes` are identical to the current store state
- **THEN** the store does not update that task's reference and dependent React components do not re-render

#### Scenario: Changed status triggers update
- **WHEN** a poll returns a task whose `status` differs from the store
- **THEN** the store updates the task reference and dependent components re-render

### Requirement: Ring-buffer event accumulation
The system SHALL accumulate agent events per agent in a fixed-size ring buffer of `MAX_EVENTS_PER_AGENT` capacity. Pushing a new event SHALL NOT allocate a new array.

#### Scenario: Buffer wraps on overflow
- **WHEN** more than `MAX_EVENTS_PER_AGENT` events are pushed for a single agent
- **THEN** the oldest event is overwritten, the buffer size stays constant, and reading returns events in insertion order

#### Scenario: Buffer capacity matches canonical constant
- **WHEN** `MAX_EVENTS_PER_AGENT` is read from `sprintEvents` store
- **THEN** its value matches the value documented in CLAUDE.md (500)

### Requirement: Stable time reference for task pills
The system SHALL provide a `useNow()` hook that returns the current timestamp updated at a coarse interval (≤ 10 seconds). Task pill components SHALL use `useNow()` instead of calling `Date.now()` directly in render.

#### Scenario: TaskPill does not re-render on parent update when data unchanged
- **WHEN** the parent component re-renders but the task's data has not changed and the coarse time interval has not fired
- **THEN** the TaskPill component does not re-render (React.memo is effective)

### Requirement: Debounced filter chain
The system SHALL debounce search query updates by at least 100ms before triggering task re-partitioning.

#### Scenario: Rapid typing defers re-partition
- **WHEN** a user types 5 characters in rapid succession within 100ms
- **THEN** `partitionSprintTasks()` is called at most twice (once for leading edge if any, once after debounce settles)

### Requirement: IPC poll failure banner
The system SHALL display a visible, dismissible error banner in the Sprint Pipeline view when a task poll IPC call fails. The banner SHALL offer a retry action.

#### Scenario: Poll failure shows banner
- **WHEN** the `sprint:listTasks` IPC call throws or returns an error
- **THEN** a banner appears in the Sprint Pipeline with an error message and a "Retry" button

#### Scenario: Retry clears banner
- **WHEN** the user clicks "Retry" and the subsequent poll succeeds
- **THEN** the error banner is dismissed
