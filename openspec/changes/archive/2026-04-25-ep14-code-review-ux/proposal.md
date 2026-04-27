## Why

The Code Review Station has several dead-end states with no in-UI resolution path. A branch with conflicts locks out both Merge Locally and Rebase with no path forward — the user has to know to open a terminal. Ship It is disabled with only a tooltip when GitHub isn't configured, but there's no inline CTA to connect it. Users who merged a branch in a terminal have no way to mark the task done without using raw SQL. The empty Code Review queue has no guidance. Revision requests have no cap — a task could be revised indefinitely. Discard shows no warning about permanence.

## What Changes

- **Conflict resolution path**: when a branch has conflicts, show an "Open in IDE" link and optionally an "Auto-resolve with Agent" button that spawns a revision
- **Connect GitHub CTA**: when Ship It is disabled due to unconfigured GitHub, show an inline "Connect GitHub" button that navigates to Settings → Connections
- **Mark Shipped Outside FLEET**: first-class action alongside Merge Locally / Create PR — marks task `done` without requiring a local merge or PR
- **Revision cap + rollup**: after N revision requests (configurable, default 5), disable Request Revision and show a rollup of prior feedback
- **Discard permanence messaging**: confirmation modal with explicit "this cannot be undone" language
- **Empty Code Review CTA**: when queue is empty, show "No tasks awaiting review" with a link to the Pipeline

## Capabilities

### New Capabilities

- `code-review-recovery-affordances`: Connect GitHub CTA, Mark Shipped Outside FLEET, conflict path, revision cap, discard confirmation

### Modified Capabilities

<!-- No behavioral changes — same operations, better UX guardrails -->

## Impact

- `src/renderer/src/components/code-review/ReviewActions.tsx` — new actions, revision cap, discard modal
- `src/renderer/src/components/code-review/ReviewDetail.tsx` — conflict state rendering, empty state
- `src/renderer/src/views/CodeReviewView.tsx` — empty state CTA
- `src/main/handlers/review-handlers.ts` (or equivalent) — `review:markShippedOutsideFleet` IPC
- `src/shared/ipc-channels/` — new channel
