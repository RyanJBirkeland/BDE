## 1. T-77 — Make acquireLock async (file-lock.ts)

- [x] 1.1 Change `acquireLock` signature to `async function acquireLock(...): Promise<void>` and update the import line to use `import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises'` (alongside the remaining sync imports needed for `releaseLock`'s `rmSync`)
- [x] 1.2 Replace `writeFileSync(lockFile, pid, { flag: 'wx' })` with `await writeFile(lockFile, pid, { flag: 'wx' })`
- [x] 1.3 Replace `readFileSync(lockFile, 'utf-8').trim()` (stale-lock read) with `await readFile(lockFile, 'utf-8')` then `.trim()`
- [x] 1.4 Replace `rmSync(lockFile)` (stale-lock removal) with `await rm(lockFile, { force: true })`
- [x] 1.5 Replace `writeFileSync(tempLockFile, pid)` with `await writeFile(tempLockFile, pid)`
- [x] 1.6 Replace `renameSync(tempLockFile, lockFile)` with `await rename(tempLockFile, lockFile)`; replace the catch-block `rmSync(tempLockFile)` with `await rm(tempLockFile, { force: true })`
- [x] 1.7 Replace the verify-after-rename `readFileSync(lockFile, 'utf-8').trim()` with `await readFile(lockFile, 'utf-8')` then `.trim()`
- [x] 1.8 Update `mkdirSync(locksDir, { recursive: true })` to `await mkdir(locksDir, { recursive: true })` for consistency
- [x] 1.9 Update `setupWorktree` in `worktree.ts` to `await acquireLock(...)` at all call sites (there is one acquisition and one in-catch release path; the release stays sync)
- [x] 1.10 Update `file-lock.test.ts`: change the `vi.mock('node:fs', ...)` mock to instead mock `node:fs/promises`, replacing `readFileSync`/`rmSync` spies with `readFile`/`rm`/`rename`/`writeFile` spies; update all `async/await` test structure accordingly
- [x] 1.11 Add a test asserting `acquireLock` is async (returns a Promise) and that no `*Sync` function is invoked during the stale-lock recovery path

## 2. T-5 — Make pruner readdir async (worktree.ts)

- [x] 2.1 Convert `enumerateRepoCandidates` from a sync generator to `async function enumerateRepoCandidates(repoDir, log): Promise<PruneCandidate[]>` using `await fs.promises.readdir(repoDir, { withFileTypes: true })` instead of `readdirSync`
- [x] 2.2 Convert `enumeratePruneCandidates` from a sync generator to `async function enumeratePruneCandidates(worktreeBase, log): Promise<PruneCandidate[]>` using `await fs.promises.readdir(worktreeBase, { withFileTypes: true })` and calling `await enumerateRepoCandidates(repoDir, log)`; concat results into a flat array
- [x] 2.3 Update `pruneStaleWorktrees` to `const candidates = await enumeratePruneCandidates(...)` and loop over the array (no generator change needed in the caller)
- [x] 2.4 Verify `worktree.test.ts` prune tests still pass without modification (they already `await pruneStaleWorktrees`); add one test asserting that the mock for `readdirSync` is never called when pruning runs (to lock in the async path)

## 3. T-157 — Defer warnPlaintextSensitiveSettings (bootstrap.ts)

- [x] 3.1 Wrap the body of the `for (const key of SENSITIVE_SETTING_KEYS)` loop (and the `stillPlaintext.length > 0` warn block) inside `setImmediate(() => { ... })` so `encryptSetting` is not called on the synchronous call stack
- [x] 3.2 Keep the `isEncryptionAvailable()` guard synchronous (before `setImmediate`) so a no-op fast-path still exists when safeStorage is unavailable
- [x] 3.3 Update `bootstrap.test.ts`: add a test that calls `warnPlaintextSensitiveSettings()` with a plaintext setting and asserts `encryptSetting` has NOT been called immediately after the synchronous return, then advances fake timers / flushes `setImmediate` and asserts `encryptSetting` IS called
- [x] 3.4 Verify the existing `warnPlaintextSensitiveSettings` tests still pass (they call `warnPlaintextSensitiveSettings()` and assert on outcomes — they may need to flush `setImmediate` via `vi.runAllTimers()` or `await new Promise(setImmediate)` before asserting)

## 4. T-59 — Confirm OAuth token caching (oauth-checker.ts / credential-service.ts)

- [x] 4.1 Read `src/main/agent-manager/oauth-checker.ts` and `src/main/services/credential-service.ts` to confirm no `readFileSync` or `*Sync` call exists on the `checkOAuthToken` → `getCredential('claude')` → cache-hit path
- [x] 4.2 Add a unit test in `src/main/__tests__/drain-loop.test.ts` (or a new `oauth-checker.test.ts`) that calls `checkOAuthToken` twice in quick succession, mocking `CredentialService.getCredential` to resolve on first call, and asserts the mock was invoked only once (second call served from cache)

## 5. Verification

- [x] 5.1 Run `npm run typecheck` — zero errors required
- [x] 5.2 Run `npm test` — all renderer/shared tests pass
- [x] 5.3 Run `npm run test:main` — all main-process tests pass
- [x] 5.4 Run `npm run lint` — zero errors
- [x] 5.5 Update `docs/modules/agent-manager/index.md` rows for `file-lock.ts` and `worktree.ts` to note async API; update `docs/modules/services/index.md` if bootstrap.ts row exists
