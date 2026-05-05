# PR Builder & Code-Approved Flow — Design

**Date:** 2026-05-04
**Status:** Approved

---

## Context

The current Rollup PR feature is rough around the edges: no description editor, poor conflict handling, no ordering controls, no result feedback, and tasks stay in `review` status awkwardly after a PR is created. More fundamentally, there is no distinction between "code approved by a human" and "shipped to main" — so all tasks with hard dependencies on an approved-but-unmerged task stay `blocked` indefinitely, even though the upstream code is ready.

This design introduces:
1. A new `approved` status — a human decision in the Code Review Station that separates "I'm happy with this code" from "this is on main"
2. Fork-on-approve — downstream stacked agents start from the approved branch, not from `main`
3. A persistent PR Builder modal — replaces the current `RollupPrModal` with a proper composer that persists PR groups across sessions and builds them independently

---

## Section 1: Status Machine & Dependency Unblocking

### New status: `approved`

Sits between `review` and `done` in the state machine.

```
active → review → approved → done
                ↘ queued (request revision — available from both review and approved)
                ↘ cancelled (discard)
```

Valid transitions:
- `review → approved` — new "Approve" action (human decision in Code Review Station, no GitHub involvement)
- `approved → done` — Ship It / Merge Locally
- `approved → queued` — Request Revision (change of mind after approving)
- `approved → cancelled` — Discard
- `approved → done` — Sprint PR Poller (when a GitHub PR for this task merges)

### Dependency unblocking at `approved`

`resolve-dependents.ts` currently fires on `done`, `failed`, `cancelled`. Add `approved` as a trigger for `hard` deps only. When a task reaches `approved`, any task with a `hard` dep on it transitions `blocked → queued`.

Soft deps are unaffected — they already unblock on any terminal status.

### PR status within `approved`

After the PR Builder creates a PR for an approved task, the task stays in `approved` with `pr_status = 'open'`. The Sprint PR Poller handles the eventual `approved → done` transition when the GitHub PR merges.

```
approved + pr_status=null    → in approved queue, no PR yet
approved + pr_status='open'  → PR created, waiting on GitHub merge
approved → done              → PR merged (Poller) or Ship It / Merge Locally
```

---

## Section 2: Fork-on-Approve & Auto-Rebase

### Stacked branches

When a task is approved and its hard-dep dependents unblock and queue, the agent manager forks each downstream agent's worktree from the approved parent's branch rather than from `main`:

```
main
  └── agent/t-A-slug     ← Task A, approved (not yet on main)
        └── agent/t-B-slug     ← Task B, forked from A at approve time
```

The drain loop, when claiming a newly-unblocked task, checks `depends_on` for any `hard` deps in `approved` status. If found, uses the direct approved parent's branch as the worktree base. In a chain A → B → C, Task C forks from Task B's branch (its immediate dependency), not Task A's.

### New field: `stacked_on_task_id`

`SprintTask` gets `stacked_on_task_id: string | null` — records which approved task this one was forked from. Used for:
- Auto-rebase lookup at review transition
- PR Builder stack ordering (cards show stacking relationships)

### Auto-rebase timing

Rebase runs when the stacked task transitions to `review`, not while it is `active`. The agent finishes naturally; the completion pipeline then runs `git rebase origin/main` before surfacing the task to the human (the upstream task will have merged to `main` by then).

- Clean rebase → task enters `review` normally
- Conflict → task enters `review` with a conflict note in `revision_feedback`; human resolves before taking action

---

## Section 3: Code Review Station Restructuring

### Two sections in the task sidebar

**"Pending Review"** — `review` status tasks. Needs human attention.

**"Approved"** — `approved` status tasks. Code blessed, waiting to ship. Has a persistent **"Build PR"** button at the top that opens the PR Builder modal.

Both sections are collapsible. Approved task rows get a subtle green indicator and a PR badge when `pr_status = 'open'`.

### Action bar (context-aware per status)

**In Pending Review** (status = `review`):
- Same actions as today: Merge Locally, Ship It, Create PR, Request Revision, Discard
- New prominent **"Approve"** button as primary CTA

