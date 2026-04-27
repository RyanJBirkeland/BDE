## ADDED Requirements

### Requirement: Orphan recovery cap
The system SHALL track how many times each task has been recovered from orphan status. When a task reaches `MAX_ORPHAN_RECOVERY_COUNT` recoveries, it SHALL be transitioned to `error` status instead of being re-queued.

#### Scenario: Task under cap is re-queued
- **WHEN** a task is found orphaned and its `orphan_recovery_count` is below `MAX_ORPHAN_RECOVERY_COUNT`
- **THEN** `orphan_recovery_count` is incremented and the task is re-queued via `resetTaskForRetry`

#### Scenario: Task at cap is exhausted
- **WHEN** a task is found orphaned and its `orphan_recovery_count` equals `MAX_ORPHAN_RECOVERY_COUNT`
- **THEN** the task is transitioned to `error` with `failure_reason = 'exhausted: orphan recovery cap reached'` and is NOT re-queued

### Requirement: orphan:recovered broadcast
The system SHALL broadcast an `orphan:recovered` IPC event after each recovery run that affected at least one task. The payload SHALL include the IDs of recovered tasks and exhausted tasks separately.

#### Scenario: Recovery broadcast triggers UI banner
- **WHEN** `orphan:recovered` is received in the renderer with non-empty `recovered` or `exhausted` arrays
- **THEN** a dismissible banner appears in the Sprint Pipeline identifying the affected tasks

### Requirement: Enriched recovery log
The system SHALL log `retry_count`, `started_at`, and prior status for each orphaned task at recovery time.

#### Scenario: Recovery log includes task context
- **WHEN** orphan recovery processes a task
- **THEN** the log line includes `taskId`, `priorStatus`, `retryCount`, and `startedAt`
