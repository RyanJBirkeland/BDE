## 1. Agent Orchestration Tests

- [x] 1.1 Create `src/main/agent-manager/__tests__/review-transition.test.ts` — mock `captureDiffSnapshot`, `repo`, `taskStateService`, and `logger`; test happy path (calls `repo.updateTask` with `status: 'review'` and `taskStateService.transition`)
- [x] 1.2 Add error-path test to `review-transition.test.ts` — `captureDiffSnapshot` throws; assert `transitionToReview` rejects and `repo.updateTask` is NOT called
- [x] 1.3 Add `repo.updateTask` throws test to `review-transition.test.ts` — assert error propagates (task not silently left claimed)
- [x] 1.4 Create or extend `src/main/agent-manager/__tests__/resolve-failure-phases.test.ts` — test `resolveFailure` happy path: below exhaustion threshold returns `isTerminal: false` and calls `repo.updateTask` with retry status
- [x] 1.5 Add error-path test to `resolve-failure-phases.test.ts` — `repo.updateTask` throws; assert error propagates (or `isTerminal` is NOT returned as true without a DB write)
- [x] 1.6 Add exhaustion test to `resolve-failure-phases.test.ts` — retries exhausted; assert `repo.updateTask` called with `status: 'failed'` and `isTerminal: true`
- [x] 1.7 Add `calculateRetryBackoff` jitter test — run 1000 samples per base delay; assert all results in `[base * 0.8, base * 1.2]` and all results ≤ max cap

## 2. Migration Tests — v046 and v047

- [x] 2.1 Create `src/main/migrations/__tests__/v046.test.ts` — import `up` from `v046-add-task-reviews-table`; assert `task_reviews` table exists with composite PK after `up(db)`
- [x] 2.2 Add index test to `v046.test.ts` — assert `idx_task_reviews_task` exists after `up(db)`
- [x] 2.3 Add idempotency test to `v046.test.ts` — call `up(db)` twice; no throw
- [x] 2.4 Create `src/main/migrations/__tests__/v047.test.ts` — assert `depends_on` column exists on `task_groups` after `up(db)`
- [x] 2.5 Add pre-existing row test to `v047.test.ts` — insert a row before `up`; assert row survives with `depends_on = NULL`
- [x] 2.6 Add idempotency test to `v047.test.ts` — call `up(db)` when column already exists; no throw

## 3. Migration Tests — v050–v053

- [x] 3.1 Create `src/main/migrations/__tests__/v050.test.ts` — assert the `started_at` / `completed_at` composite indices exist after `up(db)` on a minimal `sprint_tasks` table
- [x] 3.2 Add idempotency test to `v050.test.ts`
- [x] 3.3 Create `src/main/migrations/__tests__/v051.test.ts` — assert `idx_sprint_tasks_pr_number_status` (or equivalent) exists after `up(db)`
- [x] 3.4 Add idempotency test to `v051.test.ts`
- [x] 3.5 Create `src/main/migrations/__tests__/v052.test.ts` — assert all indices named in the migration exist after `up(db)`
- [x] 3.6 Add idempotency test to `v052.test.ts`
- [x] 3.7 Verify `src/main/migrations/__tests__/v053.test.ts` covers the case where `orphan_recovery_count` already exists — add that test if missing

## 4. Operational Checks Service Tests

- [x] 4.1 Create `src/main/services/__tests__/operational-checks-service.test.ts` — mock `checkAuthStatus`, `getRepoPath`, `execFileAsync`, and `listTasks` at module level
- [x] 4.2 Add `validateAuthStatus` pass test — mock returns valid token; assert `status: 'pass'`
- [x] 4.3 Add `validateAuthStatus` fail test — mock returns null; assert `status: 'fail'`
- [x] 4.4 Add `validateRepoPath` pass test — mock returns a path string; assert `status: 'pass'`
- [x] 4.5 Add `validateRepoPath` fail test — mock returns null; assert `status: 'fail'`
- [x] 4.6 Add `runOperationalChecks` all-pass test — all mocks return success; assert every check `status` is `'pass'` or `'warn'`
- [x] 4.7 Add `runOperationalChecks` partial-fail test — one mock returns failure; assert overall result reflects the worst status

## 5. Adhoc Promotion Service Tests

- [x] 5.1 Create `src/main/services/__tests__/adhoc-promotion-service.test.ts` — mock `execFileAsync`, `existsSync`, and `createReviewTaskFromAdhoc`
- [x] 5.2 Add happy path test — `execFileAsync` returns a commit hash; `createReviewTaskFromAdhoc` resolves; assert `{ ok: true }` and `createReviewTaskFromAdhoc` called once
- [x] 5.3 Add no-commits test — `execFileAsync` returns empty output; assert `{ ok: false, reason: ... }` and `createReviewTaskFromAdhoc` not called
- [x] 5.4 Add missing-worktree test — agent `worktreePath` is null; assert `{ ok: false, reason: ... }` without calling `createReviewTaskFromAdhoc`
- [x] 5.5 Add `createReviewTaskFromAdhoc` failure test — mock rejects; assert `promoteAdhocAgent` resolves with `{ ok: false }` (no unhandled rejection)
