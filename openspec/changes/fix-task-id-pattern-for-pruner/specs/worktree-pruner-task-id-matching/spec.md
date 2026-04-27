## ADDED Requirements

### Requirement: Pruner recognises BDE task IDs as 32-char hex strings
The pruner's candidate guard (`isPrunableCandidate`) SHALL match directory names that are exactly 32 lowercase hexadecimal characters with no dashes, reflecting the `lower(hex(randomblob(16)))` format used to generate `sprint_tasks.id` values. Directory names that do not match this shape MUST be left untouched.

#### Scenario: Real BDE task ID is prunable
- **WHEN** a worktree directory is named with a 32-char hex string (e.g. `00313fab513f1807706c8b7665afc329`)
- **THEN** `isPrunableCandidate` returns true (and the directory is deleted when the task is not active)

#### Scenario: Dashed UUID is not prunable
- **WHEN** a worktree directory is named with the dashed UUID format (e.g. `aaaaaaaa-1111-4111-8111-111111111111`)
- **THEN** `isPrunableCandidate` returns false and the directory is not touched

#### Scenario: Human branch name is not prunable
- **WHEN** a worktree directory is named with a human-readable branch slug (e.g. `fix-some-bug`)
- **THEN** `isPrunableCandidate` returns false and the directory is not touched

#### Scenario: 32-char hex worktree for inactive task is deleted
- **WHEN** a worktree directory has a 32-char hex name, contains a `.git` entry, and the task is not active
- **THEN** `pruneStaleWorktrees` deletes the directory and returns a count of 1 or more

#### Scenario: 32-char hex worktree for active task is preserved
- **WHEN** a worktree directory has a 32-char hex name, contains a `.git` entry, and the task is currently active
- **THEN** `pruneStaleWorktrees` leaves the directory intact

### Requirement: Constant name and documentation accurately describe the task ID format
The module-private constant that holds the task-ID regex SHALL be named `TASK_ID_HEX_PATTERN` and its doc comment SHALL describe the `lower(hex(randomblob(16)))` generation scheme. No code in the module SHALL refer to this format as "UUID" or "UUID-shaped."

#### Scenario: Constant name is searchable and self-describing
- **WHEN** a developer reads the constant declaration
- **THEN** the name `TASK_ID_HEX_PATTERN` and its comment make clear without cross-referencing the DB schema that the expected format is a 32-char hex string with no dashes
