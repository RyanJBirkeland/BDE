## ADDED Requirements

### Requirement: acquireLock is non-blocking
`acquireLock` SHALL be an async function returning `Promise<void>`. It MUST NOT call any synchronous `fs.*Sync` function (`writeFileSync`, `readFileSync`, `renameSync`, `rmSync`) inside its body. All filesystem operations MUST use `fs.promises.*` equivalents.

#### Scenario: Lock acquired on empty lock directory
- **WHEN** no lock file exists for the given repo
- **THEN** `acquireLock` resolves without throwing and a lock file containing the current PID is written

#### Scenario: Lock file already held by alive process
- **WHEN** a lock file exists containing the PID of a running process
- **THEN** `acquireLock` rejects with an error message identifying the holding PID

#### Scenario: Stale lock file from dead process is reclaimed
- **WHEN** a lock file exists containing a PID that is no longer running
- **THEN** `acquireLock` removes the stale file and resolves with the lock claimed by the current process

#### Scenario: Concurrent race loses the rename
- **WHEN** two processes both detect a stale lock and both attempt to rename their temp file
- **THEN** the loser's verify-after-rename detects a different PID and `acquireLock` rejects with `LockContestedError`

### Requirement: pruneStaleWorktrees uses async directory enumeration
`enumeratePruneCandidates` and `enumerateRepoCandidates` SHALL use `fs.promises.readdir` (or equivalent async API). Neither function MUST call `readdirSync`.

#### Scenario: Worktree base with inactive BDE task directories
- **WHEN** `pruneStaleWorktrees` is called and the base directory contains subdirectories with 32-char hex task IDs that have a `.git` entry and are not active
- **THEN** those directories are deleted and the returned count equals the number of inactive BDE task directories

#### Scenario: Error reading a repo subdirectory
- **WHEN** `fs.promises.readdir` throws for a repo subdirectory
- **THEN** a warning is logged and enumeration continues for remaining subdirectories (no throw propagated to caller)

### Requirement: warnPlaintextSensitiveSettings defers safeStorage calls
The re-encryption loop inside `warnPlaintextSensitiveSettings` SHALL be deferred off the synchronous startup call stack using `setImmediate` (or equivalent). The function itself SHALL remain synchronous (return `void`, not `Promise<void>`).

#### Scenario: No sync safeStorage call during initializeDatabase
- **WHEN** `warnPlaintextSensitiveSettings` is invoked during `initializeDatabase`
- **THEN** `encryptSetting` is NOT called synchronously within the same call stack; it is called in a subsequent event-loop tick

#### Scenario: Plaintext settings are still re-encrypted
- **WHEN** a sensitive setting exists without the ENC: prefix
- **THEN** `encryptSetting` is eventually called with the plaintext value and `setSetting` writes the encrypted value

### Requirement: checkOAuthToken does not perform sync I/O
`checkOAuthToken` SHALL resolve its result from an in-memory cache on repeated calls within the cache TTL window. No synchronous filesystem read SHALL occur inside `checkOAuthToken` or its transitive callees on cache-hit paths.

#### Scenario: Multiple drain ticks within cache TTL
- **WHEN** `checkOAuthToken` is called twice within the 5-minute success-cache window
- **THEN** the underlying credential lookup is performed at most once; subsequent calls return the cached result
