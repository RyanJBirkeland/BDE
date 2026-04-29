## 1. validateRepoPath tests (T-49 · P1)

- [x] 1.1 Create `src/main/__tests__/validation.test.ts` — add `vi.mock('../settings', () => ({ getRepoPaths: vi.fn() }))` and import `validateRepoPath` from `../validation`; set up `beforeEach` to configure `vi.mocked(getRepoPaths).mockReturnValue({ fleet: '/projects/fleet' })`
- [x] 1.2 Add test: exact match `/projects/fleet` → returns the resolved path without throwing
- [x] 1.3 Add test: valid child `/projects/fleet/src/index.ts` → returns resolved path without throwing
- [x] 1.4 Add test: `../` traversal `../../etc/passwd` (resolved from working dir) → throws with label in message
- [x] 1.5 Add test: prefix-match-but-not-child `/projects/fleetother/file.ts` → throws (must not match root `/projects/fleet`)
- [x] 1.6 Add test: no configured repos (empty `getRepoPaths` return value `{}`) → throws for any path
- [x] 1.7 Add test: custom `label` parameter → thrown error message includes the custom label
- [x] 1.8 Run `npm run test:main -- src/main/__tests__/validation.test.ts` — all tests pass

## 2. isTaskStatus negative-case tests (T-64 · P2)

- [x] 2.1 Open `src/shared/__tests__/task-state-machine.test.ts` — add a new `describe('isTaskStatus', ...)` block after the existing describe blocks
- [x] 2.2 Import `isTaskStatus` from `../task-state-machine`
- [x] 2.3 Add tests for valid statuses: `'queued'`, `'active'`, `'done'` → all return `true`
- [x] 2.4 Add negative tests using `as unknown as string` casts:
  - `null` → `false`
  - `undefined` → `false`
  - empty string `''` → `false`
  - numeric `0` → `false`
  - plain object `{}` → `false`
  - wrong-case `'DONE'` → `false`
  - wrong-case `'Active'` → `false`
  - unknown string `'pending'` → `false`
- [x] 2.5 Run `npm test -- src/shared/__tests__/task-state-machine.test.ts` — all tests pass

## 3. task-validation partial-block and error-injection tests (T-46 · P3)

- [x] 3.1 Open `src/main/services/__tests__/task-validation.test.ts` — add tests after the existing describe block
- [x] 3.2 Add test: partial-block — two `depends_on` entries where `computeBlockState` returns `{ shouldBlock: true, blockedBy: ['upstream-1'] }` → result has `shouldBlock: true` and `blockedBy` contains `'upstream-1'`
- [x] 3.3 Add test: all deps satisfied — `computeBlockState` returns `{ shouldBlock: false, blockedBy: [] }` → result `valid: true`, `shouldBlock: false`
- [x] 3.4 Add test: `computeBlockState` throws `new Error('dep service unavailable')` → `validateTaskCreation` returns `{ valid: false }` with an error message containing the thrown message (or re-throws — verify actual behaviour and assert accordingly)
- [x] 3.5 Run `npm run test:main -- src/main/services/__tests__/task-validation.test.ts` — all tests pass

## 4. Migration idempotency and data-safety tests (T-47 · P3)

- [x] 4.1 Open `src/main/migrations/__tests__/v053.test.ts` — add: idempotency test (`up(db); up(db)` does not throw); and a test that a row inserted after migration has `orphan_recovery_count = 0` by default
- [x] 4.2 Open `src/main/migrations/__tests__/v054.test.ts` — add: idempotency test; test that existing rows read back `NULL` for `promoted_to_review_at` after migration; test that a new row can write a non-null value to the column
- [x] 4.3 Open `src/main/migrations/__tests__/v055.test.ts` — add: idempotency test (`up(db); up(db)` does not change rows beyond the first run); test that rows with `repo = 'other'` are unaffected
- [x] 4.4 Run `npm run test:main -- src/main/migrations/__tests__/v053.test.ts src/main/migrations/__tests__/v054.test.ts src/main/migrations/__tests__/v055.test.ts` — all pass

## 5. Full suite verification

- [x] 5.1 Run `npm run test:main` — all files pass, no regressions
- [x] 5.2 Run `npm test` — all files pass (covers the shared task-state-machine test)
- [x] 5.3 Run `npm run typecheck` — zero errors
- [x] 5.4 Commit: `test(validation): add validateRepoPath, isTaskStatus, task-validation, and migration edge-case tests`
