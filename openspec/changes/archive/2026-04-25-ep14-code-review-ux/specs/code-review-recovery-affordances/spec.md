## ADDED Requirements

### Requirement: Conflict state has a resolution path
The system SHALL display an actionable path when a task's branch has merge conflicts, rather than only disabling the Merge action.

#### Scenario: Conflicting branch shows Open in IDE button
- **WHEN** a task in Code Review has `pr_mergeable_state === 'CONFLICTING'`
- **THEN** an "Open in IDE" button is shown that opens the worktree in the IDE view

### Requirement: GitHub unconfigured shows Connect CTA
The system SHALL show an inline "Connect GitHub" button when Ship It is disabled due to missing GitHub configuration, rather than only a tooltip.

#### Scenario: No GitHub config shows Connect button
- **WHEN** Ship It is disabled because `githubOwner` or `githubRepo` is not configured
- **THEN** a "Connect GitHub" button is shown that navigates to Settings → Connections

### Requirement: Mark Shipped Outside FLEET action
The system SHALL provide a "Mark Shipped" action that transitions a task to `done` without requiring a local merge or PR, for users who shipped via the command line.

#### Scenario: Mark Shipped transitions task to done
- **WHEN** a user clicks "Mark Shipped Outside FLEET"
- **THEN** `review:markShippedOutsideFleet` is called, the task transitions to `done`, and dependency resolution fires

### Requirement: Revision request cap
The system SHALL disable the Request Revision action and show the current count when `revision_count >= MAX_REVISION_ATTEMPTS`.

#### Scenario: Revision cap reached disables button
- **WHEN** a task has `revision_count >= 5`
- **THEN** the Request Revision button is disabled with a label showing "Max revisions (5/5)"

### Requirement: Discard shows a confirmation modal
The system SHALL show a confirmation modal before discarding a task, with explicit permanence messaging.

#### Scenario: Discard requires confirmation
- **WHEN** a user clicks Discard
- **THEN** a modal appears with "This cannot be undone" language before the discard proceeds
