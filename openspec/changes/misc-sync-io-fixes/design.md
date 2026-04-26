## Context

The Electron main thread runs Node's event loop for all IPC, timer callbacks, and background services. Synchronous filesystem operations (`readFileSync`, `writeFileSync`, `renameSync`, `readdirSync`) and synchronous IPC to Electron's browser process (`safeStorage`) block this loop for the duration of the call, delaying all pending callbacks including renderer IPC. Four independent sites were identified:

1. **`acquireLock`** (`file-lock.ts`) — uses up to five sync fs ops on the stale-lock recovery path. Called from `setupWorktree` which is already async.
2. **`enumeratePruneCandidates` / `enumerateRepoCandidates`** (`worktree.ts`) — use `readdirSync` inside a generator. `pruneStaleWorktrees` is already async.
3. **`warnPlaintextSensitiveSettings`** (`bootstrap.ts`) — iterates `SENSITIVE_SETTING_KEYS` calling `encryptSetting` (→ `safeStorage.encryptString` → browser-process IPC) synchronously during startup, blocking first-render IPC.
4. **`checkOAuthToken`** (`oauth-checker.ts`) / drain loop — previously flagged but already uses a `CredentialService` with 5-min TTL cache. No sync I/O. Ticket closes with a confirming regression test only.

## Goals / Non-Goals

**Goals:**
- Remove all `readFileSync`/`writeFileSync`/`renameSync`/`readdirSync` calls from `acquireLock`, `enumeratePruneCandidates`, and `enumerateRepoCandidates`.
- Defer `warnPlaintextSensitiveSettings`'s re-encryption loop off the synchronous startup path.
- Confirm that `checkOAuthToken` is cache-backed with no sync I/O (test-only verification for T-59).
- Maintain identical observable behavior: lock exclusivity semantics, prune correctness, safeStorage migration completeness.

**Non-Goals:**
- Converting `releaseLock` to async — it is best-effort fire-and-forget; sync `rmSync` there is fine.
- Restructuring the CredentialService cache TTL values.
- Parallelizing the `SENSITIVE_SETTING_KEYS` loop (sequential is correct; we just want it deferred).

## Decisions

### D1 — `acquireLock` becomes `async`; all fs calls replaced with `fs.promises.*`

**Choice**: Convert `acquireLock` to `async function acquireLock(...)` returning `Promise<void>`. Replace:
- `writeFileSync(lockFile, pid, { flag: 'wx' })` → `fs.promises.writeFile(lockFile, pid, { flag: 'wx' })`
- `readFileSync(lockFile, 'utf-8')` → `fs.promises.readFile(lockFile, 'utf-8')`
- `renameSync(tempLockFile, lockFile)` → `fs.promises.rename(tempLockFile, lockFile)`
- `rmSync(lockFile)` / `rmSync(tempLockFile)` → `fs.promises.rm(lockFile, { force: true })`

`mkdirSync` for the `.locks` dir is kept sync — it is a one-time, cheap mkdir that is idempotent and does not appear on the hot path after the first call. Alternatively it can become `fs.promises.mkdir`; we choose async for consistency with the rest of the function.

**Callers**: `setupWorktree` in `worktree.ts` already `await`s the result indirectly through the lock helper. Updating call sites to `await acquireLock(...)` is the only callsite change needed.

**Alternative considered**: Wrapping in `setImmediate` / `util.promisify` shim. Rejected — async native API is cleaner and avoids an extra event-loop bounce for the initial write.

### D2 — `enumeratePruneCandidates` / `enumerateRepoCandidates` converted to async

**Choice**: Convert both generator functions to `async` functions that return `Promise<PruneCandidate[]>`. Generators with `yield*` cannot mix easily with `await` in all TypeScript targets, so an array-returning async function is simpler and equally correct here (the caller iterates a fixed list, not a lazy stream).

`enumeratePruneCandidates` becomes:
```ts
async function enumeratePruneCandidates(worktreeBase, log): Promise<PruneCandidate[]>
```
`enumerateRepoCandidates` becomes:
```ts
async function enumerateRepoCandidates(repoDir, log): Promise<PruneCandidate[]>
```
`pruneStaleWorktrees` loops over the resolved array with `for...of` (already does this pattern for the outer prune).

**Alternative considered**: Async generator (`async function*`). Works but requires the caller to use `for await...of`, which adds complexity for no benefit since the full list is always consumed.

### D3 — `warnPlaintextSensitiveSettings` defers via `setImmediate`

**Choice**: Wrap the re-encryption loop body in `setImmediate(() => { ... })`. This:
- Moves the safeStorage IPC calls off the synchronous `initializeDatabase()` call stack.
- Executes before any timer or I/O callbacks (setImmediate fires at the end of the current event-loop iteration, before `setTimeout` callbacks), so migration completes promptly.
- Keeps the function signature synchronous — callers do not need to `await` it.

**Alternative considered**: `Promise.resolve().then(...)` (microtask). Rejected — microtasks still run before I/O and render callbacks in Node's priority model; `setImmediate` provides a cleaner boundary after the current call stack unwinds.

**Alternative considered**: Moving the call inside `app.whenReady()`. Viable but changes the call site structure, which is a larger diff for a minimal gain over `setImmediate`.

### D4 — T-59 closed with test-only verification

`checkOAuthToken` already delegates to `CredentialService` which caches for 5 min (success) / 30 s (failure). No code change. A unit test asserting `getDefaultCredentialService` is called only once across multiple `checkOAuthToken` invocations confirms the cache is in effect.

## Risks / Trade-offs

- **`acquireLock` callers must await** → If any caller is not already in an async context, it would need wrapping. In this codebase `setupWorktree` is already fully async, so there is no risk.
- **TOCTOU window is unchanged** → The async version preserves the same write-then-rename-then-verify logic. The race window is identical; async does not widen or narrow it.
- **`setImmediate` deferred migration fires after first IPC** → If a renderer IPC call reads an encrypted setting within the same event-loop tick as startup, it may see the pre-migration plaintext. This was already true before (the loop was synchronous but `app.whenReady()` fires in a later tick). No regression.
- **Test mock updates** → `file-lock.test.ts` mocks `readFileSync` / `writeFileSync` to simulate races. These must be updated to mock `fs.promises.readFile` / `fs.promises.writeFile` / `fs.promises.rename`. All existing test scenarios remain expressible.

## Migration Plan

1. Update `acquireLock` → async. Update `setupWorktree` call site to `await`.
2. Update `enumeratePruneCandidates` / `enumerateRepoCandidates` → async array return. Update `pruneStaleWorktrees` loop.
3. Update `warnPlaintextSensitiveSettings` → wrap inner loop in `setImmediate`.
4. Update tests: `file-lock.test.ts` (mock `fs.promises.*`), `bootstrap.test.ts` (assert deferred behavior).
5. Run `npm run typecheck && npm test && npm run test:main && npm run lint`.

No database migrations, no config changes, no API changes. Rollback = revert the four file edits.

## Open Questions

None — all four changes are bounded and low-risk.