**In Approved** (status = `approved`):
- Merge Locally, Ship It, Request Revision, Discard
- **"Build PR"** as primary CTA (opens PR Builder with this task pre-assigned to a group)
- No "Approve" button (already approved)

### Sprint Pipeline

`partitionSprintTasks()` gets an `approved` bucket positioned between `pendingReview` and `openPrs`. The pipeline view shows approved tasks as their own stage so the board reflects the full workflow.

---

## Section 4: PR Builder Modal

Replaces `RollupPrModal.tsx` with `PrBuilderModal.tsx` — a large full-screen modal triggered from the "Build PR" button in the Approved section.

### Layout: left/right split

**Left panel — Unassigned Tasks:**
- All `approved` tasks not yet assigned to any PR group, organized by repo
- Tasks drag into group cards on the right
- Repo sections enforce the constraint that cross-repo tasks cannot share a group (shown visually — different repo sections cannot be dropped into the same card)

**Right panel — PR Group Cards:**
- One card per persisted PR group
- Each card contains: ordered task list (drag to reorder within the group), branch name field, PR title field, full markdown description editor, per-task conflict indicator
- Each card has its own **"Build PR"** button — groups are independent
- "Split off" per-task button moves that task into a new standalone group card
- **"+ New Group"** creates an empty group for a given repo

### Implicit mode (no toggle)

The PR type is determined by task count — no explicit mode selection:
- **1 task in group** → push the existing agent branch, create PR directly (no squash merge, no new branch)
- **2+ tasks in group** → rollup: create new branch from `main`, squash-merge tasks in dependency order, push, create single PR

### Group persistence

Groups survive across sessions. A group in `composing` state accumulates tasks over time as more tasks get approved. The user decides when each group is ready to ship by clicking its "Build PR" button.

### Group lifecycle

```
composing  →  "Build PR" clicked  →  building  →  open  →  merged
                                      (git ops)   (GH PR)  (PR Poller)
```

When a group reaches `open`, all its tasks get `pr_number`, `pr_url`, `pr_status='open'`. The Sprint PR Poller monitors the single PR and transitions all bundled tasks to `done` when it merges.

### Conflict handling

Before enabling "Build PR", FLEET runs a per-group dry-run merge check (`git merge --no-commit --no-ff`). If conflicts are detected:
- Conflicting files listed per task
- "Resolve in IDE" button opens the file in the IDE view
- "Build PR" remains disabled until conflicts are resolved or the conflicting task is removed from the group

### Progress & results

During build: per-step status indicators (squashing Task 1, squashing Task 2, pushing branch, creating PR...) instead of a spinner.

After build: PR link(s), confirmation that tasks were updated, dismissal option.

---

## Section 5: Data Model & IPC

### DB migration

Three changes in a new migration:

**1. `sprint_tasks` table:**
- `status` allowlist adds `'approved'`
- New column: `stacked_on_task_id TEXT REFERENCES sprint_tasks(id)` (nullable)

**2. New `pr_groups` table:**

```sql
CREATE TABLE pr_groups (
  id          TEXT PRIMARY KEY,
  repo        TEXT NOT NULL,
  title       TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'composing',  -- composing|building|open|merged
  task_order  TEXT NOT NULL DEFAULT '[]',          -- JSON array of task IDs, ordered
  pr_number   INTEGER,
  pr_url      TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
)
```

**3. Sprint PR Poller** updated to watch `status = 'approved' AND pr_status = 'open'` in addition to the existing `status = 'review' AND pr_status = 'open'` watch.

### New IPC channels

| Channel | Purpose |
|---------|---------|
| `review:approveTask` | Transition `review → approved`, trigger dependency resolution |
| `prGroups:list` | List all groups (optionally filtered by repo) |
| `prGroups:create` | Create a new composing group |
| `prGroups:update` | Update title / description / branch name / task order |
| `prGroups:addTask` | Assign a task to a group |
| `prGroups:removeTask` | Remove a task from a group (returns to unassigned pool) |
| `prGroups:build` | Run git ops + PR creation for one group |
| `prGroups:delete` | Delete a composing group (returns all tasks to unassigned pool) |

