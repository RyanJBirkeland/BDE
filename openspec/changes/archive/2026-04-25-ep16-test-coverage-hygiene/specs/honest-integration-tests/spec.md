## ADDED Requirements

### Requirement: Concurrent claim race has an honest test
The system SHALL have a test that calls `claimTask` twice for the same task against a real in-memory SQLite database and asserts exactly one call succeeds.

#### Scenario: Only one caller wins the claim
- **WHEN** two callers attempt to claim the same queued task
- **THEN** exactly one returns the claimed task and the other returns null or throws

### Requirement: Orphan recovery round-trip is tested end-to-end
The system SHALL have a test that seeds an active task in a real in-memory SQLite DB, calls `recoverOrphans`, and asserts the task is re-queued with `orphan_recovery_count` incremented.

#### Scenario: Active task without agent is re-queued
- **WHEN** `recoverOrphans` runs with an active task that has no live agent entry
- **THEN** the task status is `queued` and `orphan_recovery_count` is 1

### Requirement: Per-migration tests exist for data-mutating migrations
The system SHALL have a dedicated test for each migration that performs `UPDATE`, `DELETE`, or adds a `CHECK` constraint, verifying the migration handles a partially-applied prior state correctly.

#### Scenario: Migration test covers partial prior state
- **WHEN** a migration test creates a DB at version N-1 and applies migration N
- **THEN** the test asserts the specific schema or data change is applied correctly
