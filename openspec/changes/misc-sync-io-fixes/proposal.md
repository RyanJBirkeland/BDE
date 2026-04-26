## Why

Four separate functions in the Electron main thread perform synchronous filesystem or blocking IPC calls on the hot path: the drain loop reads the OAuth token file on every tick, the file-lock module uses `readFileSync`/`writeFileSync`/`renameSync`, the worktree pruner uses `readdirSync`, and `warnPlaintextSensitiveSettings` calls Electron `safeStorage` (IPC to the browser process) in a blocking loop at startup. Sync I/O on the main thread stalls Node's event loop, delays IPC responsiveness, and can produce perceptible hangs in the UI.

## What Changes

- **T-59 — OAuth token re-read on every drain tick**: `validateDrainPreconditions` already delegates to `checkOAuthToken` → `CredentialService`, which has its own 5-min/30-s TTL cache. No additional change needed here beyond verifying the cache is in place. The main-thread concern was resolved in a prior session; this task closes the ticket by confirming the caching path and adding a targeted regression test.
- **T-77 — `acquireLock` sync I/O** (`file-lock.ts`): Replace `writeFileSync`, `readFileSync`, `renameSync`, and `rmSync` inside `acquireLock` with `fs.promises.*` equivalents. The function signature becomes `async`. `releaseLock` keeps sync `rmSync` (best-effort, call-and-forget).
- **T-5 — `pruneStaleWorktrees` sync readdir** (`worktree.ts`): Replace `readdirSync` calls in `enumeratePruneCandidates` and `enumerateRepoCandidates` with `fs.promises.readdir`. Both functions become `async`; `enumeratePruneCandidates` becomes an `async` generator or returns a `Promise<PruneCandidate[]>`.
- **T-157 — `warnPlaintextSensitiveSettings` blocking safeStorage loop** (`bootstrap.ts`): Defer the per-key re-encryption loop to `setImmediate` (or `Promise.resolve().then(...)`) so it runs after the synchronous startup sequence completes. Because there are typically zero or one plaintext keys, the sequential loop itself is fine once it is off the critical path.

## Capabilities

### New Capabilities

- `async-file-lock`: `acquireLock` is now an async function — callers that were previously synchronous must `await` it.

### Modified Capabilities

- None — no spec-level behavior changes; all four items are purely implementation fixes. The observable contract (lock semantics, pruner behavior, credential caching, safeStorage migration) is unchanged.

## Impact

- `src/main/agent-manager/file-lock.ts` — `acquireLock` becomes `async`; all callers in `worktree.ts` must `await`.
- `src/main/agent-manager/worktree.ts` — `enumeratePruneCandidates`/`enumerateRepoCandidates` converted to async; `setupWorktree` already async (no signature change needed).
- `src/main/bootstrap.ts` — `warnPlaintextSensitiveSettings` defers its loop body via `setImmediate`.
- `src/main/agent-manager/__tests__/file-lock.test.ts` — existing tests updated for async; new test confirms async behavior under the stale-lock path.
- `src/main/agent-manager/__tests__/worktree.test.ts` — existing prune tests already use `await pruneStaleWorktrees`; no test-signature changes needed, but a new test confirms async readdir is used.
- `src/main/__tests__/bootstrap.test.ts` — new test asserts `warnPlaintextSensitiveSettings` does not call `encryptSetting` synchronously on the call stack (deferred).
- No new npm dependencies.
