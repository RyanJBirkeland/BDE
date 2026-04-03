# Sprint Center — Neon Redesign

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Replace the current Kanban + table + drawer Sprint view with a three-zone layout: circuit board pipeline, filterable task list, and context-aware detail pane.

## Problem

The current Sprint Center has two main UX issues:

1. **Too much scrolling** — Kanban board on top, then Backlog/Blocked/Done/Failed tables stacked below push important content off-screen.
2. **Disconnected detail panels** — SpecDrawer, LogDrawer, TaskMonitorPanel, ConflictDrawer, and HealthCheckDrawer are overlays that obscure the main view and feel disconnected from the task they describe.

## Design

Three-zone layout that keeps everything in the viewport without scrolling or overlay drawers.

### Zone 1: Header + Circuit Board Pipeline

**Header row:** "SPRINT CENTER" title + repo filter chips (BDE, life-os, All) + keyboard shortcut hint + "+ New Ticket" button.

**Circuit Board Pipeline:** SVG-based visualization connecting stage chips with PCB-style traces.

- Chips map to the 7 partition buckets from `partitionSprintTasks()` — NOT raw task statuses. The buckets are: **backlog**, **todo** (queued), **blocked**, **in progress** (active, no open PR), **review** (active or done with `pr_status=open`), **done** (done, no open PR), **failed** (failed + error + cancelled).
- Chips are connected by SVG trace lines with animated "data packet" dots flowing left-to-right.
- The "in progress" chip has a pulsing glow ring animation when count > 0.
- Each chip is clickable — clicking filters the task list to that partition bucket. Clicking again clears the filter. This is a UI-level filter on the already-partitioned data, not a status query.
- Chips use the neon color palette: backlog=orange, todo=cyan, blocked=red, in progress=green, review=yellow, done=blue/indigo, failed=red (dimmer than blocked).

**Field name mapping:** The pipeline reads from the `SprintPartition` object returned by `partitionSprintTasks()`. The field names are: `backlog`, `todo`, `blocked`, `inProgress`, `awaitingReview`, `done`, `failed`. The display labels differ: "todo" displays as "queued", "inProgress" as "in progress", "awaitingReview" as "review".

**New neon component:** `CircuitPipeline` — a reusable component that accepts an array of `{ label, count, accent, active? }` stages and renders the SVG traces + chips. Could be added to the neon primitives library for reuse on Dashboard.

### Zone 2: Rich Task List (left pane)

A single filterable, scrollable list replacing the Kanban board + 4 separate table sections.

**Search bar** at top with neon-styled input.

**Task rows** show rich inline information:

- **Title** — primary text, truncated with ellipsis
- **Status badge** — colored pill matching the partition bucket: backlog, todo, blocked, in progress, review, done, failed. (Note: the code field is `partition.awaitingReview` for the "review" bucket.)
- **Repo badge** — colored pill (BDE, life-os, etc.)
- **Priority badge** — P1 (red), P2 (orange), P3+ (muted)
- **Active tasks:** pulsing green dot + time-since-started
- **Review tasks:** inline PR badge (e.g., "PR #412")
- **Blocked tasks:** red-tinted background + "⚠ stuck Xh" warning (replaces HealthCheckDrawer)
- **Conflict tasks:** "⚠ conflict" indicator inline (replaces ConflictDrawer)
- **Spec indicator:** 📄 icon when task has a spec
- **Backlog tasks:** dimmed text to visually deprioritize

**Sort order:** in progress first, then todo (queued), then review, then blocked, then backlog, then done, then failed. Within each group, sorted by priority.

**Selection:** Selected task has purple left border + highlighted background. Clicking a row selects it and loads detail in the right pane.

**Bulk actions:** Checkbox appears on hover or when any task is selected. Floating action bar at bottom of list pane with: Set Priority, Mark Done, Delete, Clear Selection. Supports Cmd+A to select all visible, Escape to clear.

### Zone 3: Context-Aware Detail Pane (right pane)

Persistent right pane replacing SpecDrawer, LogDrawer, and TaskMonitorPanel.

**Detail header:** Task title + status/priority/repo badges.

**Tabs:** `Spec | Output | PR` — auto-selects based on partition bucket with manual override:

- **backlog** or **todo** → **Spec** tab (the thing you need to review before launching)
- **in progress** → **Output** tab (live agent console via AgentEvents, same as AgentConsole component)
- **review** → **PR** tab (task has an open PR)
- **done** → **PR** tab if `pr_url` exists, else **Output** tab
- **blocked** or **failed** (includes error + cancelled) → **Output** tab (see what went wrong)
- User can always click a different tab to override

