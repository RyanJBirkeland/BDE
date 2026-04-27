## ADDED Requirements

### Requirement: Git operations have explicit timeouts
The system SHALL apply a `GIT_EXEC_TIMEOUT_MS` (30 seconds) deadline to every `execFileAsync('git', …)` call in the agent completion and review-transition paths.

#### Scenario: Slow git operation times out
- **WHEN** a `git push` or `git merge` takes longer than `GIT_EXEC_TIMEOUT_MS`
- **THEN** the operation throws a timeout error, the completion path retries via the existing failure handler, and the agent is not left waiting indefinitely

### Requirement: No-op detection logs changed files
The system SHALL log the `changedFiles` array (even when empty) when the no-op guard fires during completion.

#### Scenario: No-op guard fires with empty diff
- **WHEN** the agent's worktree has no changed files
- **THEN** a structured log event includes `{ changedFiles: [], reason: 'no-op' }` so operators can distinguish intentional no-ops from detection bugs

### Requirement: PreReviewAdvisor chain is pluggable
The system SHALL provide a `PreReviewAdvisor` interface. Existing advisory checks (untouched tests, unverified external references) SHALL be registered as implementations. New advisors SHALL be addable without modifying the orchestrator.

#### Scenario: Advisory check appends warning to notes
- **WHEN** a `PreReviewAdvisor` returns a non-null warning string
- **THEN** the warning is appended to `task.notes` before the review transition, and the transition proceeds regardless
