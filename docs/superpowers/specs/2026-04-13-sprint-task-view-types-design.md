# SprintTask View Types — Design Spec

**Date:** 2026-04-13  
**Status:** Approved  
**Scope:** `src/shared/types/task-types.ts`, `src/main/data/sprint-task-repository.ts`, `src/main/agent-manager/types.ts`, `src/main/services/auto-review-service.ts`, `src/main/handlers/review.ts`

---

## Problem

`SprintTask` has 46 fields across 6 semantic concerns: core identity, task spec/definition, agent execution state, PR/review state, dependency/grouping, and feature flags. Every consumer — agent manager, handlers, stores, components — imports and reasons about all 46 fields even when it only cares about 6. This creates:

- Testing burden: mocking a full `SprintTask` requires constructing 46 fields
- Change risk: adding a field anywhere forces consideration of all consumers
- Documentation gap: nothing in the type system communicates which fields belong to which lifecycle stage

## Non-Goals

- No runtime behavior changes
- No DB schema changes
- No component prop narrowing (follow-on pass)
- No discriminated union (too invasive for existing `task.status ===` checks)
- No changes to `ClaimedTask extends SprintTask`

## Design

### View Types

Four named view types defined in `src/shared/types/task-types.ts` via `Pick<SprintTask, ...>`. `SprintTask` stays unchanged as the full DB row type and structurally satisfies all views.

```ts
/** Always meaningful regardless of task status. Every consumer can use this. */
export type SprintTaskCore = Pick<SprintTask,
  'id' | 'title' | 'repo' | 'status' | 'priority' | 'notes' |
  'tags' | 'group_id' | 'sprint_id' | 'created_at' | 'updated_at'>

/** Task definition fields — workbench, spec drafting, prompt building. */
export type SprintTaskSpec = SprintTaskCore & Pick<SprintTask,
  'prompt' | 'spec' | 'spec_type' | 'template_name' | 'needs_review' |
  'playground_enabled' | 'depends_on' | 'cross_repo_contract' |
  'max_cost_usd' | 'max_runtime_ms' | 'model'>

/** Agent runtime state — drain loop, watchdog, completion handler. */
export type SprintTaskExecution = SprintTaskCore & Pick<SprintTask,
  'claimed_by' | 'agent_run_id' | 'started_at' | 'completed_at' |
  'retry_count' | 'fast_fail_count' | 'retry_context' | 'next_eligible_at' |
  'session_id' | 'duration_ms' | 'worktree_path' | 'rebase_base_sha' |
  'rebased_at' | 'failure_reason' | 'partial_diff'>

/** PR and review lifecycle — code review station, sprint PR poller. */
export type SprintTaskPR = SprintTaskCore & Pick<SprintTask,
  'pr_url' | 'pr_number' | 'pr_status' | 'pr_mergeable_state' |
  'revision_feedback' | 'review_diff_snapshot'>
```

All four types are exported from `src/shared/types/task-types.ts` alongside `SprintTask`. Consumers import the narrowest type that covers their needs.

### Migration Scope (This Pass)

Only the highest-signal consumers are updated. Everything else stays `SprintTask` for backward compatibility and is migrated incrementally as files are touched.

#### 1. `ISprintTaskRepository` (`src/main/data/sprint-task-repository.ts`)

Two methods return narrowed types because their callers demonstrably only use those fields:

| Method | Old return | New return | Reason |
|--------|-----------|-----------|--------|
| `getQueuedTasks(limit)` | `SprintTask[]` | `SprintTaskExecution[]` | Drain loop only reads execution fields |
| `listTasksWithOpenPrs()` | `SprintTask[]` | `SprintTaskPR[]` | Sprint PR poller only reads PR fields |

All other repository methods stay `SprintTask` — they serve general reads.

#### 2. `src/main/agent-manager/types.ts`

`MappedTask` (the internal type used after a raw queued task is validated and mapped) is narrowed to `SprintTaskExecution`. The drain loop and watchdog only access execution fields; narrowing here catches accidental field access at compile time.

#### 3. `src/main/services/auto-review-service.ts`

Input parameter narrowed from `SprintTask` to `SprintTaskPR`. The service only reads `worktree_path`, `pr_url`, `pr_number` — all covered by `SprintTaskPR`.

#### 4. `src/main/handlers/review.ts`

Handler functions that only access PR/review fields are narrowed to `SprintTaskPR`. Functions that need full task state stay `SprintTask`.

### What Stays `SprintTask`

- `sprintTasks` Zustand store — manages the full task list for all views; narrowing would be wide and low-value
- All component props — follow-on pass
- Most IPC handlers — they serve mixed purposes and stay general
- `createTask`, `updateTask`, `getTask` repository methods — return the full row

## File Changes

| File | Change |
|------|--------|
| `src/shared/types/task-types.ts` | Add 4 exported view types |
| `src/main/data/sprint-task-repository.ts` | Narrow 2 method return types |
| `src/main/agent-manager/types.ts` | Narrow `MappedTask` to `SprintTaskExecution` |
| `src/main/services/auto-review-service.ts` | Narrow input param to `SprintTaskPR` |
| `src/main/handlers/review.ts` | Narrow PR-only function params to `SprintTaskPR` |

## Testing

- `npm run typecheck` — zero errors required; TypeScript validates all narrowing is structurally sound
- `npm test` — all tests pass (no runtime changes)
- `npm run test:main` — all main-process tests pass
- No new tests required — this is a type-only change; correctness is proven by the compiler

## Migration Path

Future sessions should narrow additional consumers as files are touched:
- Component props: `SprintTaskCore` for display-only components
- Hook params: narrow to the view that matches the hook's concern
- Additional handler functions: narrow to `SprintTaskSpec` where only spec fields are read

The rule: **when editing a function that takes `SprintTask`, ask whether a narrower view type suffices. If yes, use it.**
