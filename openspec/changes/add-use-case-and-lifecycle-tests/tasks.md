## 1. Read source files before writing any tests

- [x] 1.1 Read `src/main/services/sprint-use-cases.ts` lines 349–397 (`updateTaskFromUi` and `narrowStatus`) to confirm the exact `validateAndFilterPatch` call and `prepareQueueTransition` call signatures
- [x] 1.2 Read `src/main/services/__tests__/sprint-use-cases.update.test.ts` in full to understand the existing mock setup (`computeBlockState`, `buildBlockedNotes`, `mockTransition`, `mockUpdateTask`) and confirm where the three new test cases should be inserted
- [x] 1.3 Read `src/main/services/task-state-service.ts` `prepareQueueTransition` function to verify that `buildBlockedNotes` output is injected into `workingPatch.notes` before the `transition` call
- [x] 1.4 Read `src/main/data/sprint-task-crud.ts` `createTask` and `updateTask` signatures (especially the optional `db?: Database.Database` parameter) and confirm `queued → active` is allowed by the transition guard
- [x] 1.5 Read `src/main/__tests__/db.test.ts` (first 40 lines) to confirm the `new Database(':memory:')` + `runMigrations(db)` + `db.close()` pattern used for in-memory test isolation

## 2. Add three unit test cases to sprint-use-cases.update.test.ts

- [x] 2.1 Add test: `'strips fields not in UPDATE_ALLOWLIST from patch before calling updateTask'` — patch `{ title: 'ok', invented_field: 'bad' }`, assert `mockUpdateTask` called with `{ title: 'ok' }` and `invented_field` absent
- [x] 2.2 Add test: `'queued-to-blocked redirect carries blockedNotes in transition fields'` — set `computeBlockState` to `{ shouldBlock: true, blockedBy: ['dep-1'] }`, set `buildBlockedNotes` mock to return `'blocked: dep-1'`, assert `mockTransition` called with `('t1', 'blocked', expect.objectContaining({ fields: expect.objectContaining({ notes: 'blocked: dep-1' }), caller: 'ui' }))`
- [x] 2.3 Add test: `'status change with concurrent field update sends fields to transition not updateTask'` — patch `{ status: 'active', notes: 'starting' }`, assert `mockTransition` called with `('t1', 'active', { fields: { notes: 'starting' }, caller: 'ui' })` and `mockUpdateTask` NOT called
- [x] 2.4 Run `npm run test:main -- --reporter=verbose src/main/services/__tests__/sprint-use-cases.update.test.ts` and confirm all 3 new tests pass and no existing tests regress

## 3. Create lifecycle integration test file

- [x] 3.1 Create `src/main/agent-manager/__tests__/lifecycle.integration.test.ts` with the following structure:
  - Mock `electron`, `../../broadcast`, `../../paths`, `../../data/sprint-query-logger` to prevent side-effects
  - Do NOT mock `better-sqlite3`, `../../db`, or `../../data/sprint-task-crud`
  - `beforeEach`: `db = new Database(':memory:')` then `runMigrations(db)`
  - `afterEach`: `db.close()`
- [x] 3.2 Implement the single test `'transitions a task through queued → active → review in the real data layer'`:
  - `createTask({ title: 'Lifecycle test', repo: 'bde', status: 'queued', priority: 0, playground_enabled: false }, db)` — assert `task.status === 'queued'`
  - `updateTask(task.id, { status: 'active', claimed_by: 'executor' }, undefined, db)` — assert `active.status === 'active'` and `active.claimed_by === 'executor'`
  - `updateTask(task.id, { status: 'review', claimed_by: null }, undefined, db)` — assert `reviewed.status === 'review'` and `reviewed.claimed_by === null`
  - `getTask(task.id, db)` — assert `final.status === 'review'` and `final.claimed_by === null`
- [x] 3.3 Run `npm run test:main -- --reporter=verbose src/main/agent-manager/__tests__/lifecycle.integration.test.ts` and confirm the test passes
- [x] 3.4 Run `npm run test:main` (full suite) and confirm zero regressions

## 4. Update module documentation

- [x] 4.1 Verify `docs/modules/services/index.md` has a row for `sprint-use-cases.ts` (it should already exist); update the Test Coverage column or notes if the module doc tracks test status
- [x] 4.2 Verify `docs/modules/agent-manager/index.md` has no stale entries; add a note for `lifecycle.integration.test.ts` if the index tracks test files
