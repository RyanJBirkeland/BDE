## ADDED Requirements

### Requirement: Drain-paused banner in Sprint Pipeline
The system SHALL display a drain-paused banner in the Sprint Pipeline view when the drain loop is paused, matching the existing Dashboard behavior.

#### Scenario: Drain paused shows banner on Pipeline
- **WHEN** the drain loop enters a paused state
- **THEN** a banner appears in the Sprint Pipeline view with the pause reason and a countdown to resume

### Requirement: Force-release claim button
The system SHALL provide a force-release button on active tasks that re-queues the task via `resetTaskForRetry` without requiring manual database access.

#### Scenario: Force-release re-queues stuck active task
- **WHEN** a user clicks force-release on an active task with a stale agent
- **THEN** `sprint:forceReleaseClaim` is called, the task transitions to `queued`, and the pipeline updates

### Requirement: Failure reason chip on failed task cards
The system SHALL display a human-readable failure category chip on task cards in the failed bucket.

#### Scenario: Failed task shows failure chip
- **WHEN** a task is in the failed bucket and has a `failure_reason` value
- **THEN** the task card shows a color-coded chip with the failure category (e.g. "Timeout", "Auth", "OOM")

### Requirement: Empty pipeline has a call-to-action
The system SHALL display a helpful empty state in the Sprint Pipeline when there are no tasks, guiding the user toward creating their first task or configuring a repo.

#### Scenario: No tasks and no repos configured
- **WHEN** the pipeline has zero tasks and no repos are configured
- **THEN** the empty state shows a "Configure a repository" CTA

#### Scenario: No tasks but repos configured
- **WHEN** the pipeline has zero tasks and at least one repo is configured
- **THEN** the empty state shows a "Create your first task" CTA
