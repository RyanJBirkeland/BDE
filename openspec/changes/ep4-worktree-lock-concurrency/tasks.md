## 1. Atomic File-Lock Acquisition

- [ ] 1.1 Read `src/main/agent-manager/file-lock.ts` in full before editing
- [ ] 1.2 After `renameSync` succeeds in the stale-lock path, re-read the lock file and compare the PID — if mismatch, throw `LockContestedError` (new error class in the same file)
- [ ] 1.3 Wrap `releaseLock`'s rename in try/catch — log `logger.warn` on any error (including ENOENT) and return without throwing
- [ ] 1.4 Add unit tests: concurrent stale-lock scenario (simulate via mocked fs), non-throwing release on ENOENT

## 2. fetchMain Failure → Task Notes

- [ ] 2.1 Read `src/main/agent-manager/worktree.ts` `setupWorktree` function — find the `fetchMain`/`git fetch` call
- [ ] 2.2 Wrap the fetch call in try/catch; on failure append `[worktree] fetchMain failed: <stderr>` to the task's `notes` via the existing `updateTask` / notes-append pattern (check how other callers append to notes)
- [ ] 2.3 Add a unit test: fetchMain throws → notes updated, setup continues

## 3. Verification

- [ ] 3.1 `npm run typecheck` — zero errors
- [ ] 3.2 `npx vitest run --config src/main/vitest.main.config.ts` — all pass
- [ ] 3.3 `npm run lint` — zero errors
- [ ] 3.4 Update `docs/modules/agent-manager/index.md` rows for `file-lock.ts` and `worktree.ts`
