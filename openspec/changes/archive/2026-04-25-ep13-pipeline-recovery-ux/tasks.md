## 1. Drain-Paused Banner in SprintPipeline

- [x] 1.1 Find how Dashboard reads drain-paused state — check `sprintUI` store or `useManagerEventListener`
- [x] 1.2 Ensure `drainPausedUntil` timestamp is stored in `sprintUI` store when drain-pause event fires
- [x] 1.3 Render drain-paused banner in `SprintPipeline.tsx` using the same pattern as Dashboard
- [x] 1.4 Add backoff countdown: compute `Math.max(0, drainPausedUntil - now)` using `useNow()` hook

## 2. Force-Release Claim

- [x] 2.1 Add `sprint:forceReleaseClaim` channel to `src/shared/ipc-channels/`
- [x] 2.2 Add handler in `src/main/handlers/sprint-local.ts`: verify task is `active`, call `resetTaskForRetry(id)`, broadcast update
- [x] 2.3 Wire in `src/preload/index.ts`
- [x] 2.4 Add "Force Release" button in `TaskDetailDrawer` (or equivalent) — only visible on `active` tasks

## 3. Failure Reason Chip + Watchdog Verdict

- [x] 3.1 Create `failureChipForReason(reason: string): { label: string; color: string }` helper — maps `failure_reason` values to display categories
- [x] 3.2 Add chip to task card for tasks in the `failed` bucket with a `failure_reason`
- [x] 3.3 Show watchdog verdict in TaskDetailDrawer when available in task `notes` or `failure_reason`

## 4. WIP Cap Tooltip + "Agent Starting" Placeholder

- [x] 4.1 Add tooltip to the active-slot counter badge explaining the WIP cap and where to change it (Settings → Agents)
- [x] 4.2 Show "Agent starting…" indicator on tasks with `status === 'queued'` AND `claimed_by` set (the spawn window)

## 5. Empty Pipeline CTA

- [x] 5.1 Detect when the pipeline has zero tasks
- [x] 5.2 Show "Configure a repository" CTA when no repos configured; "Create your first task" CTA otherwise
- [x] 5.3 CTA buttons navigate to Settings (repo config) or open TaskWorkbenchModal

## 6. Verification

- [x] 6.1 `npm run typecheck` zero errors
- [x] 6.2 `npm test` all pass
- [x] 6.3 `npm run lint` zero errors
- [x] 6.4 Update `docs/modules/components/index.md` and `docs/modules/handlers/index.md` for changed files
