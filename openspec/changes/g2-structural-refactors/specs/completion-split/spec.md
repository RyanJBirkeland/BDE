## ADDED Requirements

### Requirement: success pipeline lives in its own module
`src/main/agent-manager/success-pipeline.ts` SHALL export `SuccessPhase`, `SuccessPhaseContext`, `PipelineAbortError`, the `successPhases` array, and the `resolveSuccess` function. It SHALL NOT export `PreReviewAdvisor`, `appendAdvisoryNote`, `verifyBranchTipOrFail`, or `verifyWorktreeOrFail`.

#### Scenario: resolveSuccess dispatches all phases
- **WHEN** `resolveSuccess` is called with a valid context
- **THEN** each phase in `successPhases` runs in order until one throws `PipelineAbortError` or all phases complete

#### Scenario: PipelineAbortError halts the pipeline cleanly
- **WHEN** a phase throws `PipelineAbortError`
- **THEN** `resolveSuccess` returns without throwing and skips all subsequent phases

#### Scenario: unexpected errors propagate
- **WHEN** a phase throws an error that is not `PipelineAbortError`
- **THEN** `resolveSuccess` rethrows the error to its caller

### Requirement: pre-review advisors live in their own module
`src/main/agent-manager/pre-review-advisors.ts` SHALL export `PreReviewAdvisor`, `PreReviewAdvisorContext`, and `runPreReviewAdvisors`. It SHALL own the `preReviewAdvisors` registry array and the two built-in advisors (`untouchedTestsAdvisor`, `unverifiedFactsAdvisor`).

#### Scenario: all registered advisors are called
- **WHEN** `runPreReviewAdvisors` is called
- **THEN** every advisor in the registry has its `advise` method called with the provided context

#### Scenario: advisory warning is appended to task notes
- **WHEN** an advisor returns a non-null warning string
- **THEN** `runPreReviewAdvisors` calls `appendAdvisoryNote` with that warning

#### Scenario: flaky advisor does not stall the pipeline
- **WHEN** an advisor throws an error
- **THEN** `runPreReviewAdvisors` logs a warning and continues running remaining advisors

### Requirement: verification gates live in their own module
`src/main/agent-manager/verification-gate.ts` SHALL export `verifyBranchTipOrFail`, `verifyWorktreeOrFail`, and `appendAdvisoryNote`. These are the functions that either pass the task to the next phase or fail/requeue it.

#### Scenario: verifyBranchTipOrFail returns true when tip matches
- **WHEN** `verifyBranchTipOrFail` is called and the branch tip references the task id
- **THEN** it returns `true` without writing any status change

#### Scenario: verifyBranchTipOrFail returns false on mismatch and transitions task to failed
- **WHEN** `verifyBranchTipOrFail` detects a `BranchTipMismatchError`
- **THEN** it transitions the task to `failed` status and returns `false`

#### Scenario: verifyWorktreeOrFail returns true when build and tests pass
- **WHEN** `verifyWorktreeOrFail` is called and `verifyWorktreeBuildsAndTests` returns `ok: true`
- **THEN** it returns `true` without modifying task status

#### Scenario: verifyWorktreeOrFail requeues task on build failure
- **WHEN** `verifyWorktreeOrFail` is called and `verifyWorktreeBuildsAndTests` returns a failure
- **THEN** it calls `resolveFailurePhase` and returns `false`

### Requirement: completion.ts is a backward-compatible barrel
`src/main/agent-manager/completion.ts` SHALL re-export all public symbols from `success-pipeline.ts`, `pre-review-advisors.ts`, and `verification-gate.ts`, plus `deleteAgentBranchBeforeRetry`, `findOrCreatePR`, `resolveFailure`, `ResolveSuccessContext`, and `ResolveFailureContext`/`ResolveFailureResult`. It SHALL contain no business logic.

#### Scenario: existing imports from completion.ts continue to resolve
- **WHEN** any file imports `resolveSuccess`, `resolveFailure`, `findOrCreatePR`, `deleteAgentBranchBeforeRetry`, or the public types from `completion.ts`
- **THEN** the import resolves to the implementation in the appropriate sub-module without requiring the caller to change