### Updated modules

| Module | Change |
|--------|--------|
| `src/shared/task-state-machine.ts` | Add `approved` to status union and valid transitions |
| `src/shared/types/task-types.ts` | Add `stacked_on_task_id` field, update `TaskStatus` union |
| `src/main/lib/resolve-dependents.ts` | Trigger on `approved` for hard deps; pass approved branch as fork base |
| `src/main/agent-manager/` drain loop | Check `stacked_on_task_id`, fork worktree from approved parent branch |
| `src/main/agent-manager/run-agent.ts` | Pre-`review` rebase step for stacked tasks |
| `src/main/sprint-pr-poller.ts` | Watch `approved + pr_status='open'` in addition to existing watch |
| `src/renderer/src/stores/sprintTasks.ts` | `partitionSprintTasks()` adds `approved` bucket |
| `src/renderer/src/components/code-review/TopBar.tsx` | Approved section with "Build PR" button |
| `src/renderer/src/components/code-review/ReviewActionsBar.tsx` | "Approve" action; context-aware rendering per status |
| `src/renderer/src/hooks/useSingleTaskReviewActions.ts` | Add `approve` action |
| `src/renderer/src/hooks/useBatchReviewActions.ts` | Add `batchApprove` action |

### New modules

| Module | Purpose |
|--------|---------|
| `src/main/data/pr-group-queries.ts` | CRUD for `pr_groups` table |
| `src/main/handlers/pr-groups.ts` | IPC handler — thin wrapper, no business logic |
| `src/main/services/pr-group-build-service.ts` | Per-group git ops + PR creation (replaces `ReviewRollupService`) |
| `src/renderer/src/stores/prGroups.ts` | Zustand store for PR group state |
| `src/renderer/src/components/code-review/PrBuilderModal.tsx` | Full-screen modal PR composer |
| `src/renderer/src/hooks/usePrGroups.ts` | Group management actions (create, update, addTask, removeTask, build, delete) |
| `src/renderer/src/hooks/useApproveAction.ts` | Approve action with confirmation + dependency resolution feedback |

### Retired modules

| Module | Replacement |
|--------|-------------|
| `src/renderer/src/components/code-review/RollupPrModal.tsx` | `PrBuilderModal.tsx` |
| `src/main/services/review-rollup-service.ts` | `pr-group-build-service.ts` |

---

## Verification

End-to-end happy paths to verify:

1. **Approve + dependency unblock:** Task A completes → appears in Pending Review → click Approve → Task A moves to Approved section → any hard-dep tasks on A transition from `blocked → queued`
2. **Fork-on-approve:** Task B (hard dep on A) spawns → agent manager creates worktree forked from Task A's branch, not `main` → `task_b.stacked_on_task_id = task_a.id`
3. **Auto-rebase at review:** Task A merges to `main` (approved → done) → Task B agent finishes → completion pipeline rebases Task B's branch onto `main` → Task B enters `review` with clean diff
4. **Rebase conflict path:** Same as above but with conflict → Task B enters `review` with conflict note in `revision_feedback`
5. **PR Builder — single task:** Drag Task A into a new group card → fill title/description → click "Build PR" → task's existing branch pushed → GitHub PR created → task stays `approved` with `pr_status='open'` → PR merges on GitHub → Sprint PR Poller transitions to `done`
6. **PR Builder — combined PR:** Drag Tasks A and B into the same group card → click "Build PR" → new branch created, tasks squash-merged in dependency order → single GitHub PR created → both tasks get same `pr_number`/`pr_url` → Poller transitions both to `done` on merge
7. **PR Builder — individual PRs same repo:** Two group cards, one task each → build each independently → two separate PRs
8. **Group persistence:** Create group, close app, reopen → group and its tasks still in composing state in PR Builder
9. **Conflict detection:** Introduce a conflict between two tasks in the same group → "Build PR" disabled, conflicting files shown, "Resolve in IDE" button works
10. **Sprint Pipeline:** `approved` bucket visible between `pendingReview` and `openPrs` stages
