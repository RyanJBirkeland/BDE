## 1. Database Migration

- [x] 1.1 Add a new migration in `src/main/migrations/` — `ALTER TABLE sprint_tasks ADD COLUMN orphan_recovery_count INTEGER NOT NULL DEFAULT 0`
- [x] 1.2 Add a migration test in `src/main/migrations/__tests__/` verifying the column exists with default 0
- [x] 1.3 Add `orphan_recovery_count` to `SprintTask` type in `src/shared/types/` and to `mapRowToTask` in `sprint-task-mapper.ts`

## 2. Orphan Recovery Cap

- [x] 2.1 Read `src/main/agent-manager/orphan-recovery.ts` fully before editing
- [x] 2.2 Add `MAX_ORPHAN_RECOVERY_COUNT = 3` constant
- [x] 2.3 For each orphaned task: if `orphan_recovery_count >= MAX_ORPHAN_RECOVERY_COUNT`, call `TaskStateService.transition(id, 'error', { fields: { failure_reason: 'exhausted: orphan recovery cap reached' } })` instead of `resetTaskForRetry`
- [x] 2.4 Otherwise: increment `orphan_recovery_count` via `repo.updateTask(id, { orphan_recovery_count: task.orphan_recovery_count + 1 })` then call `resetTaskForRetry`
- [x] 2.5 Enrich recovery log: include `taskId`, `priorStatus`, `retryCount`, `startedAt` per task
- [x] 2.6 Add module-level boolean to suppress duplicate "has PR, clearing claimed_by" log after first per session
- [x] 2.7 Unit tests: task under cap → re-queued + counter incremented; task at cap → `error` + not re-queued

## 3. orphan:recovered Broadcast + UI Banner

- [x] 3.1 Define `orphan:recovered` channel in `src/shared/ipc-channels/` with payload `{ recovered: string[], exhausted: string[] }`
- [x] 3.2 Wire `onBroadcast('orphan:recovered')` in `src/preload/index.ts`
- [x] 3.3 Broadcast from `src/main/index.ts` after `recoverOrphans()` returns with non-empty results
- [x] 3.4 Add `orphanRecoveryBanner: { recovered: string[], exhausted: string[] } | null` to `sprintUI` store; set on `orphan:recovered`, clear on dismiss
- [x] 3.5 Render a dismissible banner in `SprintPipeline` when `orphanRecoveryBanner` is non-null

## 4. Verification

- [x] 4.1 `npm run typecheck` zero errors
- [x] 4.2 `npx vitest run --config src/main/vitest.main.config.ts` all pass
- [x] 4.3 `npm test` all pass
- [x] 4.4 `npm run lint` zero errors
- [x] 4.5 Update `docs/modules/agent-manager/index.md` for `orphan-recovery.ts`; `docs/modules/stores/index.md` for `sprintUI.ts`

> Phase A invariant: this change satisfies the **crash-loop cap on orphan recovery** invariant in `pipeline-stop-the-bleeding/specs/pipeline-correctness-baseline/spec.md`.
