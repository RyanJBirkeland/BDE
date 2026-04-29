## Context

This epic adds tests to four existing modules. No production code changes. All tests run under `npm run test:main` (vitest with `vitest.main.config.ts`) or `npm test` (renderer/shared tests).

## Goals

- `validateRepoPath` rejects `../`-traversal, prefix-matches that aren't children, and URL-encoded separators
- `isTaskStatus` rejects non-string runtime values that can arrive from DB rows or wire payloads
- `task-validation.ts` covers partial-block and dependency-service error paths
- v053–v055 migrations are verified idempotent and data-safe

## Non-Goals

- No production code changes
- No new test infrastructure (no helpers, no shared fixtures beyond what already exists)

## Design Decisions

### D-1 — `validateRepoPath` requires mocking `getRepoPaths`

`validateRepoPath` calls `getRepoPaths()` from `../settings`. The test must `vi.mock('../settings', () => ({ getRepoPaths: vi.fn() }))` and inject a known root (e.g. `/projects/fleet`) per test. Path traversal (`/projects/fleet/../etc/passwd`) resolves to `/projects/etc/passwd` via Node's `path.resolve` — still rejected because it doesn't start with `/projects/fleet/`. The prefix test must include the trailing slash check: `/projects/fleetother` must not match root `/projects/fleet`.

**Rejected alternative:** spinning up real file system paths. Unnecessary — the function uses `path.resolve` not filesystem access, so mocking settings is sufficient.

### D-2 — `isTaskStatus` tests use `as unknown as string` casts

The function signature is `(value: string): value is TaskStatus`. Testing runtime safety with `null`/`undefined`/`0` requires `isTaskStatus(null as unknown as string)`. This is intentional — it tests the runtime behaviour that the type system can't enforce at DB/wire boundaries.

### D-3 — task-validation partial-block test uses per-test `computeBlockState` mock overrides

The existing test file already sets up `vi.mock('../dependency-service', ...)`. Per-test overrides via `vi.mocked(computeBlockState).mockReturnValueOnce(...)` avoid re-mocking the whole module. Partial-block = `{ shouldBlock: true, blockedBy: ['t-upstream'] }` with only one of two deps satisfied.

### D-4 — Migration idempotency pattern from v052

v052 already has the idempotency pattern: `expect(() => { up(db); up(db); }).not.toThrow()`. Apply the same pattern to v053, v054, v055. For v054 (adds a nullable column), also assert that existing rows read back `NULL` and new rows can write a value.

### D-5 — v055 unaffected-row test

v055 renames `repo = 'bde'` and `repo = 'BDE'` → `'fleet'`. The test must assert that rows with `repo = 'other'` are not modified — catching an over-broad UPDATE that might match unintended rows.

## Risks

**Low.** All tests are additive. The only risk is a test asserting incorrect behaviour (e.g. wrong path traversal expectation). Mitigated by running `npm run test:main` after each task group.
