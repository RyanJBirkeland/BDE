# UX Nits Batch 2

**Issue:** #699 — User Feedback Suggestions (deferred items)  
**Date:** 2026-05-02

## Scope

Three low-effort UX fixes:

1. Quality score rubric tooltip in Code Review
2. "Review" pipeline chip tooltip clarifying its mixed contents
3. "Check now" drain loop trigger button in Task Pipeline

---

## Fix 1 — Quality Score Rubric Tooltip

### Problem

`ReviewMetricsRow` shows the AI reviewer's quality score as a bare number (e.g. `42`) with
label "Quality". Users saw the score drop from 80 to 42 across revisions but had no idea
what threshold separates "nit" from "block merge". There's no application-side threshold
driving auto-merge decisions — the score is advisory only.

### Solution

Add a `title` attribute to the quality score `MetricCard` in `ReviewMetricsRow.tsx`:

```
0–49: Significant issues — recommend requesting revision
50–74: Minor issues — review carefully before merging
75–100: Good quality — generally safe to merge
```

No data model change. The `MetricCard` component already accepts arbitrary props forwarded
to its container `<div>`. The tooltip applies only to the quality card, not issues or files.

### Files

| File | Change |
|---|---|
| `src/renderer/src/components/code-review/ReviewMetricsRow.tsx` | Add `title` prop to quality `MetricCard` |

---

## Fix 2 — "Review" Pipeline Chip Tooltip

### Problem

The pipeline header's `review` chip counts tasks in the `awaitingReview` partition.
That partition contains two distinct groups:
- Tasks with `status: 'review'` (agent completed, awaiting human code review)
- Tasks with `status: 'active' | 'done'` AND `pr_status: 'open'` (open PRs needing
  attention)

Users expected `review` to mean only "agent-completed" tasks, so open-PR tasks appearing
in the count was surprising.

### Solution

Add a `title` attribute to the "review" chip in the pipeline header. The `PipelineHeader`
component renders the filter chips; each chip is a button. Adding a `title` to the review
chip reads: `"Agent-completed tasks awaiting your review, plus tasks with open PRs"`.

No label rename (it's already "review"). No data model change.

### Files

| File | Change |
|---|---|
| `src/renderer/src/components/sprint/PipelineHeader.tsx` | Add `title` to the review chip button |

---

## Fix 3 — Drain Loop "Check Now" Button

### Problem

The drain loop polls for queued tasks on `pollIntervalMs` (default 30s). After queuing a
task, users watch the countdown wondering if the task was registered. A manual "check now"
trigger removes that friction and is also useful for debugging stalled queues.

### Solution

**IPC channel:** Add `'agent-manager:triggerDrain'` to `src/shared/ipc-channels/agent-channels.ts`
alongside the existing `agent-manager:*` channels. The handler in `agent-handlers.ts` calls
`agentManager.triggerDrain()` (a new public method on `AgentManagerImpl`) which directly
calls `this.tickDrain()`.

**UI:** A small `↻` icon button in the `PipelineHeader`, rendered to the right of the
existing chip row. Clicking it:
1. Calls `window.api.agentManager.triggerDrain()` via IPC
2. Shows a brief spinning state on the button (1.5s, CSS animation)
3. Returns to idle

The button is always enabled (no disabled state needed — `tickDrain` is already
re-entrant-safe via the drain loop's own concurrency guard). No loading feedback beyond
the brief spin is needed since ticks are fast.

**Preload bridge:** `window.api.agentManager.triggerDrain` added to `src/preload/index.ts`
alongside `agentManager.reloadConfig` and other manager methods.

### Files

| File | Change |
|---|---|
| `src/shared/ipc-channels/agent-channels.ts` | Add `'agent-manager:triggerDrain'` channel |
| `src/main/handlers/agent-handlers.ts` | Add handler for `agent-manager:triggerDrain` |
| `src/main/agent-manager/index.ts` | Add public `triggerDrain()` method |
| `src/preload/index.ts` | Expose `agentManager.triggerDrain()` on the bridge |
| `src/renderer/src/components/sprint/PipelineHeader.tsx` | Add ↻ button with spin animation |
| `src/renderer/src/components/sprint/PipelineHeader.css` | Add `.pipeline-header__trigger-btn` + spin keyframe |

---

## Testing

### Fix 1
- Render `ReviewMetricsRow` with `qualityScore={42}` — expect the quality metric card's
  container to have a `title` attribute containing "Significant issues"
- With `qualityScore={80}` — expect `title` to contain "Good quality"

### Fix 2
- Render `PipelineHeader` with a review chip — expect the review button to have a `title`
  attribute containing "open PRs"

### Fix 3
- Unit test: `AgentManagerImpl.triggerDrain()` calls `tickDrain` (spy/mock)
- Render test: `PipelineHeader` renders the ↻ button; clicking it calls
  `window.api.agentManager.triggerDrain`
- IPC handler test: `agent-manager:triggerDrain` handler calls `agentManager.triggerDrain()`

---

## What This Does Not Do

- Does not change the auto-merge threshold based on quality score (score remains advisory)
- Does not add a countdown timer showing time until next automatic drain tick
- Does not debounce or rate-limit the trigger button (the drain loop handles this internally)
