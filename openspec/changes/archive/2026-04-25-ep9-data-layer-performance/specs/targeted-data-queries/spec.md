## ADDED Requirements

### Requirement: No SELECT * in list queries
The system SHALL NOT use `SELECT *` in any query that returns multiple sprint task rows. All multi-row queries SHALL project an explicit column list that excludes `review_diff_snapshot`.

#### Scenario: Renderer poll does not transfer blob
- **WHEN** the renderer polls for tasks via `listTasksRecent`
- **THEN** the `review_diff_snapshot` column is not included in the response payload

#### Scenario: Post-claim reload fetches one row
- **WHEN** the drain loop successfully claims a task
- **THEN** it fetches only that task by primary key, not the full catalog

### Requirement: Incremental dependency refresh
The system SHALL support a dirty-set path in `refreshDependencyIndex` that re-reads only tasks in the provided set rather than scanning the full table.

#### Scenario: Drain loop uses dirty-set refresh
- **WHEN** the drain loop processes N tasks in a tick
- **THEN** the subsequent dep-refresh call re-reads at most N + any fingerprint-changed rows, not all rows
