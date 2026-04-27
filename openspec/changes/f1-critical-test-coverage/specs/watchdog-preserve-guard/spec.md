## ADDED Requirements

### Requirement: watchdog skips worktree cleanup when task is in review status
The test suite SHALL verify that `runWatchdog` does not invoke `cleanupAgentWorktree` when the killed agent's task has `status: 'review'`, preserving the worktree for human inspection.

#### Scenario: review-status task — cleanup not called
- **WHEN** a watched agent's task has `status: 'review'` at the time of the watchdog kill
- **THEN** `cleanupAgentWorktree` is NOT called for that agent

### Requirement: watchdog invokes worktree cleanup when task is not in review status
The test suite SHALL verify that `runWatchdog` calls `cleanupAgentWorktree` with the agent when the task is in any non-review status (e.g., `'active'`).

#### Scenario: active-status task — cleanup invoked with agent
- **WHEN** a watched agent's task has `status: 'active'` at the time of the watchdog kill
- **THEN** `cleanupAgentWorktree` is called with the agent as its argument
