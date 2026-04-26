## 1. T-131 — operational-checks-service tests

- [x] 1.1 Create `src/main/services/__tests__/operational-checks-service.test.ts` with `vi.mock` stubs for `../credential-store`, `../paths`, `../lib/async-utils`, and `./sprint-service`
- [x] 1.2 Write tests for `validateAuthStatus`: token not found → fail, token expired → fail, expiring within 1h → warn, valid → pass
- [x] 1.3 Write tests for `validateRepoPath`: undefined path → fail, configured path → pass with path value
- [x] 1.4 Write tests for `validateGitCleanStatus`: undefined repoPath → warn (no execFileAsync call), empty stdout → pass, non-empty stdout → warn, execFileAsync throws → warn containing "Unable to check"
- [x] 1.5 Write tests for `validateNoTaskConflicts`: no tasks → pass, active tasks → fail, queued-only → warn, listTasks throws → warn
- [x] 1.6 Write tests for `assessAgentSlotCapacity`: undefined am → warn with zero counts, slots available → pass, all occupied → warn
- [x] 1.7 Write one integration test for `runOperationalChecks` verifying the combined result shape has all five required keys

## 2. T-140 — unit-of-work rollback integration test

- [x] 2.1 Create `src/main/data/__tests__/unit-of-work.test.ts` with in-memory SQLite setup: `new Database(':memory:')`, `runMigrations(db)`, `vi.mock('../../db', async () => ({ ...actual, getDb: () => db }))`
- [x] 2.2 Write commit-path test: insert a row via `runInTransaction`; query for it afterwards; assert one row exists
- [x] 2.3 Write rollback-path test: insert a row via `runInTransaction` that also throws; query afterwards; assert zero rows
- [x] 2.4 Write propagation test: verify the thrown error is re-thrown to the caller (use `expect(...).rejects.toThrow(...)`)

## 3. T-38 — watchdog preserve-guard tests

- [x] 3.1 Append two tests to the `describe('runWatchdog')` block in `src/main/agent-manager/__tests__/watchdog-loop.test.ts`
- [x] 3.2 Write "review status — cleanup skipped": `repo.getTask` returns `{ status: 'review' }`, pass `cleanupAgentWorktree: vi.fn()`, assert it is not called
- [x] 3.3 Write "active status — cleanup invoked": `repo.getTask` returns `{ status: 'active' }`, pass `cleanupAgentWorktree: vi.fn()`, assert it was called with the agent

## 4. Module documentation

- [x] 4.1 Verify `docs/modules/services/index.md` has a row for `operational-checks-service.ts`; add one if missing
- [x] 4.2 Verify `docs/modules/data/index.md` has a row for `unit-of-work.ts`; add one if missing

## 5. Verification

- [x] 5.1 Run `npm run test:main` — all new tests must pass, no regressions
- [x] 5.2 Run `npm run typecheck` — zero errors
- [x] 5.3 Run `npm run lint` — zero errors
