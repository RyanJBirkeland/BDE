## Context

`file-lock.ts` acquires a per-repo advisory lock by writing a PID file. The current stale-lock path reads the PID, checks liveness with `process.kill(pid, 0)`, and if stale, renames the lock file to claim it. Between the liveness check and the rename, another process could perform the same sequence and both succeed — a classic TOCTOU race. In practice this is rare (sub-millisecond window) but not impossible under heavy load or process scheduling delays.

The lock release uses `renameSync` to atomically swap in a new file. If the lock was stolen (crash + recovery scenario), the release rename may fail with ENOENT. Currently this throws, which could corrupt the agent's cleanup state.

## Goals / Non-Goals

**Goals:**
- Close the TOCTOU window in stale-lock acquisition
- Make lock release non-throwing on ENOENT (log warn, continue)
- Record `fetchMain` failure text on task notes so agents retry with context
- Validate that every cleanup-failure log path includes `worktreePath`

**Non-Goals:**
- Distributed locking across machines
- Replacing the file-lock with a SQLite mutex (separate concern)
- Changing the lock file location or format

## Decisions

### D1: Close TOCTOU via write-then-verify (no `O_EXCL` on rename)

Node's `fs.renameSync` is atomic at the OS level on POSIX. The race window is between `readFileSync` (check stale) and `renameSync` (claim). Fix: after the rename succeeds, immediately re-read the lock file and verify the PID matches ours. If it doesn't (another process won the race), throw `LockContestedError` and let the caller retry.

```
1. readFileSync → get existing PID
2. process.kill(existingPid, 0) → confirm stale
3. renameSync(tmpLock, lockPath)   ← atomic claim attempt
4. readFileSync(lockPath)          ← verify we won
5. if pid !== ours → throw LockContestedError (rare)
```

_Alternative_: `O_EXCL` flag on `openSync`. More correct but requires writing to a temp path first on every acquire, adding complexity. The verify-after-rename approach reuses existing infrastructure.

### D2: Release is non-throwing

`releaseLock` wraps the rename in a try/catch. `ENOENT` (lock stolen) logs a WARN. Any other error also logs WARN and does not throw — lock release is best-effort; the agent has already finished its work.

### D3: fetchMain failure written to task notes

`setupWorktree` calls `execFileAsync('git', ['fetch', 'origin', 'main'])`. On failure it currently logs a warning and continues. Instead: append `"[worktree] fetchMain failed: <stderr>"` to `task.notes` via the injected `updateTask` callback. Does not abort setup — a stale local main is still usable.

## Risks / Trade-offs

- **Risk**: verify-after-rename adds a second `readFileSync` on every stale-lock path → Mitigation: this path only runs when a stale lock is detected (rare), not on every normal acquire
- **Trade-off**: lock release swallowing ENOENT means a stolen lock is silently "released" from the loser's perspective — acceptable since the winner holds the lock and cleanup still runs
