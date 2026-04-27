## ADDED Requirements

### Requirement: Migration v046 (task_reviews table) has a dedicated test
`src/main/migrations/__tests__/v046.test.ts` SHALL exist and verify the migration creates the `task_reviews` table and its index.

#### Scenario: Up creates task_reviews table with correct schema
- **WHEN** `up(db)` is called on a fresh in-memory database
- **THEN** the `task_reviews` table exists with columns `task_id`, `commit_sha`, `quality_score`, `issues_count`, `files_count`, `opening_message`, `findings_json`, `raw_response`, `model`, `created_at`, and a composite primary key on `(task_id, commit_sha)`

#### Scenario: Up creates idx_task_reviews_task index
- **WHEN** `up(db)` is called on a fresh in-memory database
- **THEN** the index `idx_task_reviews_task` exists on `task_reviews(task_id)`

#### Scenario: Up is idempotent via IF NOT EXISTS
- **WHEN** `up(db)` is called twice on the same database
- **THEN** no error is thrown and the table exists exactly once

---

### Requirement: Migration v047 (epic depends_on column) has a dedicated test
`src/main/migrations/__tests__/v047.test.ts` SHALL exist and verify the migration adds `depends_on` to `task_groups` without touching pre-existing rows.

#### Scenario: Up adds depends_on column to task_groups
- **WHEN** `up(db)` is called on a database with a `task_groups` table that does not have `depends_on`
- **THEN** the column `depends_on` exists with `DEFAULT NULL`

#### Scenario: Up preserves pre-existing rows
- **WHEN** a row exists in `task_groups` before `up(db)` is called
- **THEN** the row is still present after `up(db)` and its `depends_on` value is `NULL`

#### Scenario: Up is idempotent when column already exists
- **WHEN** `up(db)` is called on a database that already has the `depends_on` column
- **THEN** no error is thrown

---

### Requirement: Migrations v050–v052 (composite indices) each have a dedicated test
`src/main/migrations/__tests__/v050.test.ts`, `v051.test.ts`, and `v052.test.ts` SHALL each exist and verify their respective composite index is created.

#### Scenario: v050 up creates started_at and completed_at indices on sprint_tasks
- **WHEN** `up(db)` is called with a `sprint_tasks` table containing the relevant columns
- **THEN** the expected composite index names exist in `sqlite_master`

#### Scenario: v051 up creates composite index on sprint_tasks(pr_number, status)
- **WHEN** `up(db)` is called with a `sprint_tasks` table containing `pr_number` and `status` columns
- **THEN** the index `idx_sprint_tasks_pr_number_status` (or equivalent) exists

#### Scenario: v052 up creates composite indices on status-timestamp columns for health queries
- **WHEN** `up(db)` is called with the relevant table
- **THEN** all index names specified in the migration exist in `sqlite_master`

#### Scenario: Each index migration is idempotent via IF NOT EXISTS
- **WHEN** `up(db)` is called twice for any of v050–v052
- **THEN** no error is thrown

---

### Requirement: Migration v053 (orphan_recovery_count column) has an idempotency test
`src/main/migrations/__tests__/v053.test.ts` SHALL exist (it does — verify the idempotency case is covered: calling `up` on a DB that already has the column MUST NOT throw).

#### Scenario: v053 up adds orphan_recovery_count column
- **WHEN** `up(db)` is called on a `sprint_tasks` table without `orphan_recovery_count`
- **THEN** the column exists with `DEFAULT 0`

#### Scenario: v053 up is safe when column already exists
- **WHEN** `up(db)` is called on a DB that already has `orphan_recovery_count`
- **THEN** no error is thrown (migration handles the pre-existing-column case gracefully)
