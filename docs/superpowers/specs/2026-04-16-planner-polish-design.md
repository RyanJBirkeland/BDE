# Planner Polish — Design Spec

**Date:** 2026-04-16
**Scope:** Polish pass — no new views, no schema changes, reuse existing components and patterns throughout.

---

## Overview

Two changes:

1. **Hide Source Control** from the navigation sidebar and shortcut map (code stays intact).
2. **Planner polish** — thin progress stripe in the epic detail header, an ambient "Ask AI ✦" button, and a new Planning Assistant drawer for AI-assisted brainstorming and task/epic creation.

---

## 1. Hide Source Control

Five files need touching to fully hide the `git` view:

**`src/renderer/src/lib/view-registry.ts`**
- Add `hidden?: true` to the `ViewMetadata` interface.
- Set `hidden: true` on the `git` entry.
- Update `shortcut`/`shortcutKey` for `settings` (`⌘7→⌘6`, `'7'→'6'`) and `planner` (`⌘8→⌘7`, `'8'→'7'`).

**`src/renderer/src/stores/keybindings.ts`**
- Remove `'view.git'` from the `ActionId` union type, `DEFAULT_KEYBINDINGS`, and `ACTION_LABELS`.
- Update `'view.settings'` binding to `⌘6` and `'view.planner'` to `⌘7`.

**`src/renderer/src/stores/sidebar.ts`**
- Remove `'git'` from the `ALL_VIEWS` array. This drives both the pinned sidebar render and `getUnpinnedViews()` (the overflow menu).

**`src/renderer/src/components/layout/CommandPalette.tsx`**
- Remove the `{ view: 'git', label: 'Go to Source Control', actionId: 'view.git' }` entry from the navigation commands array.
- Note: the planner entry intentionally uses `actionId: 'view.taskWorkbench'` (a pre-existing naming inconsistency) — do not change it.

**`src/renderer/src/components/settings/KeybindingsSettings.tsx`**
- Remove `'view.git'` from the `ACTION_ORDER` array (line 26). This removes the Source Control row from the keybindings settings UI.

### What does NOT change

- `GitTreeView`, `gitTree` store, `useGitCommands`, `useGitStatusPolling`, all related tests — untouched.
- The `'git'` literal remains in `view-types.ts` and `view-resolver.tsx` so the view can be restored by reverting the five changes above.

---

## 2. Planner Polish

### 2a. Epic list — status label pill shape (CSS-only)

**File:** `src/renderer/src/components/planner/EpicList.css`

`EpicList.tsx` already renders the status text and progress fraction. The only change is CSS: give `.planner-epic-item__status` a pill shape — add `border-radius`, padding, and a coloured background using existing `--fleet-status-*` tokens matching each status value. No JSX changes.

### 2b. Epic detail header — thin progress stripe + Ask AI button

**Files:** `src/renderer/src/components/planner/EpicHeader.tsx`, `EpicDetail.tsx`, `EpicDetail.css`

`EpicProgress.tsx` already renders a full progress section (bar + status counts) below the header. The new addition is a **3px accent stripe** rendered as the last child of the `epic-detail__header` element — a quick-glance ambient indicator visually distinct from the detailed `EpicProgress` section (same visual language as the active-view indicator in the sidebar).

**`EpicHeader` receives two new props:**
- `doneCount: number` — number of tasks with `status === 'done'`
- `totalCount: number` — total task count

These are computed in `EpicDetail` from the `tasks` prop it already holds and passed down:
```ts
const doneCount = tasks.filter(t => t.status === 'done').length
const totalCount = tasks.length
```

The stripe fill = `doneCount / totalCount * 100%`, transitioning on change. Hidden (zero width) when `totalCount === 0`. Uses `--fleet-accent-dim` for the track background and `--fleet-accent` for the fill — no new tokens.

**Ask AI button** — also added to `EpicHeader`:
- Style: `background: var(--fleet-accent-dim); border: 1px solid var(--fleet-accent-border); color: var(--fleet-accent-text)` — ambient, not primary gradient.
- Fires a new `onOpenAssistant` callback prop on `EpicHeader`.
- Does not render when `totalCount === 0` (no epic selected effectively).

**State ownership** — `assistantOpen: boolean` lives in `PlannerView` (same location as `workbenchOpen` for the `WorkbenchPanel`). `PlannerView` passes `onOpenAssistant={() => setAssistantOpen(true)}` to `EpicDetail`, which passes it to `EpicHeader`. `PlannerView` also passes `onOpenWorkbench` to `PlannerAssistant` (see §3).

### 2c. "No spec" badge on task rows — already implemented

`TaskRow.tsx` (lines 92–94) already renders the `no spec` flag for `status === 'backlog'` tasks without a spec. No change needed.

---

## 3. Planning Assistant Drawer

**New files:** `src/renderer/src/components/planner/PlannerAssistant.tsx` + `PlannerAssistant.css`

### Mounting and lifecycle

Mounted in `PlannerView` alongside `WorkbenchPanel`. State `assistantOpen` and `setAssistantOpen` live in `PlannerView`. `PlannerAssistant` follows the same conditional-unmount pattern as `WorkbenchPanel`: `if (!open) return null`. No CSS transition needed — consistent with existing pattern.

### Props

```ts
interface PlannerAssistantProps {
  open: boolean
  onClose: () => void
  epic: TaskGroup | null         // null-safe: drawer guards against null before rendering content
  tasks: SprintTask[]            // already in PlannerView via groupTasks
  onOpenWorkbench: () => void    // calls setWorkbenchOpen(true) in PlannerView
}
```

