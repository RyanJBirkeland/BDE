## 1. Atomic File-Lock Acquisition

- [x] 1.1 Read `src/main/agent-manager/file-lock.ts` in full before editing
- [x] 1.2 After `renameSync` succeeds in the stale-lock path, re-read the lock file and compare the PID — if mismatch, throw `LockContestedError` (new error class in the same file)
- [x] 1.3 Wrap `releaseLock`'s rename in try/catch — log `logger.warn` on any error (including ENOENT) and return without throwing
- [x] 1.4 Add unit tests: concurrent stale-lock scenario (simulate via mocked fs), non-throwing release on ENOENT

## 2. fetchMain Failure → Task Notes

- [x] 2.1 Read `src/main/agent-manager/worktree.ts` `setupWorktree` function — find the `fetchMain`/`git fetch` call
- [x] 2.2 Wrap the fetch call in try/catch; on failure append `[worktree] fetchMain failed: <stderr>` to the task's `notes` via the existing `updateTask` / notes-append pattern (check how other callers append to notes)
- [x] 2.3 Add a unit test: fetchMain throws → notes updated, setup continues

## 3. Verification

- [x] 3.1 `npm run typecheck` — zero errors
- [x] 3.2 `npx vitest run --config src/main/vitest.main.config.ts` — all pass
- [x] 3.3 `npm run lint` — zero errors
- [x] 3.4 Update `docs/modules/agent-manager/index.md` rows for `file-lock.ts` and `worktree.ts`

> Phase A invariant: this change satisfies the **`setupWorktree` never leaks the lock** invariant in `pipeline-stop-the-bleeding/specs/pipeline-correctness-baseline/spec.md`.
