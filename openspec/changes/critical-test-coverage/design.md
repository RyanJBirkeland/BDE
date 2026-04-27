## Context

All seven gaps are absent-test problems, not design problems — no production code changes are needed. The test files must be created (or extended) and follow the patterns already established in the codebase:

- **Agent-manager tests** use vitest + `vi.mock` for `getDb`, `broadcast`, and Electron. Dependencies are injected via the `RunAgentDeps` / `TransitionToReviewOpts` interfaces, so mocking is straightforward.
- **Migration tests** follow the pattern in `v049.test.ts`: create a minimal in-memory SQLite schema, call `up(db)`, assert the resulting schema/data, then verify idempotence.
- **Service tests** use `vi.mock` for external calls (`execFileAsync`, `checkAuthStatus`, `getRepoPath`, `createReviewTaskFromAdhoc`) and construct minimal dependency objects inline.

The `better-sqlite3` NODE_MODULE_VERSION mismatch that affects the worktree runner does not affect the main-repo `npm run test:main` pipeline. All new tests that use an in-memory DB will pass in CI.

## Goals / Non-Goals

**Goals:**
- Every function named in the proposal has at least one test covering its error path and one covering the happy path
- Migration tests verify: table/column exists after `up`, idempotence (double-apply doesn't throw), and where applicable, that pre-existing rows survive
- All new test files follow the F.I.R.S.T. principle: no shared state between tests, no reliance on execution order, no real disk I/O or network calls

**Non-Goals:**
- Achieving 100% line coverage within the tested files — the goal is to cover the specific scenarios identified in the audit, not to be exhaustive
- Fixing any production code — these are purely additive test-only changes
- Adding tests for paths already covered by existing test files

## Decisions

### Decision 1: One test file per source module, not per logical group

Each new test file maps 1:1 to one source file (`review-transition.test.ts` → `review-transition.ts`, etc.). This makes it obvious where tests live and avoids "where should this go?" ambiguity when the suite grows.

**Alternative considered:** Group all agent-manager tests in a single "critical-paths" file. Rejected — harder to navigate and breaks the established per-module convention.

### Decision 2: Migration tests create the minimal required schema, not the full migrated DB

The migration `up` function is called on a DB that has only what the migration needs (the table or columns it acts on), not the full schema produced by all prior migrations. This keeps tests fast and focused.

**Alternative considered:** Run all prior migrations via `runMigrations` before each test. Rejected — unnecessarily slow and couples the test to every preceding migration.

### Decision 3: `operational-checks-service` tests mock all external I/O at the call site

`checkAuthStatus`, `getRepoPath`, `execFileAsync`, and `listTasks` are all mocked via `vi.mock`. The checks are tested for their decision logic (what they return given specific mocked inputs), not for their I/O plumbing.

### Decision 4: `resolveFailure` tests use the real function, not a mock of it

The audit finding is specifically about the real function's behavior when `repo.updateTask` throws. Existing tests in `completion.test.ts` mock `resolveFailure` entirely. The new `resolve-failure-phases.test.ts` will test the real function with a mocked repository.

## Risks / Trade-offs

- **Risk: `transitionToReview` test couples to `captureDiffSnapshot`** → Mitigation: mock `captureDiffSnapshot` at module level via `vi.mock`; the test stays focused on the transition logic, not diff capture.
- **Risk: `promoteAdhocAgent` test is complex due to multiple `execFileAsync` calls** → Trade-off accepted: mock `execFileAsync` to return controlled values per call; the test verifies the happy path and the "no commits" error branch.
- **Risk: Migration tests become stale if the migration file is later modified** → Accepted: per CLAUDE.md policy, the tests document the migration's contract at the time it was written; they do not need to track future schema changes.
