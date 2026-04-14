# Split completion.ts into Focused Phase Modules

## Context
`src/main/agent-manager/completion.ts` is 472 LOC and bundles 5 independent workflows: success resolution, failure/retry handling, commit verification, rebase orchestration, and auto-merge evaluation. It was flagged by 4 audit lenses (SRP, cohesion, complexity, naming). The file is a critical path — every agent task completion goes through it — so this refactor must be behavior-preserving with no functional changes.

## Goal
Split `completion.ts` into focused modules and reduce it to a thin dispatcher. No behavior changes — only structural reorganization.

## Files to Change

**Create:**
- `src/main/agent-manager/resolve-success-phases.ts` — move: `verifyWorktreeExists`, `detectAgentBranch`, `hasCommitsAheadOfMain`, `performRebaseOntoMain`, the worktree-verification and commit-detection logic from `resolveSuccess`
- `src/main/agent-manager/resolve-failure-phases.ts` — move: `resolveFailure`, `calculateRetryBackoff` (extracted from inline in `resolveFailure`), the retry-limit check
- `src/main/agent-manager/auto-merge-coordinator.ts` — move: `evaluateAutoMerge`, any auto-merge policy logic currently in resolveSuccess

**Modify:**
- `src/main/agent-manager/completion.ts` — keep only: `resolveSuccess` (as dispatcher), `runPostCompletionHook`, type re-exports. All moved functions become imports.
- Update all import sites if any file imports directly from `completion.ts` named exports.

## Instructions
1. Read `completion.ts` in full before making any changes.
2. Identify the natural phase boundaries by function grouping.
3. Extract `calculateRetryBackoff` as a pure function (takes retryCount, returns delayMs) — it is currently inlined in `resolveFailure`.
4. Move functions into new files, update imports within the new files to point to each other correctly.
5. `completion.ts` becomes: imports from the 3 new files + the existing `resolveSuccess` orchestrator + `resolveFailure` orchestrator. Both orchestrators stay in completion.ts as thin coordinators — they call the phase functions, they do not implement them.
6. Do not rename any exported symbols — only move them.

## How to Test
- `npm run typecheck` must pass with zero errors — TypeScript will catch any broken imports.
- `npm test` must pass — existing tests in `src/main/agent-manager/` cover completion logic.
- `npm run test:main` must pass.
- Manually verify: queue one task in BDE and confirm it completes to `review` status normally.
