## ADDED Requirements

### Requirement: runInTransaction commits writes when work completes without throwing
The test suite SHALL verify that a write performed inside `runInTransaction` is durably visible after the transaction completes successfully.

#### Scenario: insert inside successful transaction is visible after commit
- **WHEN** `runInTransaction` is called with a `work` function that inserts a row into `sprint_tasks`
- **THEN** after `runInTransaction` returns, querying `sprint_tasks` for that row returns exactly one result

### Requirement: runInTransaction rolls back writes when work throws
The test suite SHALL verify that better-sqlite3's automatic rollback fires when the `work` function throws — leaving the database in the pre-transaction state.

#### Scenario: insert inside throwing transaction is not visible after rollback
- **WHEN** `runInTransaction` is called with a `work` function that inserts a row and then throws
- **THEN** after the call, querying `sprint_tasks` for that row returns zero results

#### Scenario: thrown error propagates to the caller
- **WHEN** `runInTransaction` is called with a `work` function that throws `new Error('simulated failure')`
- **THEN** `runInTransaction` re-throws the same error to its caller
