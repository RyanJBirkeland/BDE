## Context

Three source files in `src/main/agent-manager/` have test gaps that leave silent failure modes undetected:

- `auto-merge-policy.ts` — `getDiffFileStats` parses `git numstat` output by splitting on `\t`. Malformed lines (no tab, non-numeric counts) currently produce `NaN` values silently. `isCssOnlyChange` uses `STYLE_FILE_PATTERN = /\.(css|scss)$/i` but the existing 3 tests don't cover uppercase extensions (`.CSS`, `.SCSS`), double extensions (`.min.css`), or the false-positive guard for stems containing "css" (e.g. `somecss.ts`).
- `test-touch-check.ts` — `listChangedFiles` and `detectUntouchedTests` have zero test coverage. Both accept injectable `deps` (`execFile`, `fileExists`) for full testability without real git.
- `failure-classifier.ts` — `classifyFailureReason` uses `Array.find()` (first-match-wins). The existing test file has individual pattern tests and two precedence cases (auth-beats-timeout, timeout-beats-test_failure) but missing: `environmental` as highest-priority (registered first), `incomplete_files` pattern not tested at all, and the invariant that custom patterns registered after builtins lose to builtins on shared keywords.

## Goals / Non-Goals

**Goals:**
- Document and pin the current malformed-numstat behaviour (NaN propagation does not throw)
- Document and pin `isCssOnlyChange` case-insensitivity and double-extension handling
- Cover `listChangedFiles`: empty output, whitespace trimming, error-catch path, logger.warn on failure
- Cover `detectUntouchedTests`: sibling-in-changedFiles (not flagged), sibling-absent (not flagged), sibling-present-not-changed (flagged), `__tests__/` convention, test files and non-source extensions skipped
- Pin `classifyFailureReason` full precedence order: environmental > auth > no_commits > timeout > test_failure > compilation > spawn > incomplete_files
- All tests run under `vitest` with `vitest.config.main.ts`

**Non-Goals:**
- No production code changes — additive tests only
- No new npm dependencies
- No end-to-end tests requiring real git repos or SQLite

## Decisions

**Decision: test `getDiffFileStats` edge cases via `evaluateAutoMergePolicy` (same approach as existing tests)**

`getDiffFileStats` is a private function. All existing tests reach it through `evaluateAutoMergePolicy`. Adding edge-case assertions in the existing `numstat line parsing` describe block maintains consistent test style and keeps mock setup DRY.

Alternative considered: export `getDiffFileStats` for direct testing. Rejected — exposes a private function solely for testability, which is a Clean Architecture violation.

**Decision: assert NaN propagation is non-throwing, not that it produces "correct" values**

A malformed numstat line producing `{ additions: NaN, deletions: NaN, path: '' }` is the *current* behaviour. The test documents it as a known edge case rather than asserting it is correct. If the production code is later hardened to return 0 or skip the line, the test will catch the change intentionally.

**Decision: create `test-touch-check.test.ts` as a new file rather than extending an existing test**

`test-touch-check.ts` exports three public functions (`listChangedFiles`, `detectUntouchedTests`, `formatAdvisory`) with no existing test coverage. A dedicated file per source module matches the convention used by every other module in `agent-manager/__tests__/`.

**Decision: use `deps.execFile` and `deps.fileExists` injection — never `vi.mock` on node:fs or async-utils**

`TestTouchCheckDeps` was designed for exactly this. Using the injection avoids hoisted `vi.mock` calls for `existsSync` (which would affect other tests in parallel workers) and keeps each test case explicit about what the filesystem looks like.

**Decision: add `environmental`-first precedence tests inside the existing `pattern precedence` describe block**

The block already exists with two tests. Extending it keeps all precedence documentation in one place and avoids creating a confusingly parallel describe block.

**Decision: test `incomplete_files` pattern within the existing per-pattern describe structure**

Every other built-in pattern has its own describe block. `incomplete_files` is the only one missing one. Adding it follows the established convention.

## Risks / Trade-offs

**[Risk]** NaN-producing malformed lines are silently passed to `evaluateAutoReviewRules`, which may cause rule evaluation to behave unpredictably → **Mitigation**: The test documents this behaviour explicitly. A future hardening task can fix the production code; the test will catch if behaviour changes.

**[Risk]** `detectUntouchedTests` sibling-test lookup uses `join(repoPath, candidate)` which means tests must provide a realistic-looking `repoPath` → **Mitigation**: Use `/repo` as a stand-in absolute path; the injected `fileExists` mock controls what "exists" without touching the real filesystem.

**[Risk]** Extending `failure-classifier.test.ts` with custom-pattern tests that use `registerFailurePattern` requires `resetRegistryToBuiltins()` in `afterEach` to avoid polluting the remaining test suite → **Mitigation**: The file already has `afterEach(() => { resetRegistryToBuiltins() })` at the top level; the new tests will benefit from it automatically.

## Migration Plan

Tests-only change. Steps:
1. Extend `auto-merge-policy.test.ts` with T-13 (numstat edge cases) and T-14 (`isCssOnlyChange` edge cases)
2. Create `test-touch-check.test.ts` with T-16 coverage
3. Extend `failure-classifier.test.ts` with T-34 precedence and `incomplete_files` cases
4. Run `npx vitest run --config vitest.config.main.ts` targeting each file — all new tests must pass
5. Run `npm run test:main`, `npm run typecheck`, `npm run lint` — zero errors

Rollback: delete or revert the three test files. No production state is affected.

## Open Questions

None. All source files have been read and the test approach is fully specified.
