## ADDED Requirements

### Requirement: verifyBranchTipOrFail skips verification when repoPath is absent
`verifyBranchTipOrFail` SHALL return `true` immediately when `repoPath` is `undefined`, without calling `assertBranchTipMatches` or modifying task state.

#### Scenario: undefined repoPath returns true without git access
- **WHEN** `verifyBranchTipOrFail` is called with `repoPath: undefined`
- **THEN** the function returns `true` and `assertBranchTipMatches` is never called

### Requirement: verifyBranchTipOrFail returns false when task has vanished
`verifyBranchTipOrFail` SHALL return `false` and log an error when `repo.getTask` returns `null`, without attempting branch verification.

#### Scenario: missing task returns false
- **WHEN** `repo.getTask` returns `null` for the given task ID
- **THEN** the function returns `false` and does not call `assertBranchTipMatches`

### Requirement: verifyBranchTipOrFail transitions to failed on branch tip mismatch
When `assertBranchTipMatches` throws `BranchTipMismatchError`, `verifyBranchTipOrFail` SHALL transition the task to `failed` via `taskStateService.transition` and return `false`.

#### Scenario: BranchTipMismatchError causes failed transition and false return
- **WHEN** `assertBranchTipMatches` throws `BranchTipMismatchError`
- **THEN** `taskStateService.transition` is called with `'failed'`
- **THEN** the function returns `false`

### Requirement: verifyBranchTipOrFail passes through on non-mismatch errors
When `assertBranchTipMatches` throws any error that is not `BranchTipMismatchError`, `verifyBranchTipOrFail` SHALL log a warning and return `true` so the task can proceed to review.

#### Scenario: non-mismatch error returns true with warning
- **WHEN** `assertBranchTipMatches` throws a generic `Error`
- **THEN** the function returns `true`
- **THEN** a warning is logged

### Requirement: verifyWorktreeOrFail passes through when build and tests succeed
`verifyWorktreeOrFail` SHALL return `true` and never call `onTaskTerminal` when `verifyWorktreeBuildsAndTests` returns `{ ok: true }`.

#### Scenario: successful verification returns true without terminal notification
- **WHEN** `verifyWorktreeBuildsAndTests` returns `{ ok: true }`
- **THEN** the function returns `true`
- **THEN** `onTaskTerminal` is never called

### Requirement: verifyWorktreeOrFail suppresses terminal notification when DB write fails
When verification fails and `resolveFailure` returns `writeFailed: true`, `verifyWorktreeOrFail` SHALL return `false` without calling `onTaskTerminal`.

#### Scenario: writeFailed true suppresses onTaskTerminal
- **WHEN** `verifyWorktreeBuildsAndTests` returns `{ ok: false, failure: { kind: 'compilation', stderr: 'tsc error' } }`
- **WHEN** `resolveFailure` returns `{ writeFailed: true }`
- **THEN** `onTaskTerminal` is never called
- **THEN** the function returns `false`

### Requirement: verifyWorktreeOrFail calls onTaskTerminal with correct status on failure
When verification fails and `resolveFailure` succeeds, `verifyWorktreeOrFail` SHALL call `onTaskTerminal` with `'queued'` for non-terminal failures and `'failed'` for terminal failures.

#### Scenario: non-terminal failure calls onTaskTerminal with queued
- **WHEN** `resolveFailure` returns `{ isTerminal: false, writeFailed: false }`
- **THEN** `onTaskTerminal` is called once with `'queued'`
- **THEN** the function returns `false`

#### Scenario: terminal failure calls onTaskTerminal with failed
- **WHEN** `resolveFailure` returns `{ isTerminal: true, writeFailed: false }`
- **THEN** `onTaskTerminal` is called once with `'failed'`
- **THEN** the function returns `false`

### Requirement: resolveSuccess executes all 10 phases in order on a clean run
`resolveSuccess` SHALL iterate `successPhases` in declaration order, calling each phase's `run` method exactly once when no phase aborts.

#### Scenario: all phases execute on clean run
- **WHEN** every phase resolves without throwing
- **THEN** all 10 phase functions are called in their declared order
- **THEN** `resolveSuccess` returns without throwing

### Requirement: resolveSuccess halts on PipelineAbortError without propagating
When any phase throws `PipelineAbortError`, `resolveSuccess` SHALL stop executing subsequent phases and return normally without rethrowing.

#### Scenario: PipelineAbortError at phase 3 skips phases 4 through 10
- **WHEN** phase 3 (autoCommit) throws `PipelineAbortError`
- **THEN** phases 4 through 10 are not called
- **THEN** `resolveSuccess` returns without throwing

