## ADDED Requirements

### Requirement: TOCTOU-safe stale-lock acquisition
The system SHALL close the race window in stale-lock acquisition by verifying lock ownership after the rename claim. If another process wins the race, the acquirer SHALL throw `LockContestedError` rather than silently proceeding with a stolen lock.

#### Scenario: Concurrent stale-lock acquirers — one wins
- **WHEN** two processes simultaneously detect a stale lock and both attempt to claim it via rename
- **THEN** exactly one process reads back its own PID after the rename and proceeds; the other reads a different PID and throws `LockContestedError`

#### Scenario: Normal acquire succeeds without contest
- **WHEN** a process calls `acquireLock` and no other process holds or contests the lock
- **THEN** the lock is acquired and the process proceeds normally

### Requirement: Non-throwing lock release
The system SHALL NOT throw from `releaseLock` under any error condition. If the lock file is missing (`ENOENT`) or otherwise inaccessible, a WARN SHALL be logged and the function SHALL return normally.

#### Scenario: Release on a stolen lock
- **WHEN** `releaseLock` is called but the lock file has been overwritten by another process (ENOENT or PID mismatch)
- **THEN** a WARN is logged with the lock path and the function returns without throwing

### Requirement: fetchMain failure recorded on task notes
The system SHALL append a human-readable failure message to the task's `notes` field when `git fetch origin main` fails during worktree setup. Setup SHALL continue (a stale local main is usable).

#### Scenario: fetchMain fails with stderr
- **WHEN** `git fetch origin main` exits non-zero during `setupWorktree`
- **THEN** `task.notes` contains a line beginning with `[worktree] fetchMain failed:` followed by the stderr output, and worktree setup continues
