## ADDED Requirements

### Requirement: Single chokepoint for terminal status writes

The system SHALL route every write that sets `sprint_tasks.status` to a terminal value (`failed`, `error`, `done`, `cancelled`, or `review`) through `TaskStateService.transition()`. Direct calls to `repo.updateTask({ status: <terminal> })` SHALL NOT exist outside `TaskStateService` itself.

#### Scenario: Static check passes after Phase A merges
- **WHEN** the audit script runs `grep -rE "updateTask\(\s*[^,]+,\s*\{[^}]*status:\s*['\"](failed|error|done|cancelled|review)['\"]"` over `src/main/`
- **THEN** the only matches are inside `src/main/services/task-terminal-service.ts` (or its successor service file)

#### Scenario: Exhausted-orphan path resolves dependents
- **WHEN** an orphaned task hits the orphan-recovery cap and is marked `error`
- **THEN** `onTaskTerminal(taskId, 'error')` fires exactly once and `resolveDependents` is invoked for that task

#### Scenario: Failure-resolution DB write failure does not falsely report terminal
- **WHEN** `resolveFailure` calls `updateTask` and the call throws
- **THEN** `onTaskTerminal` is NOT invoked and the caller observes the failure (rejected promise or `false` return)

#### Scenario: `transitionToReview` falls back to `failed` on transition exception
- **WHEN** `transitionToReview` calls `taskStateService.transition(taskId, 'review', ...)` and the call throws
- **THEN** the function calls `taskStateService.transition(taskId, 'failed', { failure_reason: 'review-transition-failed' })` and emits a `review-transition.fallback` structured event

### Requirement: Hard-fail on git preconditions, not assumed success

The system SHALL transition a task to `failed` (with a structured `failure_reason`) when a git precondition check fails during success resolution. The system SHALL NOT promote a task to `review` based on the absence of evidence that commits exist.

#### Scenario: `git rev-list` failure transitions to failed
- **WHEN** `git rev-list --count origin/main..<branch>` rejects during `resolveSuccess`
- **THEN** the task transitions to `failed` with `failure_reason: 'git-precondition-failed'` and is NOT promoted to `review`

#### Scenario: Auto-commit failure transitions to failed
- **WHEN** `autoCommitPendingChanges` rejects during `resolveSuccess`
- **THEN** the task transitions to `failed` with `failure_reason: 'auto-commit-failed'` and the rebase phase does NOT run

### Requirement: Watchdog cleanup precedes next claim for the same task

The system SHALL ensure that when the watchdog terminates an agent, the agent's worktree cleanup completes (or is observed to complete) before the drain loop is permitted to claim the same task again.

#### Scenario: Drain loop awaits in-flight cleanup
- **WHEN** the watchdog has initiated cleanup for `taskId` and the drain loop attempts to claim `taskId`
- **THEN** the drain loop awaits the in-flight cleanup promise before invoking `setupWorktree`

#### Scenario: `forceReleaseClaim` aborts before re-queue
- **WHEN** an operator invokes `sprint:forceReleaseClaim` on an `active` task with a live agent
- **THEN** the agent is cancelled (and confirmed removed from `activeAgents`) before the task status transitions to `queued`

### Requirement: Force-kill escalation reaches SIGKILL on shutdown

The system SHALL guarantee that the SIGKILL escalation timer in `forceKillAgent` is `ref`'d during application shutdown so the kill lands before process exit.

#### Scenario: BDE shutdown leaves no Claude child process
- **WHEN** an agent is mid-run and `agentManager.shutdown()` is called
- **THEN** the SIGKILL escalation runs and the child Claude process is observed to be gone before BDE exits

### Requirement: Crash-loop cap on orphan recovery

The system SHALL maintain a per-task orphan-recovery counter and SHALL transition a task to `error` once that counter exceeds a configured maximum, preventing infinite re-queue loops across BDE restarts.

#### Scenario: Task that crashes BDE three times reaches terminal error
- **WHEN** a task has been re-queued by orphan recovery `MAX_ORPHAN_RECOVERY_COUNT` times
- **THEN** the task transitions to `error` via `TaskStateService.transition()` (not via direct `updateTask`)

### Requirement: Bounded retry queues with structured exhaustion events

The system SHALL bound every in-memory retry/notify queue on a critical path by both (a) per-id attempt count and (b) total distinct-id count. Exhaustion or eviction SHALL emit a structured event so operators can observe the loss.

#### Scenario: Sprint PR poller pending-retry map is bounded
- **WHEN** systemic failure causes `pendingTerminalRetries` to grow toward its size cap
- **THEN** the oldest entry is evicted and a `terminal-retry.evicted` structured event is emitted with `taskId`

#### Scenario: Per-id attempt cap emits an event
- **WHEN** a task has reached `MAX_TERMINAL_RETRY_ATTEMPTS` and is dropped from the pending map
- **THEN** a `terminal-retry.exhausted` structured event is emitted with `taskId` and `attempts`

### Requirement: Drain-loop dep-index rebuild failure preserves dirty state

The system SHALL preserve `_depIndexDirty=true` when a full dependency-index rebuild fails, so the next drain tick retries the rebuild rather than falling back to a stale incremental state.

