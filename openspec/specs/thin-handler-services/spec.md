## ADDED Requirements

### Requirement: review:checkFreshness delegates to a service

The `review:checkFreshness` IPC handler SHALL contain no git operations. All git logic (fetch, SHA comparison, commit count) SHALL live in `checkReviewFreshness(taskId, env)` in `review-orchestration-service.ts`. The handler SHALL validate the task ID, call the service, and return its result.

#### Scenario: Handler is thin
- **WHEN** `review:checkFreshness` is invoked
- **THEN** the handler body is ≤5 lines (validate ID → call `reviewOrchestration.checkReviewFreshness` → return)

#### Scenario: Service returns fresh status
- **WHEN** `checkReviewFreshness` is called and origin/main SHA matches `task.rebase_base_sha`
- **THEN** it returns `{ status: 'fresh', commitsBehind: 0 }`

#### Scenario: Service returns stale status
- **WHEN** `checkReviewFreshness` is called and origin/main has advanced past `task.rebase_base_sha`
- **THEN** it returns `{ status: 'stale', commitsBehind: <n> }` where n is the count of commits between the stored SHA and origin/main

#### Scenario: Service returns unknown when task has no rebase_base_sha
- **WHEN** `checkReviewFreshness` is called for a task with no `rebase_base_sha`
- **THEN** it returns `{ status: 'unknown' }`

#### Scenario: Service returns unknown when git operations fail
- **WHEN** `checkReviewFreshness` is called and git fetch or rev-parse throws
- **THEN** it returns `{ status: 'unknown' }` without propagating the error

---

### Requirement: review:markShippedOutsideBde delegates to a service

The `review:markShippedOutsideBde` IPC handler SHALL contain no status validation or state transition logic. Those SHALL live in `markShippedOutsideBde(taskId, deps)` in `review-orchestration-service.ts`. The handler SHALL validate the task ID, call the service, and return its result.

#### Scenario: Handler is thin
- **WHEN** `review:markShippedOutsideBde` is invoked
- **THEN** the handler body is ≤5 lines (validate ID → call `reviewOrchestration.markShippedOutsideBde` → return)

#### Scenario: Service transitions task to done
- **WHEN** `markShippedOutsideBde` is called for a task in `review` status
- **THEN** the task transitions to `done` with `completed_at` set and the service returns `{ success: true }`

#### Scenario: Service rejects non-review tasks
- **WHEN** `markShippedOutsideBde` is called for a task not in `review` status
- **THEN** it throws an error identifying the task and its current status

---

### Requirement: sprint:claimTask delegates to a service

The `sprint:claimTask` IPC handler SHALL contain no template lookup logic. Template enrichment SHALL live in `buildClaimedTask(taskId)` in `sprint-service.ts`. The handler SHALL call `buildClaimedTask` and return its result.

#### Scenario: Handler is thin
- **WHEN** `sprint:claimTask` is invoked
- **THEN** the handler body is ≤5 lines (validate ID → call `buildClaimedTask` → return)

#### Scenario: Service returns task enriched with template prefix
- **WHEN** `buildClaimedTask` is called for a task that has a `template_name` matching a configured template
- **THEN** it returns a `ClaimedTask` with `templatePromptPrefix` set to the template's `promptPrefix`

#### Scenario: Service returns task with null prefix when no template matches
- **WHEN** `buildClaimedTask` is called for a task with no `template_name` or no matching template
- **THEN** it returns a `ClaimedTask` with `templatePromptPrefix: null`

#### Scenario: Service returns null for unknown task
- **WHEN** `buildClaimedTask` is called with a task ID that does not exist
- **THEN** it returns `null`

---

### Requirement: sprint:forceReleaseClaim delegates to a service

The `sprint:forceReleaseClaim` IPC handler SHALL contain no orchestration logic. The cancel-reset-transition-notify sequence SHALL live in `forceReleaseClaim(taskId, deps)` in `sprint-service.ts`. The handler SHALL validate the task ID, call the service, and return the updated task.

#### Scenario: Handler is thin
- **WHEN** `sprint:forceReleaseClaim` is invoked
- **THEN** the handler body is ≤5 lines (validate ID → call `forceReleaseClaim` → return)

#### Scenario: Service releases an active task
- **WHEN** `forceReleaseClaim` is called for an `active` task
- **THEN** the running agent is cancelled (if `cancelAgent` is provided), `resetTaskForRetry` is called, the task transitions to `queued`, `notifySprintMutation` fires with the updated task, and the updated task is returned

#### Scenario: Service rejects non-active tasks
- **WHEN** `forceReleaseClaim` is called for a task not in `active` status
- **THEN** it throws an error identifying the task's actual status

---

### Requirement: sprint:retry delegates to a service

The `sprint:retry` IPC handler SHALL contain no git cleanup or state management logic. All retry logic (status guard, repo lookup, worktree prune, branch deletion, state reset, status transition) SHALL live in `retryTask(taskId)` in `sprint-service.ts`. The handler SHALL validate the task ID, call the service, and return the updated task.

#### Scenario: Handler is thin
- **WHEN** `sprint:retry` is invoked
- **THEN** the handler body is ≤5 lines (validate ID → call `retryTask` → return)

#### Scenario: Service re-queues a failed task
- **WHEN** `retryTask` is called for a task in `failed`, `error`, or `cancelled` status
- **THEN** stale terminal fields are cleared, the task transitions to `queued`, and the updated task is returned

#### Scenario: Service rejects non-terminal tasks
- **WHEN** `retryTask` is called for a task not in `failed`, `error`, or `cancelled` status
- **THEN** it throws an error identifying the task's actual status

#### Scenario: Git cleanup runs best-effort
- **WHEN** `retryTask` is called and git worktree prune or branch deletion fails
- **THEN** the error is swallowed and the retry proceeds normally
