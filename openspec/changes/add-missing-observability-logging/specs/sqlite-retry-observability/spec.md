## ADDED Requirements

### Requirement: withRetryAsync emits a warn on each retry round
`withRetryAsync` SHALL emit a warn-level log message on each retry attempt (attempts 1 through N) when a `logger` is provided via `RetryOptions`. The message SHALL include the attempt number and the computed backoff duration in milliseconds. No log SHALL be emitted on attempt 0 (the initial try) or after the final throw.

#### Scenario: Logger provided, single retry before success
- **WHEN** `withRetryAsync` is called with a `logger` and the wrapped function throws `SQLITE_BUSY` on attempt 0 then succeeds on attempt 1
- **THEN** exactly one warn is emitted containing `attempt=1` and the computed `backoffMs`

#### Scenario: Logger provided, exhausted retries
- **WHEN** `withRetryAsync` is called with a `logger` and the wrapped function throws `SQLITE_BUSY` on every attempt up to `maxRetries`
- **THEN** `maxRetries` warn messages are emitted (one per retry round, none for attempt 0) and the error is rethrown after the last attempt

#### Scenario: No logger provided
- **WHEN** `withRetryAsync` is called without a `logger` in `RetryOptions`
- **THEN** no log output is produced and behavior is identical to the current implementation

#### Scenario: Non-busy error, no retry
- **WHEN** `withRetryAsync` wraps a function that throws a non-`SQLITE_BUSY` error
- **THEN** no warn is emitted and the error is rethrown immediately

### Requirement: RetryOptions logger interface is a structural subtype of BDE Logger
The `logger` field on `RetryOptions` SHALL use a minimal interface `{ warn: (msg: string) => void }` that is satisfied by the BDE `Logger` type, `console`, and test mocks without any adapter.

#### Scenario: BDE Logger assigned to RetryOptions.logger
- **WHEN** a caller passes a `Logger` instance (from `createLogger`) as `RetryOptions.logger`
- **THEN** TypeScript accepts the assignment without a cast or adapter

### Requirement: handleEnvironmentalFailure log includes triggering taskId
`handleEnvironmentalFailure` in `drain-loop.ts` SHALL include the `taskId` argument in its `logger.warn` call so the task that triggered a drain pause is immediately visible in the log without a secondary grep.

#### Scenario: Environmental failure logged
- **WHEN** `handleEnvironmentalFailure` is called with a `taskId` and an environmental error
- **THEN** the warn log line contains `taskId`

### Requirement: claimTask validation warn includes title and status transition
When `claimTask` rejects a claim due to an invalid state transition, the `getSprintQueriesLogger().warn` call SHALL include `oldTask.title` and the from/to status pair (`${oldTask.status} → active`) in addition to the existing `id` and reason.

#### Scenario: Invalid transition warn emitted
- **WHEN** `claimTask` is called for a task whose current status fails `validateTransition(oldTask.status, 'active')`
- **THEN** the warn log line contains the task's `title` and the string `"${oldTask.status} → active"`