#### Scenario: Rebuild throw keeps dirty flag set
- **WHEN** `getTasksWithDependencies()` rejects inside the dirty-rebuild branch of the drain loop
- **THEN** `_depIndexDirty` remains `true` and `lastTaskDeps` is unchanged

### Requirement: `pendingSpawns` counter cannot leak

The system SHALL guarantee that the `pendingSpawns` counter is decremented for every increment, including when `onAgentRegistered` (or any post-spawn hook) throws.

#### Scenario: Throwing hook does not leak counter
- **WHEN** `onAgentRegistered` throws after `spawn-and-wire` has incremented `pendingSpawns`
- **THEN** `getPendingSpawns()` returns the same value it would have returned if the hook had succeeded

### Requirement: OAuth refresh is coordinated with the next spawn

The system SHALL NOT initiate a new agent spawn while an OAuth credential refresh triggered by an auth-failure detection is in flight.

#### Scenario: Spawn awaits in-flight refresh
- **WHEN** `message-consumer` initiates an OAuth refresh after detecting auth failure and the drain loop attempts a spawn
- **THEN** the spawn awaits the refresh promise (success or failure) before proceeding

### Requirement: Pre-spawn dirty-main failure cleans up the worktree

The system SHALL invoke worktree cleanup whenever a pre-spawn precondition (e.g. dirty main repo) causes the task to transition to `error` after the worktree was created.

#### Scenario: Worktree directory is removed on dirty-main failure
- **WHEN** `assertPreSpawnRepoState` rejects after `setupWorktree` succeeded for the task
- **THEN** `cleanupWorktreeWithRetry` is invoked for that worktree before the task transitions to `error`

### Requirement: `setupWorktree` never leaks the lock

The system SHALL hold the worktree setup lock inside a try/finally so the lock is released on every exit path, including throws inside the locked region.

#### Scenario: Throw inside locked region releases the lock
- **WHEN** `addWorktree` rejects after `acquireLock` succeeded
- **THEN** `releaseLock` is observed to be called exactly once before the function rejects

### Requirement: `readQueueDepth` distinguishes empty from broken

The system SHALL distinguish a successful zero-depth read from a stats-query failure when reporting drain-pause `affectedTaskCount`. A stats failure SHALL surface as "unknown" (not as zero).

#### Scenario: Stats query failure surfaces unknown
- **WHEN** `getQueueStats()` rejects during a drain-pause broadcast
- **THEN** the broadcast payload reports `affectedTaskCount: null` (or equivalent unknown sentinel) and the failure is logged at WARN

### Requirement: Direct test coverage on high-blast-radius state mutators

The system SHALL maintain ≥90% line and branch coverage on the following functions, enforced in the vitest config: `updateTaskFromUi`, `transitionToReview`, `handleWatchdogVerdict`, `resolveNodeExecutable`, and each per-agent prompt builder (`buildAssistantPrompt`, `buildCopilotPrompt`, `buildSynthesizerPrompt`).

#### Scenario: `updateTaskFromUi` has direct unit tests
- **WHEN** the test suite runs
- **THEN** `sprint-use-cases.update.test.ts` (or equivalent) exists and exercises allowlist rejection, status narrowing, queued→blocked auto-block trigger, and rollback on validation failure — at least 10 cases

#### Scenario: `transitionToReview` has direct unit tests
- **WHEN** the test suite runs
- **THEN** `review-transition.test.ts` exists and exercises happy path, diff-snapshot failure, rebase fields present/absent, and the fallback-to-`failed` path defined above

#### Scenario: `handleWatchdogVerdict` has direct unit tests for all four verdict branches
- **WHEN** the test suite runs
- **THEN** `watchdog-handler.test.ts` exists and contains at least one test per verdict (`max-runtime`, `idle`, `rate-limit-loop`, `cost-budget-exceeded`) asserting `taskUpdate` shape and concurrency mutations

#### Scenario: `resolveNodeExecutable` has tests for fnm/nvm/Homebrew probing
- **WHEN** the test suite runs
- **THEN** `resolve-node.test.ts` exists and exercises each probed install location and asserts the highest-version selection rule

#### Scenario: Per-agent prompt builders have boundary-tag injection tests
- **WHEN** the test suite runs
- **THEN** each of `prompt-assistant`, `prompt-copilot`, `prompt-synthesizer` has at least one test that injects `</user_spec>` (or analogous boundary-tag close) into user-controlled content and asserts the boundary tags survive intact

### Requirement: `createTaskWithValidation` auto-blocking branch is asserted

The system SHALL include a test that asserts a newly-created task with at least one unsatisfied hard dependency is set to `blocked` (not `queued`) at creation time.

#### Scenario: Hard-dep-on-non-done task starts blocked
- **WHEN** `createTaskWithValidation` is called with `depends_on: [{id: <upstream>, type: 'hard'}]` and the upstream task is not in `done`
- **THEN** the persisted task has `status: 'blocked'`

### Requirement: `sprint-export-handlers` has direct tests

The system SHALL include direct tests for `sprint-export-handlers` covering happy path, empty result, malformed input, and IO failure.

#### Scenario: Export handler test file exists with minimum cases
- **WHEN** the test suite runs
- **THEN** at least four cases exist for `sprint-export-handlers`: success, empty, malformed input, IO failure
