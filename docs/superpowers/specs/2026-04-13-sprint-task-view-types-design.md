# SprintTask View Types — Design Spec

**Date:** 2026-04-13  
**Status:** Approved  
**Scope:** `src/shared/types/task-types.ts`, `src/main/data/sprint-task-repository.ts`

---

## Problem

`SprintTask` has 46 fields across 6 semantic concerns: core identity, task spec/definition, agent execution state, PR/review state, dependency/grouping, and feature flags. Every consumer — agent manager, handlers, stores, components — imports and reasons about all 46 fields even when it only cares about 6. This creates:

- Testing burden: mocking a full `SprintTask` requires constructing 46 fields
- Change risk: adding a field anywhere forces consideration of all consumers
- Documentation gap: nothing in the type system communicates which fields belong to which lifecycle stage

## Non-Goals

- No runtime behavior changes
- No DB schema changes
- No changes to `ClaimedTask extends SprintTask`
- No changes to `MappedTask` in `task-mapper.ts` (already a focused, well-defined type)
- No component prop narrowing (follow-on pass)
- No discriminated union (too invasive for existing `task.status ===` checks)

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

**Coverage check:** The remaining fields not assigned to any view type — `fast_fail_count`, `retry_count` appear in both Execution (via `SprintTaskExecution`) and in `MappedTask`. Fields `sprint_id`, `cross_repo_contract` are infrequently used; they live in Core and Spec respectively. All 46 fields from `SprintTask` are covered across the four views.

### Migration Scope (This Pass)

Only two repository methods are narrowed in this pass — both have callers that demonstrably use only a subset of fields.

#### `ISprintTaskRepository` (`src/main/data/sprint-task-repository.ts`)

| Method | Old return | New return | Caller + reason |
|--------|-----------|-----------|-----------------|
| `getQueuedTasks(limit)` | `SprintTask[]` | `SprintTaskExecution[]` | Drain loop maps queued tasks via `mapQueuedTask` — only reads id, title, prompt, spec, retry_count, fast_fail_count, repo, group_id (all in Execution or Core) |
| `listTasksWithOpenPrs()` | `SprintTask[]` | `SprintTaskPR[]` | Sprint PR poller only reads id, pr_url, pr_number, pr_status, pr_mergeable_state |

All other repository methods stay `SprintTask` — they serve general reads where the full shape is appropriate.

### What Stays `SprintTask`

- `sprintTasks` Zustand store — manages the full task list for all views
- All component props — follow-on pass
- All IPC handlers — serve mixed purposes
- `createTask`, `updateTask`, `getTask`, `listTasks`, `getTask` repository methods — return the full row
- `MappedTask` in `task-mapper.ts` — already a focused, purpose-built type; leave it

## File Changes

| File | Change |
|------|--------|
| `src/shared/types/task-types.ts` | Add 4 exported view type aliases after `SprintTask` |
| `src/main/data/sprint-task-repository.ts` | Narrow `getQueuedTasks` and `listTasksWithOpenPrs` return types |

## Testing

- `npm run typecheck` — zero errors required; TypeScript validates all narrowing is structurally sound
- `npm test` — all tests pass (no runtime changes)
- `npm run test:main` — all main-process tests pass
- No new tests required — type-only change; correctness proven by the compiler

## Migration Path

Future sessions should narrow additional consumers as files are touched. The rule: **when editing a function that takes `SprintTask`, ask whether a narrower view type suffices. If yes, use it.**

Suggested next narrowing targets (not in this pass):
- `SprintTaskCore` for display-only components (TaskPill, TaskRow)
- `SprintTaskSpec` for workbench form components
- `SprintTaskExecution` for watchdog and completion handler functions
- `SprintTaskPR` for code review station components
