## Why

Two pipeline agents spawned against the same repo at the same time can both succeed the file-lock acquisition if the PID they found in the lock file died between the `readFileSync` and `renameSync` calls (TOCTOU). A leaked lockfile from a crash strands all future agents against that repo forever. Worktree cleanup failures are silent — no path, no notes, nothing an operator can act on.

## What Changes

- **BREAKING (internal)** File-lock acquisition uses an atomic `O_EXCL` open or a two-phase rename-then-verify pattern that closes the TOCTOU window
- `fetchMain` failure is recorded on the task's `notes` field instead of silently continuing
- Cleanup failures log `worktreePath=<path>` (already done in wave 3 / T-33) — verify coverage is complete
- Lock-release retry: if `renameSync` fails on release (e.g. ENOENT — lock already taken over by another process), log warn + no-throw
- Worktree test fixtures pick one strategy (pure unit mock OR real git integration) per test file — no half-real hybrids

## Capabilities

### New Capabilities

- `atomic-file-lock`: Atomic lock acquisition that closes the TOCTOU race window; retry-safe release; stale-lock detection via `process.kill(pid, 0)`

### Modified Capabilities

<!-- No spec-level behavior changes — same locking semantics, more correct implementation -->

## Impact

- `src/main/agent-manager/file-lock.ts` — atomic acquire, retry release
- `src/main/agent-manager/worktree.ts` — log fetchMain failure to task notes; verify cleanup log coverage
- `src/main/agent-manager/__tests__/worktree.test.ts` — pick one fixture fidelity
