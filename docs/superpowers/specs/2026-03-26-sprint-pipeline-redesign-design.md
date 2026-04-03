# Sprint Center Pipeline Redesign — Design Spec

## Summary

Redesign the Sprint Center from a sidebar-list + detail-pane layout to a three-zone vertical pipeline view. The pipeline is the focal point — tasks visually flow top-to-bottom through 5 stages (Queued → Blocked → Active → Review → Done). Backlog and Failed live in a left sidebar. Task details open in a right drawer. Tasks animate smoothly between stages.

## Layout: Three Zones

### Left Sidebar (200px fixed)

Two sections:

**Backlog** (scrollable, fills available space):

- Cards for tasks not yet in the pipeline (`status: 'backlog'`)
- Each card shows: title, repo badge, priority badge
- Hover reveals "→ Add to queue" action (transitions task to `queued`)
- Click opens detail drawer
- Sorted by priority (P1 first)

**Failed** (fixed at bottom, collapsed if empty):

- Cards for tasks with terminal failure (`status: 'failed' | 'error' | 'cancelled'`)
- Each card shows: title, failure reason (from notes), time since failure
- Click opens detail drawer with "Re-run" action
- Red-tinted styling (neon-red border/surface)

### Center Pipeline (flex: 1, main content)

Vertical pipeline with 5 stage rows flowing top-to-bottom:

1. **Queued** (cyan) — tasks ready to be picked up by the agent manager
2. **Blocked** (orange) — tasks with unsatisfied hard dependencies
3. **Active** (purple, pulsing) — tasks currently being worked by agents
4. **Review** (blue) — tasks with `pr_status: 'open'` (awaiting PR review)
5. **Done** (pink, faded) — last 5 completed tasks, "View all →" link for history

**Visual elements:**

- **Connector line**: 2px vertical line on the left edge, gradient-colored through all stages
- **Stage dots**: 14px circles on the connector line at each stage, colored by stage, showing task count. Active stage dot pulses.
- **Stage header**: Stage name (uppercase) + task count (e.g., "2 of 5" for Active showing WIP limit)
- **Task pills**: Compact horizontal cards showing dot, title, repo badge, elapsed time (for active). Clicking a pill selects it and opens the detail drawer.
- **Selected pill**: Cyan border glow to indicate which task's details are shown in the drawer

**Stage-to-task mapping** (uses existing `partitionSprintTasks` buckets):

- Queued = `todo` partition
- Blocked = `blocked` partition
- Active = `inProgress` partition (partitionSprintTasks already excludes pr_status='open' tasks)
- Review = `awaitingReview` partition
- Done = `done` partition (last 5, sorted by completed_at desc)

### Right Detail Drawer (300px, slides in/out)

Opens when a task pill or backlog card is clicked. Slides in from right (200ms). Shows:

**Header:**

- Task title (large, bold)
- Status dot + status label + elapsed time (for active tasks)

**Metadata fields:**

- Repo
- Priority (P1-P5)
- Dependencies (count + progress: "2/3 complete")
- Created / Started timestamps

**Prompt section:**

- Label: "Prompt"
- Monospace block showing the instruction string passed to the agent
- This is `SprintTask.task` (the raw instruction string), NOT `SprintTask.prompt` (the template-expanded version)
- Typically 1-5 lines: "Follow the plan exactly. See spec. ## Setup..."

**Spec link:**

- "View Spec →" link that opens a wider spec reading panel
- The spec panel overlays at ~600px width (wider than the drawer) for comfortable reading
- Shows the full spec/plan document content (markdown-rendered)
- Editable with save/cancel
- Close button returns to the regular drawer

**Agent section (if task has agent_run_id):**

- "● Running — View in Agents →" link (dispatches navigation to Agents view)
- Or "Completed" with duration if finished

**PR section (if task has pr_url):**

- PR number + status badge (open/merged/closed)
- CI status badge
- Link to GitHub

**Actions bar (bottom, sticky):**
Context-aware based on task status:

- Backlog: "Add to Queue", "Edit", "Delete"
- Queued: "Launch", "Edit", "Delete"
- Blocked: "Unblock", "Edit"
- Active: "View Logs", "Edit", "Stop"
- Review: "View PR", "Edit"
- Done: "View PR", "Re-run"
- Failed: "Re-run", "Edit", "Delete"

**Drawer closed state:**
When no task is selected, the drawer is hidden and the pipeline takes the full remaining width.

## Task Pill Design

Each task in the pipeline renders as a horizontal pill:

```
[●] Task title here          [BDE]  12m
```

- Status-colored dot (left)
- Title (truncated with ellipsis, flex: 1)
- Repo badge (colored chip)
- Elapsed time (for active tasks only, right-aligned, dim)

**Active pills** have a purple-tinted background and border with subtle glow.
**Blocked pills** have an orange tint + show blocker name: "blocked by: Auth middleware".
**Review pills** have a blue tint + show PR info: "PR #461 — CI passing".
**Done pills** are faded (opacity: 0.5).

## Animations

All animations use `framer-motion` (already a project dependency).

**Task stage transitions (layoutId):**

- Each task pill has `layoutId={task.id}` so framer-motion automatically animates position changes
- When a task's status changes (e.g., queued → active), it smoothly slides from the Queued row to the Active row (~300ms ease)
- Brief glow effect on arrival (CSS animation, 500ms fade-out)

**New task appearing:**

- Fade-in + slide-down when a new task appears in Queued (from backlog promotion or creation)

**Done roll-off:**

- When a 6th task completes, the oldest Done pill fades out (opacity 0, 300ms) before the new one slides in

**Drawer:**

- Slides in from right (200ms ease)
- Slides out when deselected or closed (200ms ease)

