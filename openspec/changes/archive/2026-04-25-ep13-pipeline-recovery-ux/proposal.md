## Why

Users hit dead ends in the pipeline with no in-app path forward. The fast-fail exhausted message literally said "UPDATE sprint_tasks SET status='queued'" (fixed in wave 3, but the broader affordance gap remains). Active tasks with dead agents have no force-release button. The drain-paused banner only shows on Dashboard, not on the Pipeline view where users are watching their tasks. An empty pipeline has no call-to-action. The WIP cap badge has no explanation. Zombie/stale tasks have no inline recovery action.

## What Changes

- **Drain-paused banner** shown in SprintPipeline view (not just Dashboard)
- **Force-release claim button** on active tasks — calls `sprint:forceReleaseClaim` IPC, re-queues without manual SQL
- **Backoff countdown** shown when drain is paused — "Resuming in 28s"
- **"Agent starting…" placeholder** shown for tasks that are queued but not yet active (claimed but not streaming)
- **WIP cap explanation** on the slots badge — tooltip or inline text explaining the concurrency limit
- **Failure reason chip** on failed task cards — shows the classified failure category
- **Watchdog verdict** visible in task detail drawer
- **Inline recover action** on zombie/stale tasks — uses `resetTaskForRetry` (not raw SQL)
- **Empty pipeline state** pre-flights repo config and shows a CTA

## Capabilities

### New Capabilities

- `pipeline-recovery-affordances`: Force-release, drain-paused banner on Pipeline, backoff countdown, WIP cap explanation, failure chip, watchdog verdict, empty-state CTA

### Modified Capabilities

<!-- No behavioral changes — same operations, just surfaced in UI -->

## Impact

- `src/renderer/src/components/sprint/SprintPipeline.tsx` — drain-paused banner, empty state CTA, WIP cap tooltip
- `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` (or equivalent) — force-release button, watchdog verdict, failure chip
- `src/renderer/src/components/sprint/TaskPill.tsx` — failure chip, "agent starting" placeholder
- `src/main/handlers/sprint-local.ts` — `sprint:forceReleaseClaim` IPC handler
- `src/shared/ipc-channels/` — new channel