`PlannerView` must gate `setAssistantOpen(true)` only when `selectedGroup != null`. If `selectedGroup` becomes null while the drawer is open (e.g. the epic is deleted), `PlannerView` should call `setAssistantOpen(false)` — add this as a `useEffect` on `selectedGroup`.


### Layout

```
┌─ drawer ──────────────────────────────────────────┐
│ header: [● live] Planning Assistant  [epic / N tasks] [✕] │
├───────────────────────────────────────────────────┤
│ messages (scrollable flex column)                  │
│   agent message (markdown text)                   │
│   action card (when assistant proposes a creation) │
│   user message                                    │
├───────────────────────────────────────────────────┤
│ input bar: [textarea] [↑ send]                    │
└───────────────────────────────────────────────────┘
```

Width: `min(560px, 60%)` — absolute-positioned over the main panel, leaving the epic sidebar visible.

### Context injected on open

Assembled from props — no extra IPC call:

```ts
{
  epicName: string
  epicGoal: string | null
  tasks: Array<{ id: string; title: string; status: string; hasSpec: boolean }>
}
```

Serialised into the system prompt prefix sent with the first message via `workbench:chatStream`.

### Streaming

Reuses `workbench:chatStream` IPC channel and its existing handler. No new IPC channels or backend handlers.

The handler requires a `formContext.repo` field and will error if it is not a configured repo name. Pass the first entry from the repos settings store (available via `useSettingsStore` or equivalent). This gives the assistant codebase awareness for free. If no repos are configured, disable the input bar and show a "Configure a repository in Settings to use the assistant" message.

### Action cards

When the assistant proposes a creation or update it emits a structured marker:

```
[ACTION:create-task]{"title":"...","spec":"..."}[/ACTION]
[ACTION:create-epic]{"name":"...","goal":"..."}[/ACTION]
[ACTION:update-spec]{"taskId":"<existing task id>","spec":"..."}[/ACTION]
```

`PlannerAssistant` strips these from the streamed text and renders each as an inline `ActionCard` component within the message flow.

**ActionCard buttons:**

| Button | Behaviour |
|--------|-----------|
| **Create / Apply** | Calls `window.api.sprint.create(...)` / `window.api.groups.create(...)` / `window.api.sprint.update(taskId, { spec })`, then appends "✓ Created" confirmation text into the chat |
| **Edit first** | Calls `useTaskWorkbenchStore.getState().resetForm()` then `setField(...)` to pre-populate the form (same pattern as `PlannerView.handleAddTask`), then calls `onOpenWorkbench()` and `onClose()` |
| **Skip** | Dismisses the card inline; no side effects |

### Reuse checklist

| Need | Reuse |
|------|-------|
| Slide-over mount pattern | `WorkbenchPanel` (`if (!open) return null`) |
| Streaming | `workbench:chatStream` IPC |
| Task creation | `window.api.sprint.create` |
| Epic creation | `window.api.groups.create` |
| Spec update | `window.api.sprint.update(taskId, { spec })` |
| Workbench pre-population | `useTaskWorkbenchStore.getState().resetForm()` + `setField(...)` |
| Styles | `--fleet-*` tokens; no new colour variables |

### What is NOT included

- Assistant cannot see other epics, the pipeline, or agent history.
- Text-only streaming with structured output markers; the frontend executes all actions.
- No chat history persistence across sessions.

---

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/lib/view-registry.ts` | Add `hidden?: true` to `ViewMetadata`; set on `git`; renumber settings/planner shortcuts |
| `src/renderer/src/stores/keybindings.ts` | Remove `view.git` from `ActionId`, `DEFAULT_KEYBINDINGS`, `ACTION_LABELS`; update settings→`⌘6`, planner→`⌘7` |
| `src/renderer/src/stores/sidebar.ts` | Remove `'git'` from `ALL_VIEWS` |
| `src/renderer/src/components/layout/CommandPalette.tsx` | Remove `view.git` nav command entry |
| `src/renderer/src/components/settings/KeybindingsSettings.tsx` | Remove `'view.git'` from `ACTION_ORDER` |
| `src/renderer/src/components/planner/EpicList.css` | Add pill shape to `.planner-epic-item__status` |
| `src/renderer/src/components/planner/EpicHeader.tsx` | Add `doneCount`/`totalCount` props; render 3px stripe and Ask AI button |
| `src/renderer/src/components/planner/EpicDetail.css` | Stripe styles |
| `src/renderer/src/components/planner/EpicDetail.tsx` | Compute `doneCount`/`totalCount`; pass to `EpicHeader`; pass `onOpenAssistant` |
| `src/renderer/src/views/PlannerView.tsx` | Add `assistantOpen` state; pass `onOpenAssistant`, `onOpenWorkbench`, `onClose` to `PlannerAssistant`; mount `PlannerAssistant` |
| `src/renderer/src/components/planner/PlannerAssistant.tsx` | **New** |
| `src/renderer/src/components/planner/PlannerAssistant.css` | **New** |
| `docs/modules/components/index.md` | Add `PlannerAssistant` row; update modified planner component rows |

---

## Testing

- **Source Control hidden**: sidebar no longer shows Source Control; `⌘6` opens Settings; `⌘7` opens Planner; Command Palette omits "Go to Source Control"; Keybindings settings page omits the row.
- **Status label pill**: `.planner-epic-item__status` renders as a pill with correct colour per status.
- **Progress stripe**: fills proportionally; transitions on task status change; hidden at zero tasks.
- **Ask AI button**: renders in epic header; opens assistant drawer on click; absent when no tasks.
- **Assistant drawer**: opens/closes; streams with epic context in system prompt; action cards render for each action type; Create/Apply calls correct IPC; Skip dismisses; Edit first pre-populates workbench form and opens `WorkbenchPanel`.
- **All existing planner tests pass.**
