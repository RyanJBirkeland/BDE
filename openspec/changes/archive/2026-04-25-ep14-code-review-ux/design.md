## Context

`ReviewActions` has four actions: Merge Locally, Create PR, Request Revision, Discard. Merge Locally is disabled when `pr_mergeable_state === 'CONFLICTING'`, but no path is offered. Create PR (Ship It) is disabled when `githubOwner`/`githubRepo` aren't configured in Settings, with only a tooltip. The `revision_count` field on tasks tracks how many revisions have been requested, but the UI doesn't read it. Discard calls `onDiscard` immediately without a confirmation modal.

## Goals / Non-Goals

**Goals:**
- Conflict state: show "Open in IDE" (navigate to IDE view with the worktree path) and optionally a "Resolve with Agent" revision button
- Connect GitHub CTA: when Ship It is disabled due to config, show a button that navigates to Settings → Connections tab
- `review:markShippedOutsideFleet` IPC: sets `status = 'done'`, `completed_at = now()`, clears `claimed_by` — matches what Merge Locally does minus the actual git operations
- Revision cap: read `revision_count` from task; when `>= MAX_REVISION_ATTEMPTS` (5), disable Request Revision and show "Max revisions reached (5/5)"
- Discard modal: replace immediate `onDiscard` call with a `ConfirmModal` — "Discard this task? The worktree will be deleted. This cannot be undone."
- Empty Code Review view: "No tasks awaiting review. Tasks will appear here when agents complete their work." + link to Pipeline

**Non-Goals:**
- Auto-conflict resolution (just surface the IDE path + agent option)
- Changing the revision feedback format
- Adding PR review comments or inline annotation UI

## Decisions

### D1: Conflict path uses IDE navigation via existing view-switch mechanism

`openInIDE(worktreePath)` is achievable via `useIdeStore` or the existing `ide:openFolder` IPC. The "Open in IDE" button calls this and switches to the IDE view. No new IPC needed.

### D2: Mark Shipped Outside FLEET is a thin IPC handler

`review:markShippedOutsideFleet(taskId)` → `TaskStateService.transition(taskId, 'done', { fields: { completed_at: new Date().toISOString() } })`. Returns the updated task. The same dep-resolution cascade fires as with Merge Locally.

### D3: Revision cap reads `revision_count` field

`revision_count` is already on `SprintTask` (populated by the revision handler). Read it in `ReviewActions`. When `>= MAX_REVISION_ATTEMPTS`, the Request Revision button is disabled with a tooltip showing the count.

### D4: Discard uses existing `ConfirmModal` primitive

`ConfirmModal` already exists at `src/renderer/src/components/ui/`. Use it with `title="Discard task?"`, `body="The agent's worktree will be permanently deleted. This cannot be undone."`, `confirmLabel="Discard"`, `destructive={true}`.

## Risks / Trade-offs

- **Risk**: `revision_count` field may not be in the `MUTABLE_TASK_FIELDS` allowlist (EP-11) → Mitigation: add it if missing
- **Trade-off**: "Resolve with Agent" spawns a revision which re-queues the task — if the conflict is in a file the agent can't resolve, it just fails again. Document the limitation in the button tooltip.
