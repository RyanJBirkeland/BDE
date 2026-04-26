## Context

Three modules share a common problem: each guards a critical runtime invariant with no direct test coverage. The gaps were identified during a reliability audit (F1 phase):

- `operational-checks-service.ts` — the only gate between the UI's "queue task" action and an agent launch. Its `validateGitCleanStatus` has an error-catch branch that silently degrades to `warn` rather than crashing; this branch was never exercised by a test.
- `unit-of-work.ts` — wraps better-sqlite3's `db.transaction()` for atomic multi-write operations. Callers rely on automatic rollback when the inner work throws, but no test has ever verified that better-sqlite3 actually rolls back in this codebase.
- `watchdog-loop.ts` — the `cleanupWorktreeIfNotInReview` helper is the only guard preventing the watchdog from deleting a review-status worktree that a human is actively inspecting. The two status-branch paths (skip vs. invoke) are hit only indirectly by existing `runWatchdog` tests.

All three are pure test additions — no production code changes.

## Goals / Non-Goals

**Goals:**
- Direct, explicit test coverage for every exported function in `operational-checks-service.ts`
- Proven SQLite rollback-on-throw behavior for `createUnitOfWork().runInTransaction`
- Explicit assertions for both branches of the watchdog preserve-guard (`review` → skip, non-review → invoke)
- Tests that are F.I.R.S.T. compliant: no I/O outside in-memory SQLite, no timers unless faked, independent and self-validating

**Non-Goals:**
- End-to-end or Electron integration tests
- Coverage of any production code not named above
- Refactoring the production modules

## Decisions

**Decision: mock all I/O in operational-checks-service tests via vi.mock()**

All four external dependencies (`checkAuthStatus`, `getRepoPath`, `execFileAsync`, `listTasks`) are module-level imports. Vitest's `vi.mock()` at the top of the file intercepts them before any test runs. Each test controls the return value with `vi.mocked(...).mockResolvedValue` / `mockReturnValue`. This keeps tests synchronous where possible and avoids any filesystem or network I/O.

Alternative considered: dependency injection via function parameters. Rejected — would require changing the production function signatures, which are already locked by the handler that calls them.

**Decision: use in-memory SQLite for the unit-of-work integration test**

The same pattern used by `sprint-queries.test.ts`: `new Database(':memory:')`, `runMigrations(db)`, and a `vi.mock('../../db', async () => ({ ...actual, getDb: () => db }))` override. This proves the real better-sqlite3 transaction semantics without touching the user's live database.

Alternative considered: mock `db.transaction` to return a spy. Rejected — the whole point of the test is to verify that better-sqlite3 actually rolls back; mocking the transaction function would only verify call order, not the database state guarantee.

**Decision: test `cleanupWorktreeIfNotInReview` via `runWatchdog` (not by exporting the helper)**

The helper is private (`function cleanupWorktreeIfNotInReview`). Exporting it would widen the module's API surface for test-only reasons, violating the principle that test doubles should not force production changes. `runWatchdog` already exercises the helper on every non-ok verdict; the two new tests simply add `cleanupAgentWorktree: vi.fn()` to `makeDeps` overrides and assert call/no-call.

## Risks / Trade-offs

- [Risk: `runMigrations` schema changes break the unit-of-work test] — The test inserts into `sprint_tasks` using only the columns that have been stable since v001 (`id`, `title`, `status`, `repo`, `priority`, `needs_review`). New non-null columns added by future migrations without defaults would break the insert. Mitigation: use only columns with defaults or explicit values; document the minimal-columns intent in the test.

- [Risk: watchdog-loop test import order] — Vitest requires `vi.mock()` calls to appear before any `import` that uses the mocked module, or the mock won't intercept. The existing test file already follows this rule; the two new tests reuse the existing mock setup and `makeDeps` factory, so no new mock ordering issues are introduced.

- [Trade-off: `operational-checks-service` tests mock `listTasks` from `sprint-service`, not from `sprint-queries` directly] — The service imports `listTasks` from `./sprint-service`. Mocking at that level is correct; mocking at the queries level would not intercept the import. This means the mock is one layer higher than the data layer, which is intentional.
