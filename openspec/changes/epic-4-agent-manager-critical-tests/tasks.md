## 1. verification-gate.ts tests (T-17 · P1)

- [x] 1.1 Create `src/main/agent-manager/__tests__/verification-gate.test.ts` — add `vi.mock` declarations for `./resolve-success-phases` (using `vi.importActual` to preserve the real `BranchTipMismatchError`), `./verify-worktree`, `./resolve-failure-phases`, and `./revision-feedback-builder`
- [x] 1.2 Add `verifyBranchTipOrFail` tests: (a) `repoPath: undefined` returns `true` without calling `assertBranchTipMatches`; (b) `repo.getTask` returns `null` returns `false`; (c) `assertBranchTipMatches` resolves → returns `true`; (d) `assertBranchTipMatches` throws `BranchTipMismatchError` → `taskStateService.transition` called with `'failed'`, returns `false`; (e) `assertBranchTipMatches` throws a generic `Error` → warns and returns `true`
- [x] 1.3 Add `verifyWorktreeOrFail` tests: (a) `verifyWorktreeBuildsAndTests` returns `{ ok: true }` → returns `true`, `onTaskTerminal` never called; (b) `resolveFailure` returns `{ writeFailed: true }` → returns `false`, `onTaskTerminal` never called; (c) `resolveFailure` returns `{ isTerminal: false, writeFailed: false }` → `onTaskTerminal` called with `'queued'`; (d) `resolveFailure` returns `{ isTerminal: true, writeFailed: false }` → `onTaskTerminal` called with `'failed'`
- [x] 1.4 Run `npx vitest run --config vitest.config.main.ts src/main/agent-manager/__tests__/verification-gate.test.ts` — all tests pass

## 2. success-pipeline.ts phase ordering and noop guard tests (T-11 + T-12 · P1/P2)

- [x] 2.1 Create `src/main/agent-manager/__tests__/success-pipeline.test.ts` — add `vi.mock` declarations for all modules delegated to by the 10 phases: `./resolve-success-phases`, `./resolve-failure-phases`, `./auto-merge-coordinator`, `./test-touch-check`, `./noop-detection`, `../env-utils`, `./verification-gate`, `./pre-review-advisors`
- [x] 2.2 Add test: all 10 phases execute in order on a clean run — mock all imported delegates to resolve, then call `resolveSuccess`; assert all mocked functions called and that no `PipelineAbortError` escapes
- [x] 2.3 Add test: `PipelineAbortError` thrown by the `autoCommitPhase` (phase index 2) skips all remaining phases and `resolveSuccess` returns without throwing — verify phases after index 2 were never called
- [x] 2.4 Add test: a non-`PipelineAbortError` thrown by any phase propagates out of `resolveSuccess` — verify the error is rethrown
- [x] 2.5 Add test via `successPhases[5].run(ctx)` (noOpGuardPhase): `detectNoOpRun` returns `true` and `resolveFailure` returns `{ writeFailed: true }` → `onTaskTerminal` never called, phase throws `PipelineAbortError`
- [x] 2.6 Add test via `successPhases[5].run(ctx)`: `detectNoOpRun` returns `true` and `resolveFailure` returns `{ isTerminal: false, writeFailed: false }` → `onTaskTerminal` called once with `'queued'`, phase throws `PipelineAbortError`
- [x] 2.7 Run `npx vitest run --config vitest.config.main.ts src/main/agent-manager/__tests__/success-pipeline.test.ts` — all tests pass

## 3. pre-review-advisors.ts tests (T-5 · P2)

- [x] 3.1 Create `src/main/agent-manager/__tests__/pre-review-advisors.test.ts` — add `vi.mock('./verification-gate', () => ({ appendAdvisoryNote: vi.fn() }))`
- [x] 3.2 In `beforeEach`, save the current contents of `preReviewAdvisors` and splice in stub advisors; in `afterEach`, restore the original array contents to prevent test pollution
- [x] 3.3 Add test: single advisor returns a non-null string → `appendAdvisoryNote` called once with that string and the task ID
- [x] 3.4 Add test: advisor returns `null` → `appendAdvisoryNote` never called
- [x] 3.5 Add test: first advisor throws → warning logged with the advisor name, second advisor still runs, `runPreReviewAdvisors` does not throw
- [x] 3.6 Add test: all advisors return `null` → `appendAdvisoryNote` never called
- [x] 3.7 Run `npx vitest run --config vitest.config.main.ts src/main/agent-manager/__tests__/pre-review-advisors.test.ts` — all tests pass

## 4. terminal-handler.ts tests (T-15 · P2)

- [x] 4.1 Create `src/main/agent-manager/__tests__/terminal-handler.test.ts` — add `vi.mock('../../lib/resolve-dependents', () => ({ resolveDependents: vi.fn() }))` and `vi.mock('../settings', () => ({ getSetting: vi.fn() }))`
- [x] 4.2 Add helper `makeTerminalHandlerDeps(overrides?)` returning a `TerminalHandlerDeps` with a fresh `terminalCalled` Map and mocked `metrics`, `repo`, `unitOfWork`, and `config` (using `makeLogger` and `makeMetrics` from `./test-helpers`)
- [x] 4.3 Add test: `handleTaskTerminal` with status `'done'` → `metrics.increment` called with `'agentsCompleted'`
- [x] 4.4 Add test: `handleTaskTerminal` with status `'failed'` → `metrics.increment` called with `'agentsFailed'`
- [x] 4.5 Add test: concurrent same-taskId calls — start first call without resolving, start second call; assert both receive the identical `Promise` object and that the underlying execution fires exactly once
- [x] 4.6 Add test: after first call resolves, `terminalCalled` Map is empty and a subsequent same-taskId call fires a fresh execution
- [x] 4.7 Add test: `config.onStatusTerminal` is set → it is called with the task ID and status; `resolveDependents` is not called
- [x] 4.8 Run `npx vitest run --config vitest.config.main.ts src/main/agent-manager/__tests__/terminal-handler.test.ts` — all tests pass

## 5. Full suite verification

- [x] 5.1 Run `npm run test:main` — all tests pass with zero failures
- [x] 5.2 Run `npm run typecheck` — zero errors
- [x] 5.3 Run `npm run lint` — zero errors (warnings OK)
- [x] 5.4 Update `docs/modules/agent-manager/index.md` — ensure rows exist for `verification-gate.ts`, `success-pipeline.ts`, `pre-review-advisors.ts`, `terminal-handler.ts`; add any missing rows