### Requirement: resolveSuccess propagates non-PipelineAbortError exceptions
When any phase throws an error that is not `PipelineAbortError`, `resolveSuccess` SHALL rethrow that error to the caller.

#### Scenario: unexpected error propagates out of resolveSuccess
- **WHEN** a phase throws a plain `Error`
- **THEN** `resolveSuccess` throws that same error

### Requirement: detectNoOpAndFailIfSo suppresses onTaskTerminal when DB write fails
When `detectNoOpRun` returns `true` and `resolveFailure` returns `writeFailed: true`, the no-op guard SHALL return `true` (abort) without calling `onTaskTerminal`.

#### Scenario: noop with writeFailed suppresses terminal notification
- **WHEN** `detectNoOpRun` returns `true`
- **WHEN** `resolveFailure` returns `{ writeFailed: true }`
- **THEN** `onTaskTerminal` is never called

### Requirement: detectNoOpAndFailIfSo calls onTaskTerminal when write succeeds
When `detectNoOpRun` returns `true` and `resolveFailure` succeeds, the no-op guard SHALL call `onTaskTerminal` exactly once with the appropriate status.

#### Scenario: noop with successful write calls onTaskTerminal with queued
- **WHEN** `detectNoOpRun` returns `true`
- **WHEN** `resolveFailure` returns `{ isTerminal: false, writeFailed: false }`
- **THEN** `onTaskTerminal` is called once with `'queued'`

### Requirement: runPreReviewAdvisors appends non-null advisor warnings to task notes
`runPreReviewAdvisors` SHALL call `appendAdvisoryNote` for each advisor that returns a non-null, non-empty warning string.

#### Scenario: non-null advisory calls appendAdvisoryNote
- **WHEN** an advisor returns a non-null warning string
- **THEN** `appendAdvisoryNote` is called with that exact string for the task

#### Scenario: null advisory does not call appendAdvisoryNote
- **WHEN** an advisor returns `null`
- **THEN** `appendAdvisoryNote` is not called for that advisor

### Requirement: runPreReviewAdvisors catches advisor errors without stalling the pipeline
`runPreReviewAdvisors` SHALL catch errors thrown by individual advisors, log a warning, and continue running remaining advisors without propagating the error.

#### Scenario: throwing advisor is logged and subsequent advisors still run
- **WHEN** the first advisor throws an error
- **THEN** a warning is logged naming the advisor
- **THEN** the second advisor is still called
- **THEN** `runPreReviewAdvisors` returns without throwing

### Requirement: handleTaskTerminal deduplicates concurrent same-taskId calls
`handleTaskTerminal` SHALL return the in-flight promise for a given task ID when called concurrently for the same task, ensuring dependency resolution runs exactly once per terminal event.

#### Scenario: concurrent calls for same taskId share one in-flight promise
- **WHEN** `handleTaskTerminal` is called twice concurrently for the same task ID
- **THEN** both calls receive the same promise
- **THEN** the underlying execution is only invoked once

### Requirement: handleTaskTerminal clears the in-flight entry after resolution
`handleTaskTerminal` SHALL remove the task ID from the in-flight map after the work resolves, allowing a subsequent call for the same task to execute independently.

#### Scenario: subsequent call after resolution fires a new execution
- **WHEN** a first `handleTaskTerminal` call resolves
- **WHEN** a second `handleTaskTerminal` call is made for the same task ID
- **THEN** the second call fires a new execution

### Requirement: handleTaskTerminal records correct metrics by terminal status
`handleTaskTerminal` SHALL increment `agentsCompleted` for `done` and `review` statuses, and `agentsFailed` for `failed` and `error` statuses.

#### Scenario: done status increments agentsCompleted
- **WHEN** `handleTaskTerminal` is called with status `'done'`
- **THEN** `metrics.increment` is called with `'agentsCompleted'`

#### Scenario: failed status increments agentsFailed
- **WHEN** `handleTaskTerminal` is called with status `'failed'`
- **THEN** `metrics.increment` is called with `'agentsFailed'`

### Requirement: handleTaskTerminal delegates to onStatusTerminal when configured
When `config.onStatusTerminal` is set, `handleTaskTerminal` SHALL call it instead of invoking `resolveDependents`.

#### Scenario: onStatusTerminal is called when configured
- **WHEN** `config.onStatusTerminal` is a function
- **THEN** `config.onStatusTerminal` is called with the task ID and status
- **THEN** `resolveDependents` is not called