**Stage dot pulse:**

- Active stage dot has a CSS `pulse` animation (2s infinite, glow intensity oscillates)

## Header Bar

Top bar showing:

- "Sprint" title (neon cyan, bold)
- Live stats: "2 active · 3 queued · 1 blocked" (dim text with bold numbers)
- "+ New Task" button (opens existing NewTicketModal)

## Prompt vs Spec Distinction

Tasks have two text fields relevant to the agent:

- **Prompt** (`task` field on SprintTask): The instruction string passed to the agent at spawn time. Short, directive. Example: "Follow the plan exactly. See spec in docs/plans/... ## Setup: run npm install first."
- **Spec** (`spec` field on SprintTask): The detailed implementation document with steps, code snippets, file paths, acceptance criteria. Can be many pages long.

Both are stored on the task. The prompt references the spec. In the UI:

- Prompt shows inline in the detail drawer (monospace, always visible)
- Spec opens in a wider overlay panel via "View Spec →" link

## Data Layer

No new stores needed. Reuses existing:

- `sprintTasks` store — task data, mutations, optimistic updates
- `sprintUI` store — selectedTaskId, filters (repurpose statusFilter for pipeline)
- `sprintEvents` store — agent event streams for TaskEventSubtitle

**New UI state** (add to sprintUI):

- `drawerOpen: boolean` — whether detail drawer is visible
- `specPanelOpen: boolean` — whether wide spec overlay is shown
- `doneViewOpen: boolean` — whether "View all completed" modal/panel is shown

## Component Structure

### New/Rewritten Components

| Component              | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `SprintPipeline.tsx`   | Main three-zone layout shell (replaces SprintCenter as primary view) |
| `PipelineStage.tsx`    | Single stage row (label, dot, task pills)                            |
| `TaskPill.tsx`         | Compact task card for pipeline display                               |
| `PipelineBacklog.tsx`  | Left sidebar with backlog + failed sections                          |
| `TaskDetailDrawer.tsx` | Right drawer with task details, prompt, actions                      |
| `SpecPanel.tsx`        | Wide overlay for spec viewing/editing                                |
| `DoneHistoryPanel.tsx` | Full completed task list (modal or overlay)                          |

### Reused Components

| Component           | Where Used                                               |
| ------------------- | -------------------------------------------------------- |
| `NewTicketModal`    | "+ New Task" button in header                            |
| `CircuitPipeline`   | Remove from new layout (replaced by the pipeline itself) |
| `AgentStatusChip`   | Inside TaskPill for active tasks                         |
| `TaskEventSubtitle` | Inside TaskPill for active task latest event             |
| `ConfirmModal`      | Status transition confirmations                          |

### Deprecated (replaced by new components)

| Component              | Replaced By                                     |
| ---------------------- | ----------------------------------------------- |
| `SprintCenter.tsx`     | `SprintPipeline.tsx`                            |
| `SprintTaskList.tsx`   | `PipelineStage.tsx` + `TaskPill.tsx`            |
| `SprintDetailPane.tsx` | `TaskDetailDrawer.tsx`                          |
| `KanbanBoard/Column`   | Pipeline stages (no drag-drop needed initially) |

## CSS

All styling in a new `sprint-pipeline-neon.css` file using `var(--neon-*)` custom properties. The existing `sprint-neon.css` (15k lines) is left intact — components that aren't replaced can still reference it.

Key CSS features:

- Pipeline connector: linear-gradient through stage colors
- Stage dots: colored circles with box-shadow glow
- Task pills: glass morphism with status-tinted borders
- Drawer: slide-in animation via CSS transform
- Arrival glow: `@keyframes arrive-glow` (cyan border flash, 500ms)

## Testing

- Unit tests for `PipelineStage`, `TaskPill`, `PipelineBacklog`, `TaskDetailDrawer`
- Test task-to-stage mapping (partitionSprintTasks integration)
- Test drawer open/close behavior
- Test animation props (layoutId assignment, presence detection)
- Test action buttons appear correctly per status
- Test "View all completed" shows full Done list
- Test prompt vs spec display in drawer

## Migration

`SprintView.tsx` currently renders `<SprintCenter />`. The migration:

1. Build `SprintPipeline` as a parallel component
2. Swap `SprintView` to render `<SprintPipeline />` instead of `<SprintCenter />`
3. Keep `SprintCenter` and old components intact (no deletion) — they serve as reference and fallback
4. Old components can be cleaned up in a follow-up PR after the pipeline is validated

## Files Changed

| File                                                      | Change                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/renderer/src/views/SprintView.tsx`                   | Swap `SprintCenter` → `SprintPipeline`                                     |
| `src/renderer/src/components/sprint/SprintPipeline.tsx`   | New — main shell                                                           |
| `src/renderer/src/components/sprint/PipelineStage.tsx`    | New — stage row                                                            |
| `src/renderer/src/components/sprint/TaskPill.tsx`         | New — compact task card                                                    |
| `src/renderer/src/components/sprint/PipelineBacklog.tsx`  | New — left sidebar                                                         |
| `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` | New — right detail drawer                                                  |
| `src/renderer/src/components/sprint/SpecPanel.tsx`        | New — wide spec overlay (consolidate with existing SpecDrawer if feasible) |
| `src/renderer/src/components/sprint/DoneHistoryPanel.tsx` | New — completed tasks modal (simple list with search/filter)               |
| `src/renderer/src/stores/sprintUI.ts`                     | Add drawerOpen, specPanelOpen, doneViewOpen state                          |
| `src/renderer/src/assets/sprint-pipeline-neon.css`        | New — pipeline-specific neon styles                                        |
