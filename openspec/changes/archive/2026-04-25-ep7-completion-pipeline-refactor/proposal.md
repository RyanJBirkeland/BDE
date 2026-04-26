## Why

`resolveSuccess` in `resolve-success-phases.ts` is 9 sequential steps with 8 early-return guards, all at mixed abstraction levels — it reads like a flat script, not a stepdown pipeline. Most `execFileAsync('git', …)` calls in the completion path have no timeout, so a wedged `git push` or `git merge` stalls retry indefinitely. When the no-op guard fires (no changed files), the evidence that triggered it is discarded. Post-success advisory scans (untouched tests, unverified references) are embedded in the orchestrator rather than a pluggable chain.

## What Changes

- `resolveSuccess` refactored into named `SuccessPhase` objects, each with a single `run()` method — stepdown from orchestrator to phase runners to leaf operations
- Every `execFileAsync('git', …)` in `completion.ts`, `resolve-success-phases.ts`, and `review-transition.ts` gets an explicit `timeoutMs` argument
- No-op detection logs `changedFiles: []` so operators know why a task short-circuited
- `PreReviewAdvisor` interface introduced — existing untouched-tests and unverified-refs scans become the first two implementations; new advisory checks can plug in without editing the orchestrator
- Decision log lines added: requeue-vs-terminal decision, commit count + rebase outcome on review transition

## Capabilities

### New Capabilities

- `pre-review-advisor-chain`: Pluggable post-success advisory scan interface — each advisor appends warnings to `task.notes` without blocking the transition

### Modified Capabilities

<!-- No spec-level behavior changes — same completion semantics, cleaner code and better timeouts -->

## Impact

- `src/main/agent-manager/completion.ts` — git timeout wrappers
- `src/main/agent-manager/resolve-success-phases.ts` — SuccessPhase refactor, PreReviewAdvisor chain, no-op log, decision logs
- `src/main/agent-manager/review-transition.ts` — git timeout wrappers
