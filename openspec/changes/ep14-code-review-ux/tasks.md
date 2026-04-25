## 1. Conflict Resolution Path

- [ ] 1.1 Find where `pr_mergeable_state` is checked in ReviewActions or ReviewDetail
- [ ] 1.2 When state is `CONFLICTING`: show "Open in IDE" button — call `ide:openFolder` IPC with the worktree path and switch to IDE view
- [ ] 1.3 Optionally add "Resolve with Agent" button that calls `onRequestRevision` with a pre-filled conflict resolution prompt
- [ ] 1.4 Commit: `feat(code-review): conflict resolution path with Open in IDE (EP-14)`

## 2. Connect GitHub CTA + Mark Shipped Outside BDE

- [ ] 2.1 Find where Ship It is disabled due to missing GitHub config in ReviewActions
- [ ] 2.2 Replace disabled tooltip with an inline "Connect GitHub →" button that navigates to Settings → Connections
- [ ] 2.3 Add `review:markShippedOutsideBde` channel to `src/shared/ipc-channels/`
- [ ] 2.4 Add handler: `TaskStateService.transition(taskId, 'done', { fields: { completed_at: new Date().toISOString() } })` + worktree cleanup
- [ ] 2.5 Wire in preload; add "Mark Shipped Outside BDE" button in ReviewActions
- [ ] 2.6 Commit: `feat(code-review): Connect GitHub CTA and Mark Shipped Outside BDE (EP-14)`

## 3. Revision Cap + Discard Modal

- [ ] 3.1 Read `revision_count` from task in ReviewActions; add `revision_count` to `MUTABLE_TASK_FIELDS` if missing (src/renderer/src/stores/sprintTasks.ts)
- [ ] 3.2 When `revision_count >= MAX_REVISION_ATTEMPTS` (5): disable Request Revision, show "Max revisions (5/5)"
- [ ] 3.3 Replace immediate `onDiscard` call with `ConfirmModal` — "Discard this task? The worktree will be permanently deleted. This cannot be undone." with a destructive confirm button
- [ ] 3.4 Commit: `feat(code-review): revision cap and discard confirmation modal (EP-14)`

## 4. Empty State CTA

- [ ] 4.1 Detect empty Code Review queue in `CodeReviewView.tsx`
- [ ] 4.2 Show "No tasks awaiting review. Tasks appear here when agents complete their work." + "Go to Pipeline" link
- [ ] 4.3 Commit: `feat(code-review): empty state CTA (EP-14)`

## 5. Verification + Docs

- [ ] 5.1 `npm run typecheck` zero errors
- [ ] 5.2 `npm test` all pass
- [ ] 5.3 `npm run lint` zero errors
- [ ] 5.4 Update `docs/modules/components/index.md` and `docs/modules/handlers/index.md`
- [ ] 5.5 Commit: `chore(docs): update module index for EP-14`
