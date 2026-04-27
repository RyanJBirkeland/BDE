## ADDED Requirements

### Requirement: transitionToReview is tested for happy path and error paths
`src/main/agent-manager/__tests__/review-transition.test.ts` SHALL exist and cover `transitionToReview` with mocked dependencies (`captureDiffSnapshot`, `repo`, `taskStateService`, `logger`).

#### Scenario: Happy path transitions task to review status
- **WHEN** `transitionToReview` is called with a valid task id, worktree path, and all dependencies mocked to succeed
- **THEN** `repo.updateTask` is called with `status: 'review'` and the worktree path, and `taskStateService.transition` is called with `'review'`

#### Scenario: captureDiffSnapshot throws does not swallow the error
- **WHEN** `captureDiffSnapshot` rejects with an error
- **THEN** `transitionToReview` rejects with the same error and `repo.updateTask` is NOT called with `status: 'review'`

#### Scenario: repo.updateTask throws propagates the error
- **WHEN** `captureDiffSnapshot` resolves but `repo.updateTask` throws
- **THEN** `transitionToReview` rejects; the task is not left in a silently-claimed state

---

### Requirement: resolveFailure DB-write error path is tested
`src/main/agent-manager/__tests__/resolve-failure-phases.test.ts` SHALL exist (or the existing file extended) and cover the case where `repo.updateTask` throws inside `resolveFailure`.

#### Scenario: resolveFailure propagates or handles repo.updateTask throw
- **WHEN** `repo.updateTask` throws inside `resolveFailure`
- **THEN** the error is either propagated to the caller or the function returns a result that does NOT indicate `isTerminal: true` — in no case does `onTaskTerminal` get called for a task that was never written to the DB

#### Scenario: resolveFailure happy path retries task on non-exhausted attempts
- **WHEN** `resolveFailure` is called and retry count is below the exhaustion threshold
- **THEN** `repo.updateTask` is called with a queued/retry status and `isTerminal` is `false`

#### Scenario: resolveFailure marks task failed when retries exhausted
- **WHEN** `resolveFailure` is called and the task has reached the maximum retry count
- **THEN** `repo.updateTask` is called with `status: 'failed'` and `isTerminal` is `true`

---

### Requirement: calculateRetryBackoff jitter stays within documented ±20% bounds
`src/main/agent-manager/__tests__/resolve-failure-phases.test.ts` SHALL include a statistical test for `calculateRetryBackoff`.

#### Scenario: Jitter stays within ±20% of base delay across 1000 samples
- **WHEN** `calculateRetryBackoff` is called 1000 times for each configured base delay
- **THEN** every result falls within `[base * 0.8, base * 1.2]`

#### Scenario: Backoff respects the configured maximum cap
- **WHEN** `calculateRetryBackoff` is called for a high retry count that would exceed the cap
- **THEN** all results are ≤ the maximum backoff value
