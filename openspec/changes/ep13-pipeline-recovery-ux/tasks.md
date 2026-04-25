## 1. Drain-Paused Banner in SprintPipeline

- [ ] 1.1 Find how Dashboard reads drain-paused state — check `sprintUI` store or `useManagerEventListener`
- [ ] 1.2 Ensure `drainPausedUntil` timestamp is stored in `sprintUI` store when drain-pause event fires
- [ ] 1.3 Render drain-paused banner in `SprintPipeline.tsx` using the same pattern as Dashboard
- [ ] 1.4 Add backoff countdown: compute `Math.max(0, drainPausedUntil - now)` using `useNow()` hook

## 2. Force-Release Claim

- [ ] 2.1 Add `sprint:forceReleaseClaim` channel to `src/shared/ipc-channels/`
- [ ] 2.2 Add handler in `src/main/handlers/sprint-local.ts`: verify task is `active`, call `resetTaskForRetry(id)`, broadcast update
- [ ] 2.3 Wire in `src/preload/index.ts`
- [ ] 2.4 Add "Force Release" button in `TaskDetailDrawer` (or equivalent) — only visible on `active` tasks

## 3. Failure Reason Chip + Watchdog Verdict

- [ ] 3.1 Create `failureChipForReason(reason: string): { label: string; color: string }` helper — maps `failure_reason` values to display categories
- [ ] 3.2 Add chip to task card for tasks in the `failed` bucket with a `failure_reason`
- [ ] 3.3 Show watchdog verdict in TaskDetailDrawer when available in task `notes` or `failure_reason`

## 4. WIP Cap Tooltip + "Agent Starting" Placeholder

- [ ] 4.1 Add tooltip to the active-slot counter badge explaining the WIP cap and where to change it (Settings → Agents)
- [ ] 4.2 Show "Agent starting…" indicator on tasks with `status === 'queued'` AND `claimed_by` set (the spawn window)

## 5. Empty Pipeline CTA

- [ ] 5.1 Detect when the pipeline has zero tasks
- [ ] 5.2 Show "Configure a repository" CTA when no repos configured; "Create your first task" CTA otherwise
- [ ] 5.3 CTA buttons navigate to Settings (repo config) or open TaskWorkbenchModal

## 6. Verification

- [ ] 6.1 `npm run typecheck` zero errors
- [ ] 6.2 `npm test` all pass
- [ ] 6.3 `npm run lint` zero errors
- [ ] 6.4 Update `docs/modules/components/index.md` and `docs/modules/handlers/index.md` for changed files
