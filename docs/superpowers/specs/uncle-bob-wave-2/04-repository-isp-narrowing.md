# ISprintTaskRepository ISP Narrowing

## Goal

Narrow consumer dependencies from the 27-method `ISprintTaskRepository` monolith to focused sub-interfaces (`IAgentTaskRepository`, `ISprintPollerRepository`, `IDashboardRepository`). Pure type refactoring — no behavioral changes, no method additions or removals.

## Current State

`src/main/data/sprint-task-repository.ts` already defines three sub-interfaces (lines 34–91):

- **`IAgentTaskRepository`** (11 methods) — task execution pipeline: `getTask`, `updateTask`, `getQueuedTasks`, `getTasksWithDependencies`, `getOrphanedTasks`, `clearStaleClaimedBy`, `getActiveTaskCount`, `claimTask`, `getGroup`, `getGroupTasks`, `getGroupsWithDependencies`
- **`ISprintPollerRepository`** (4 methods) — PR poller: `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, `listTasksWithOpenPrs`, `updateTaskMergeableState`
- **`IDashboardRepository`** (13 methods) — UI read/write + reporting: `listTasks`, `listTasksRecent`, `createTask`, `deleteTask`, `releaseTask`, `getQueueStats`, `getDoneTodayCount`, `getHealthCheckTasks`, `getSuccessRateBySpecType`, `createReviewTaskFromAdhoc`, `getDailySuccessRate`, `getFailureReasonBreakdown`
- **`ISprintTaskRepository`** — union of all three (backward compat, keep as-is)

`ConcreteSprintTaskRepository` already implements all methods. No changes to the repository file itself.

## Consumer Mapping

For each consumer, grep for actual `.repo.METHOD()` calls to confirm the mapping before updating:

| Consumer | File | Change To |
|----------|------|-----------|
| AgentManager constructor | `src/main/agent-manager/index.ts` line ~143 | `IAgentTaskRepository` |
| RunAgentDeps interface | `src/main/agent-manager/run-agent.ts` | `IAgentTaskRepository` |
| Orphan recovery | `src/main/agent-manager/orphan-recovery.ts` | `IAgentTaskRepository` |
| IPC handlers | `src/main/handlers/sprint-local.ts` line ~50 | `IDashboardRepository` |
| Batch handlers | `src/main/handlers/sprint-batch-handlers.ts` | `IDashboardRepository` |
| Review service | `src/main/services/review-service.ts` | `IDashboardRepository` |
| Status server | `src/main/services/status-server.ts` | `IDashboardRepository` |
| Sprint mutations | `src/main/services/sprint-mutations.ts` | Verify usage, likely `IDashboardRepository` |

**Before updating any file:** grep for actual method calls used by that consumer. If a consumer uses methods from two sub-interfaces, keep `ISprintTaskRepository` for that consumer and note it.

## Implementation Steps

1. **Audit each consumer** — for each file in Consumer Mapping table, run:
   ```
   grep -n "repo\." <file> | grep -v "//.*repo\."
   ```
   Confirm every method called exists in the target sub-interface. Note exceptions.

2. **Update `src/main/agent-manager/index.ts`** — change repo parameter type from `ISprintTaskRepository` to `IAgentTaskRepository`. Update import.

3. **Update `src/main/agent-manager/run-agent.ts`** — update `repo` in `RunAgentDeps` interface to `IAgentTaskRepository`.

4. **Update `src/main/agent-manager/orphan-recovery.ts`** — narrow to `IAgentTaskRepository`.

5. **Update handler files** — change repo type to `IDashboardRepository` in `sprint-local.ts`, `sprint-batch-handlers.ts`.

6. **Update service files** — change repo type to `IDashboardRepository` in `review-service.ts`, `status-server.ts`, `sprint-mutations.ts`.

7. **Update test mocks** — for each test file that creates `mockRepo: ISprintTaskRepository`, narrow to the appropriate sub-interface. Remove unused mock methods. TypeScript strict mode will flag missing methods.

   Example:
   ```typescript
   // Before
   const mockRepo = { getTask: vi.fn(), claimTask: vi.fn(), /* 25 unused */ } as ISprintTaskRepository
   // After
   const mockRepo: IAgentTaskRepository = { getTask: vi.fn(), claimTask: vi.fn() }
   ```

8. **Verify no stray annotations** — after all changes:
   ```bash
   grep -r "ISprintTaskRepository" src/main --include="*.ts" | grep -v "sprint-task-repository.ts"
   ```
   Any remaining results should be either union-type backward-compat cases or legitimate multi-interface consumers. Investigate each one.

## Files to Change

**No changes to:**
- `src/main/data/sprint-task-repository.ts` — sub-interfaces already correct

**Type annotation updates (consumer files):**
- `src/main/agent-manager/index.ts`
- `src/main/agent-manager/run-agent.ts`
- `src/main/agent-manager/orphan-recovery.ts`
- `src/main/handlers/sprint-local.ts`
- `src/main/handlers/sprint-batch-handlers.ts`
- `src/main/services/review-service.ts`
- `src/main/services/status-server.ts`
- `src/main/services/sprint-mutations.ts`

**Test mock updates (grep to find all):**
```bash
grep -rl "ISprintTaskRepository" src/main --include="*.test.ts"
```
Update each file found.

## How to Test

```bash
# Type checking validates all sub-interface assignments (strict mode)
npm run typecheck

# Unit tests pass with narrowed mocks
npm test

# Integration tests pass (ConcreteSprintTaskRepository implements all interfaces)
npm run test:main
```

Post-change verification:
```bash
# Confirm no ISprintTaskRepository annotations remain in consumer code
grep -r "ISprintTaskRepository" src/main --include="*.ts" | grep -v "sprint-task-repository.ts"
# Expected: empty output (or documented exceptions only)
```

This task has zero risk of behavioral regression — it is pure TypeScript type narrowing with no runtime effect.
