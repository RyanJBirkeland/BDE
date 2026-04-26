## 1. Named time constants

- [x] 1.1 Add `MS_PER_DAY = 86400000` and `MS_PER_HOUR = 3600000` exports to `src/shared/time.ts`
- [x] 1.2 Replace `retentionDays * 86400000` in `src/main/data/sprint-maintenance.ts` with `retentionDays * MS_PER_DAY`
- [x] 1.3 Replace `retentionDays * 24 * 60 * 60 * 1000` in `src/main/data/event-queries.ts` with `retentionDays * MS_PER_DAY`
- [x] 1.4 Replace `daysToKeep * 86400000` in `src/main/data/task-changes.ts` with `daysToKeep * MS_PER_DAY`
- [x] 1.5 Replace `60 * 60 * 1000` (oneHourAgo) in `src/main/data/sprint-agent-queries.ts` with `MS_PER_HOUR`

## 2. Repository interface type narrowing

- [x] 2.1 Change `listTasksWithOpenPrs(): SprintTask[]` to `SprintTaskPR[]` in `src/main/data/sprint-task-repository.ts` (`ISprintPollerRepository` interface) — already `SprintTaskPR[]`
- [x] 2.2 Change `getOrphanedTasks(claimedBy: string): SprintTask[]` to `SprintTaskExecution[]` in `ISprintPollerRepository` — skipped: orphan-recovery accesses `pr_url` (PR field), narrowing to SprintTaskExecution would drop that field
- [x] 2.3 Change `getHealthCheckTasks(): SprintTask[]` to `SprintTaskCore[]` in `IDashboardRepository` — updated interface + sprint-agent-queries + sprint-mutations + IPC channel
- [x] 2.4 Ensure the concrete `SprintTaskRepository` class satisfies the updated interface without cast — satisfied structurally (SprintTask is assignable to SprintTaskCore)

## 3. Data module return type narrowing

- [x] 3.1 Change `sprint-pr-ops.ts` `listTasksWithOpenPrs()` return type from `SprintTask[]` to `SprintTaskPR[]`
- [x] 3.2 Change `sprint-queue-ops.ts` `claimTask()` return type from `Promise<SprintTask | null>` to `Promise<SprintTaskExecution | null>`
- [x] 3.3 Fix any call-site type errors surfaced by 3.1–3.2 (callers accessing non-PR or non-execution fields)

## 4. Sprint-service and agent-manager narrowing

- [x] 4.1 Update `sprint-service.ts` `claimTask()` return type to `Promise<SprintTaskExecution | null>` to match the data layer
- [x] 4.2 Narrow the `_drainQueuedTasks` parameter in `src/main/agent-manager/index.ts` — N/A: drain-loop uses `getQueuedTasks` (full SprintTask, needed for prompt building) not claim results; narrowing satisfied via IAgentTaskRepository.claimTask interface
- [x] 4.3 Fix any compile errors in drain-loop, watchdog-loop, or task-claimer from the narrowed types — zero errors, typecheck clean

## 5. Verification

- [x] 5.1 Run `npm run typecheck` — zero errors required
- [x] 5.2 Run `npm test` — all tests pass (317 files, 3805 passed)
- [x] 5.3 Confirm grep of `src/main/data/` for `86400000`, `3600000`, `24 \* 60 \* 60`, `60 \* 60 \* 1000` returns zero matches in non-test files
- [x] 5.4 Update `docs/modules/shared/index.md` for `shared/time.ts` new exports
- [x] 5.5 Update `docs/modules/data/index.md` for any data modules whose exports changed
