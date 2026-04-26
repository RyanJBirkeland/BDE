## Why

Five IPC handlers contain business logic that belongs in services: inline git operations, multi-step orchestration, and policy enforcement are embedded directly in `review.ts`, `sprint-local.ts`, and `sprint-retry-handler.ts`. This violates Clean Architecture's rule that handlers are thin adapters — they should parse IPC arguments, delegate to a service, and return results. Each fat handler is harder to test, harder to reuse, and couples the IPC transport layer to business rules.

## What Changes

- Extract `review:checkFreshness` inline git logic (fetch, SHA compare, commit count) into `review-orchestration-service.ts` as `checkReviewFreshness()`
- Extract `review:markShippedOutsideBde` inline status validation + transition into `review-orchestration-service.ts` as `markShippedOutsideBde()`
- Extract `sprint:claimTask` inline template lookup (settings read + match) into `sprint-service.ts` as `claimTask()`
- Extract `sprint:forceReleaseClaim` inline multi-step orchestration (cancel agent → reset → transition → notify) into `sprint-service.ts` as `forceReleaseClaim()`
- Extract `sprint:retry` entire body (status guard, repo lookup, git worktree prune, branch cleanup, state reset, transition) into `sprint-service.ts` as `retryTask()`
- Each handler becomes: validate args → call service → return result

## Capabilities

### New Capabilities
- `thin-handler-services`: IPC handlers in `review.ts`, `sprint-local.ts`, and `sprint-retry-handler.ts` are thin adapters; all extracted business logic lives in testable service functions

### Modified Capabilities
<!-- No spec-level requirement changes — behavior is preserved, only the code layer changes -->

## Impact

- `src/main/handlers/review.ts` — `review:checkFreshness` and `review:markShippedOutsideBde` handlers slimmed to ≤5 lines each
- `src/main/services/review-orchestration-service.ts` — gains `checkReviewFreshness()` and `markShippedOutsideBde()`
- `src/main/handlers/sprint-local.ts` — `sprint:claimTask` and `sprint:forceReleaseClaim` handlers slimmed
- `src/main/handlers/sprint-retry-handler.ts` — `sprint:retry` handler body replaced by single service call
- `src/main/services/sprint-service.ts` — gains `claimTask()`, `forceReleaseClaim()`, `retryTask()`
- Tests: new unit tests for each extracted service function; handler tests become thin stubs
