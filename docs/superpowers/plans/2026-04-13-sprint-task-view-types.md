# SprintTask View Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four focused `Pick<SprintTask, ...>` view types to `task-types.ts` and narrow `listTasksWithOpenPrs()` in `ISprintPollerRepository` to return `SprintTaskPR[]`.

**Architecture:** Pure type-level change — no runtime behavior changes. `SprintTask` stays the authoritative full-row type. The four view types are structural subtypes that `SprintTask` already satisfies, so no casts are needed anywhere. The repository narrowing is enforced by TypeScript structurally: the concrete implementation in `sprint-pr-ops.ts` returns `SprintTask[]`, which is assignable to `SprintTaskPR[]` because `SprintTask` has all PR fields.

**Tech Stack:** TypeScript strict mode, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/shared/types/task-types.ts` | Add 4 exported view type aliases after `SprintTask` |
| `src/main/data/sprint-task-repository.ts` | Narrow `listTasksWithOpenPrs()` in `ISprintPollerRepository` from `SprintTask[]` to `SprintTaskPR[]` |

No new files. No test files — this is a type-only change verified by `npm run typecheck`.

---

### Task 1: Add four view type aliases to `task-types.ts`

**Files:**
- Modify: `src/shared/types/task-types.ts` (after line 111, after the closing `}` of `SprintTask`)

- [ ] **Step 1: Add the view types**

Open `src/shared/types/task-types.ts`. After the closing `}` of `SprintTask` (line 111), insert the following block:

```ts
// ---------------------------------------------------------------------------
// SprintTask view types — focused Pick subsets for consumers that don't need
// the full 43-field shape. SprintTask satisfies all four structurally.
// ---------------------------------------------------------------------------

/** Always meaningful regardless of task status. Every consumer can use this. */
export type SprintTaskCore = Pick<
  SprintTask,
  'id' | 'title' | 'repo' | 'status' | 'priority' | 'notes' | 'tags' | 'group_id' | 'sprint_id' | 'created_at' | 'updated_at'
>

/** Task definition fields — workbench, spec drafting, prompt building. */
export type SprintTaskSpec = SprintTaskCore &
  Pick<
    SprintTask,
    | 'prompt'
    | 'spec'
    | 'spec_type'
    | 'template_name'
    | 'needs_review'
    | 'playground_enabled'
    | 'depends_on'
    | 'cross_repo_contract'
    | 'max_cost_usd'
    | 'max_runtime_ms'
    | 'model'
  >

/** Agent runtime state — drain loop, watchdog, completion handler. */
export type SprintTaskExecution = SprintTaskCore &
  Pick<
    SprintTask,
    | 'claimed_by'
    | 'agent_run_id'
    | 'started_at'
    | 'completed_at'
    | 'retry_count'
    | 'fast_fail_count'
    | 'retry_context'
    | 'next_eligible_at'
    | 'session_id'
    | 'duration_ms'
    | 'worktree_path'
    | 'rebase_base_sha'
    | 'rebased_at'
    | 'failure_reason'
    | 'partial_diff'
  >

/** PR and review lifecycle — code review station, sprint PR poller. */
export type SprintTaskPR = SprintTaskCore &
  Pick<
    SprintTask,
    'pr_url' | 'pr_number' | 'pr_status' | 'pr_mergeable_state' | 'revision_feedback' | 'review_diff_snapshot'
  >
```

- [ ] **Step 2: Run typecheck to verify zero errors**

```bash
npm run typecheck
```

Expected: exits with code 0, no errors.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass (no runtime changes).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types/task-types.ts
git commit -m "feat: add SprintTask view types (Core, Spec, Execution, PR)"
```

---

### Task 2: Narrow `listTasksWithOpenPrs()` in the repository interface

**Files:**
- Modify: `src/main/data/sprint-task-repository.ts` (line 58 in `ISprintPollerRepository`)

The import of `SprintTaskPR` needs to be added alongside the existing `SprintTask` import.

- [ ] **Step 1: Update the import line**

In `src/main/data/sprint-task-repository.ts`, find:

```ts
import type { SprintTask, TaskDependency, TaskGroup, EpicDependency } from '../../shared/types'
```

Change to:

```ts
import type { SprintTask, SprintTaskPR, TaskDependency, TaskGroup, EpicDependency } from '../../shared/types'
```

- [ ] **Step 2: Narrow the method signature**

In `ISprintPollerRepository` (around line 58), find:

```ts
  listTasksWithOpenPrs(): SprintTask[]
```

Change to:

```ts
  listTasksWithOpenPrs(): SprintTaskPR[]
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: exits with code 0. TypeScript will verify that:
- The concrete implementation in `sprint-pr-ops.ts` (`listTasksWithOpenPrs(): SprintTask[]`) is still assignable to `SprintTaskPR[]` — it is, because `SprintTask` has all `SprintTaskPR` fields.
- All callers of `listTasksWithOpenPrs()` (the sprint PR poller) only access fields present in `SprintTaskPR`.

If you see a type error on callers, check that they only access fields in `SprintTaskPR` or `SprintTaskCore`. The sprint PR poller (`src/main/sprint-pr-poller.ts`) only accesses `t.id` and `t.pr_url` — both are in the view type.

- [ ] **Step 4: Run all tests**

```bash
npm test && npm run test:main
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/data/sprint-task-repository.ts
git commit -m "feat: narrow listTasksWithOpenPrs return type to SprintTaskPR[]"
```

---

### Task 3: Push

- [ ] **Step 1: Push to origin**

```bash
git push
```

Expected: pre-push hook runs `typecheck + test + test:main + lint`, all pass. Push succeeds.