**Spec tab:** Renders task spec as markdown-style content in a monospace code block with neon syntax coloring. Read-only view; "Edit Spec" button in footer opens Task Workbench.

**Output tab:** Embeds the same event rendering used in AgentConsole (from the Agents view). Reads from `agentEventsStore.loadHistory(agentRunId)`. Falls back to plain log text via `sprint.readLog()` for older agents without events. Shows "Agent is starting up..." when active but no events yet. Shows "No agent session linked" when no `agent_run_id`.

**PR tab:** Shows PR status, link to open in browser, merge state, CI check status. Reuses existing PR info from the task object (`pr_url`, `pr_number`, `pr_status`, `pr_mergeable_state`).

**Action footer:** Context-aware buttons that change based on partition bucket:

- **backlog** → Sprint, Edit Spec, Done, Delete
- **todo** (queued) → Launch, Edit Spec, Done, Delete
- **in progress** (active) → Stop Agent, Open in Agents, Done
- **review** (active/done with open PR) → Open PR, Mark Done
- **done** → View PR, Rerun (if no PR)
- **blocked** → Unblock, Edit Spec
- **failed** (failed + error + cancelled) → Retry (requeue), View Output, Delete

### What Gets Removed

| Component                                             | Replacement                                  |
| ----------------------------------------------------- | -------------------------------------------- |
| `KanbanBoard` + `KanbanColumn`                        | Circuit pipeline + filterable task list      |
| `TaskCard` (drag-drop)                                | Task row in list (no drag-drop)              |
| `SpecDrawer`                                          | Detail pane Spec tab                         |
| `LogDrawer`                                           | Detail pane Output tab                       |
| `TaskMonitorPanel` (resizable split)                  | Detail pane Output tab                       |
| `ConflictDrawer`                                      | Inline "conflict" badge on task rows         |
| `HealthCheckDrawer`                                   | Inline "stuck Xh" warning on task rows       |
| `TaskTable` (4 sections: backlog/blocked/done/failed) | Single unified task list with status filters |

### What Stays (unchanged)

- `SprintCenter` (container — rewritten but same role)
- `SprintToolbar` (absorbed into Zone 1 header)
- `BulkActionBar` (restyled, same functionality)
- `NewTicketModal` / Task Workbench integration
- `ConfirmModal` for destructive actions
- All Zustand stores (`sprintTasks`, `sprintUI`, `sprintEvents`)
- All hooks (`useSprintPolling`, `usePrStatusPolling`, `useSprintKeyboardShortcuts`, `useSprintTaskActions`, `useHealthCheck`)
- Keyboard shortcuts (N = new ticket, Escape = clear)

### What's New

- `CircuitPipeline` component (neon primitive, reusable)
- `SprintTaskList` component (filterable list with rich rows)
- `SprintTaskRow` component (single task row with inline badges/indicators)
- `SprintDetailPane` component (right pane with context-aware tabs)
- `sprint-neon.css` (new CSS file for sprint neon styles)

## Neon Styling

- Background: `var(--neon-bg)` dark indigo-purple
- Borders: purple throughout — define as CSS custom property in `sprint-neon.css` (e.g., `--sprint-border`)
- Pipeline chips: per-bucket accent colors with glow `box-shadow`
- Active indicators: pulsing green dots with `box-shadow` glow
- Selected state: purple left border + tinted background (use CSS variable, not hardcoded rgba)
- Tabs: cyan underline for active, muted for inactive
- Action buttons: neon-bordered with hover brightness increase
- Badges: semi-transparent background with matching text color per status
- SVG animations: `offset-path` for data packets, `@keyframes` for chip pulse

## Data Flow

No changes to the data layer. The redesign is purely presentational.

- Tasks come from `useSprintTasks` store (Supabase realtime)
- Agent events come from `useAgentEventsStore` (SQLite + IPC)
- Sprint events come from `useSprintEvents` (live output streaming)
- Task actions go through `useSprintTaskActions` hook (unchanged)
- Pipeline counts derived from `partitionSprintTasks` (unchanged)

## Testing

- Unit tests for `CircuitPipeline` (renders correct chip count, click fires filter callback)
- Unit tests for `SprintTaskRow` (renders badges, indicators, handles click)
- Unit tests for `SprintDetailPane` (auto-selects correct tab per status, manual override works)
- Update `SprintCenter.test.tsx` for new component structure
- Existing hook tests unchanged (hooks are reused as-is)

## Non-Goals

- Drag-and-drop between statuses (removed — use action buttons instead)
- Interactive pipeline strip click-to-filter (included in v1 as it's trivial)
- Mobile/responsive layout (BDE is a desktop Electron app)
