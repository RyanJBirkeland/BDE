## Context

The agent completion pipeline in `src/main/agent-manager/` is the most consequential code path in FLEET: it decides whether agent work is valid, records that decision to SQLite, and gates the transition to the Code Review queue. Four files in this pipeline have zero test coverage today:

- `verification-gate.ts` — pre-review guards (`verifyBranchTipOrFail`, `verifyWorktreeOrFail`) with zero tests
- `success-pipeline.ts` — 10-phase orchestrator with no integration tests for phase ordering, abort propagation, or the `detectNoOpAndFailIfSo` write-failure guard
- `pre-review-advisors.ts` — pluggable advisory checks with zero tests for `runPreReviewAdvisors`
- `terminal-handler.ts` — `handleTaskTerminal` deduplication with zero tests (distinct from `TerminalGuard`)

The existing test suite (`resolve-failure-phases.test.ts`, `resolve-success-phases.test.ts`, `terminal-guard.test.ts`) provides established patterns to follow.

## Goals / Non-Goals

**Goals:**
- Add deterministic, fast, dependency-free unit tests for each of the 4 identified gaps
- Verify that `onTaskTerminal` is never called when DB writes fail (the invariant that prevents false dependency unblocking)
- Verify that `PipelineAbortError` propagation halts subsequent phases without rethrowing
- Verify `handleTaskTerminal` deduplication under concurrent same-taskId calls
- All tests run under `vitest` with the existing `vitest.config.main.ts` configuration

**Non-Goals:**
- No production code changes — tests only
- No new npm dependencies — only vitest and existing test helpers
- No end-to-end or integration tests requiring real git repos or SQLite
- Not testing `truncateNotesTail` boundary conditions or `duration_ms` NaN guard — those are separate gaps already tracked

## Decisions

**Decision: Test `detectNoOpAndFailIfSo` via the exported `successPhases[5]` (noOpGuardPhase) phase object**

`detectNoOpAndFailIfSo` is a private function. The cleanest boundary is `successPhases[5]` (`noOpGuardPhase`). Calling `phase.run(ctx)` with a crafted `SuccessPhaseContext` directly tests the write-failure guard without orchestrating all 10 phases.

Alternative considered: test through `resolveSuccess` with heavy mocking of all other phases. Rejected because it creates fragile coupling to phase-index positions.

**Decision: Test `resolveSuccess` phase ordering by mocking all imported functions and asserting call counts in order**

`successPhases` delegates to imported functions (`verifyWorktreeExists`, `detectAgentBranch`, etc.). Mocking at module level via `vi.mock(...)` lets us control which phases succeed/fail without filesystem or git access. Call ordering is verified by tracking mock invocation order.

**Decision: Test `runPreReviewAdvisors` by mutating the exported `preReviewAdvisors` array with stubs**

`preReviewAdvisors` is an exported mutable array, making it injectable for tests without any production code changes. Tests splice in stub advisors in `beforeEach` and restore in `afterEach`.

**Decision: Test `handleTaskTerminal` deduplication by passing a shared `terminalCalled` Map directly in `TerminalHandlerDeps`**

The Map is part of `TerminalHandlerDeps`, making it fully observable and controllable. Tests inspect the Map before/after calls and use concurrent `Promise` calls to verify the deduplication path.

## Risks / Trade-offs

**[Risk]** `vi.mock(...)` hoisting in `success-pipeline.test.ts` requires mocking every module imported by `success-pipeline.ts` to avoid real filesystem calls → **Mitigation**: Follow the established pattern from `write-failure-consistency.test.ts` and `resolve-success-phases.test.ts`, which mock multiple modules before imports.

**[Risk]** `BranchTipMismatchError` must be the real class (not a mock) for `instanceof` checks in `verifyBranchTipOrFail` to pass → **Mitigation**: Use `vi.importActual` to import the real `BranchTipMismatchError` while mocking `assertBranchTipMatches` as a controllable stub.

**[Risk]** `preReviewAdvisors` array mutation is not thread-safe if vitest runs tests in parallel within a file → **Mitigation**: Use `beforeEach`/`afterEach` guards and keep all advisor-replacement tests within a single `describe` block; vitest runs tests in a single file sequentially within its worker.

## Migration Plan

Tests-only change. No migration required. Steps:
1. Create the 4 new test files
2. Run `npm run test:main` — all new tests must pass
3. Run `npm run typecheck` and `npm run lint` — zero errors

Rollback: delete the new test files. No production state is affected.

## Open Questions

None. All source files have been read and the test approach is fully specified.
