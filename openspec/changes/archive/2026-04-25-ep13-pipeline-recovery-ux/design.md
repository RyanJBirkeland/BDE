## Context

The Sprint Pipeline view is the primary place users watch their work, but recovery affordances are scattered across the Dashboard (drain-paused banner), the Settings (worktree config), and raw SQLite. Users hit tasks stuck in `active` with no claimed agent and have no in-UI path to unstick them. The `failure_reason` field is populated by `classifyFailureReason` but never surfaced in the task card. The watchdog verdict (idle/timeout/rate-limit/cost) is logged but not shown in the drawer.

## Goals / Non-Goals

**Goals:**
- Drain-paused banner in SprintPipeline (copy from Dashboard pattern, use existing `drainPaused` store state)
- Backoff countdown: poll `drainPausedUntil` timestamp, compute remaining seconds, update every second
- Force-release: `sprint:forceReleaseClaim` IPC → `resetTaskForRetry(id)` → broadcast update
- "Agent starting…" indicator on tasks that have `claimed_by` set but `status === 'queued'` (the spawn window)
- WIP cap tooltip on the active slot counter
- `failure_reason` chip on failed task cards (truncated, colored by category)
- Watchdog verdict field in TaskDetailDrawer when present in task notes or a dedicated field
- Empty pipeline CTA: check if repos are configured, show appropriate message
- `resetTaskForRetry` IPC for the inline recover action (may already exist as `sprint:retry`)

**Non-Goals:**
- Orphaned worktree listing UI (EP-13's T-176 from the audit, deferred — complex filesystem interaction)
- DAG visualization overlay (T-161, deferred — requires graph rendering library)
- Bulk-action confirmation modals (T-158, deferred)

## Decisions

### D1: Drain-paused banner uses existing `sprintUI` drain state

The Dashboard already polls `agentManager:getDrainStatus`. SprintPipeline subscribes to the same IPC channel (already wired via `useManagerEventListener` or equivalent). No new store state needed — just render the banner when `drainPaused === true`.

### D2: Backoff countdown via `useNow()` + `drainPausedUntil`

`drainPausedUntil` timestamp (ms) is already broadcast in drain-pause events. Store it in `sprintUI`. Countdown computes `Math.max(0, drainPausedUntil - useNow())` — updates automatically at 10s resolution from the existing `useNow` hook. For sub-second accuracy, add a separate 1s interval only when the banner is visible.

### D3: Force-release is a thin IPC handler

`sprint:forceReleaseClaim` → `resetTaskForRetry(id)` in the handler. The handler checks the task is `active` (not `review`, not terminal) before resetting. Returns the updated task.

### D4: failure_reason chip uses FAILURE_PATTERNS category

`classifyFailureReason` returns a verdict string. Map verdicts to display categories: `auth-error` → "Auth", `timeout` → "Timeout", `rate-limit` → "Rate limit", `oom` → "OOM", etc. Use a `Record<string, { label, color }>` lookup with an "Unknown" fallback.

## Risks / Trade-offs

- **Risk**: Force-release on a live agent that just hasn't reported yet → Mitigation: the handler confirms `status === 'active'` and `claimed_by` is set; the agent will still be running and will write its result to a re-queued task, which will be a no-op since `claimed_by` won't match
- **Trade-off**: 10s countdown granularity from `useNow()` is coarse — acceptable for a "resuming in ~28s" UX; exact countdown would require a separate 1s interval
