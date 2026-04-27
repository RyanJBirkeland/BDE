# Design — Task Workbench Modal

## Overview

Move the existing `TaskWorkbench` component from a 480px right-edge slide-over (`WorkbenchPanel`) into a centered modal shell. The form, Copilot, validation, and persistence layers are unchanged. This document describes the modal shell, the modal store, the dismissal flow, and the integration points in Task Pipeline and Task Planner.

## Architecture

### Component layout

```
<App>
  <PanelRenderer />            // unchanged
  <TaskWorkbenchModal />        // new — mounted once at app root
</App>

TaskWorkbenchModal
├── Backdrop                     // fixed, full-viewport, 50% black
└── Dialog                       // 1200×800, max 95vw / 90vh, centered
    ├── Header                   // title + close button
    │   ├── Title                // "New Task" | `Edit: ${task.title}`
    │   └── CloseButton          // X — calls requestDismiss()
    └── Body
        └── TaskWorkbench        // existing component, unchanged
```

`TaskWorkbench` already arranges form + Copilot side-by-side via `react-resizable-panels` (`Group` + `Panel` + `Separator`). That layout is preserved. The modal body is a `flex: 1; min-height: 0` container so the inner `Group` fills the available height correctly.

### Modal state — `taskWorkbenchModal` store

A small new Zustand store. It owns *only* the shell concerns; form state continues to live in the existing `taskWorkbench` store.

```ts
interface TaskWorkbenchModalState {
  open: boolean
  // null when creating; the SprintTask being edited otherwise.
  // We keep the task itself (not just an id) so the title can render
  // synchronously without re-querying the sprint store.
  editingTask: SprintTask | null

  openForCreate: (preset?: { groupId?: string }) => void
  openForEdit: (task: SprintTask) => void
  close: () => void
}
```

Open helpers wrap the form-store mutations that callers do today inline. For example, `openForCreate` calls `useTaskWorkbenchStore.getState().resetForm()` and (if `preset.groupId` is set) `setField('pendingGroupId', groupId)`. `openForEdit` calls `loadTask(task)`. This is the shape PlannerView and SprintPipeline want — they should not have to know the form-store API to launch the modal.

### Dismissal flow

The modal exposes one entry point — `requestDismiss()` — used by all three close paths (ESC, backdrop click, X button). Single function so the dirty check can't drift between paths.

```ts
async function requestDismiss(): Promise<void> {
  const dirty = useTaskWorkbenchStore.getState().isDirty()
  if (!dirty) {
    closeAndReset()
    return
  }
  const confirmed = await confirm({
    title: 'Discard changes?',
    message: 'You have unsaved changes to this task. Discard them?',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
    destructive: true
  })
  if (confirmed) closeAndReset()
}
```

`closeAndReset()` calls `useTaskWorkbenchModalStore.close()` and `useTaskWorkbenchStore.resetForm()`. The `confirm` helper is the existing `useConfirm` hook used by Planner and Code Review — no new dialog primitive.

`isDirty()` already exists on the form store and compares the current snapshot against `originalSnapshot` (the baseline captured by `resetForm` / `loadTask`). We do not duplicate that logic.

### Save flow

When the user clicks `Save Changes` or `Queue Now` (existing `WorkbenchActions`), the action handler calls the existing creation / update services, *and on success* calls `useTaskWorkbenchModalStore.getState().close()`. We wire this through a callback prop on `TaskWorkbench` so the form component stays modal-agnostic:

```tsx
<TaskWorkbench onSubmitted={() => modal.close()} onSendCopilotMessage={...} />
```

`onSubmitted` is optional. When the workbench is rendered outside a modal context (it isn't today, but this keeps the door open), the prop is omitted and submission behaves as it does today.

### Modal CSS / sizing

```css
.task-workbench-modal__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.task-workbench-modal__dialog {
  width: 1200px;
  height: 800px;
  max-width: 95vw;
  max-height: 90vh;
  background: var(--bde-surface-1);
  border: 1px solid var(--bde-border);
  border-radius: 8px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden; /* clip Copilot's internal scroll containers */
}

.task-workbench-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--bde-border);
  flex-shrink: 0;
}

.task-workbench-modal__body {
  flex: 1;
  min-height: 0;
  display: flex; /* lets the inner resizable Group fill height */
}
```

Tokens: `--bde-surface-1`, `--bde-border` (existing). The neon theme will get a separate visual pass if/when we apply it; this change ships the structural modal first.

### Accessibility

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby="task-workbench-modal-title"`.
- ESC key bound at the dialog level (not document level) so a focused IDE terminal in another panel does not steal it.
- Initial focus moves to the title input on open.
- Focus is trapped inside the dialog while open. Use a small focus-trap (start/end sentinel `<div tabIndex={0}>` pattern) — no new dependency.
- On close, focus returns to the element that opened the modal. `TaskWorkbenchModal` accepts an internal `lastFocusedElement` ref captured in `openForCreate` / `openForEdit`.

### Entry-point integrations

**SprintPipeline.tsx (line ~387):**

```tsx
// before
onEdit={() => {
  loadTaskInWorkbench(selectedTask)
  setView('planner')
}}

// after
onEdit={() => useTaskWorkbenchModalStore.getState().openForEdit(selectedTask)}
```

`loadTaskInWorkbench` is removed from this file's imports.

**PlannerView.tsx:**

```tsx
// remove: const [workbenchOpen, setWorkbenchOpen] = useState(false)
// remove: <WorkbenchPanel open={workbenchOpen} onClose={...} />

const handleAddTask = useCallback(() => {
  useTaskWorkbenchModalStore.getState().openForCreate({ groupId: selectedGroupId })
}, [selectedGroupId])

const handleEditTask = useCallback(
  (taskId: string) => {
    const task = groupTasks.find((t) => t.id === taskId)
    if (task) useTaskWorkbenchModalStore.getState().openForEdit(task)
  },
  [groupTasks]
)
```

**App.tsx:** mount `<TaskWorkbenchModal />` once, alongside `<ToastContainer />` and the panel renderer.

### Files removed

- `src/renderer/src/components/planner/WorkbenchPanel.tsx`
- `src/renderer/src/components/planner/WorkbenchPanel.css`

Tests that referenced `WorkbenchPanel` (search: `grep -rn WorkbenchPanel src`) get rewritten or deleted as part of the same change. The `__tests__/PlannerAssistant.test.tsx` and `__tests__/PlannerView.test.tsx` files mock `useTaskWorkbenchStore` already; they get a parallel mock for `useTaskWorkbenchModalStore`.

## Trade-offs

**Why a fresh modal store instead of putting `open`/`editingTask` on `taskWorkbench`?**

The form store is already large (~280 lines, draft persistence, validation interplay). Adding shell state would couple two concerns that change for different reasons (Single Responsibility). The modal store is ~30 lines and never persists.

**Why not wrap the modal in a generic `<Modal>` primitive?**

There is no generic modal primitive in the codebase yet (Code Review and Settings don't use one). Introducing one as part of *this* change is scope creep — the Boy Scout Rule says leave the area cleaner, not refactor unrelated UI. We build the specific modal here; if a second modal need arises, a follow-up extracts the primitive.

**Why keep `react-resizable-panels` inside the modal?**

The form/Copilot split is genuinely resizable today and users may have set a preferred ratio. Keeping the same layout component preserves that affordance and avoids a re-skin. The modal's `flex: 1; min-height: 0` body handles the height contract `Group` needs.

**Why not bind a global keyboard shortcut to open New Task?**

`Cmd+0` is taken by IDE terminal zoom-reset. We could wire `Cmd+N` or similar, but the entry-points are already obvious buttons in Pipeline and Planner. Adding a shortcut is a separate, low-cost follow-up if users ask for it.

## Risks

- **Form persistence across modal opens.** Today the workbench draft persists to localStorage every 500ms. If a user closes the modal mid-draft (and the dirty-check is somehow bypassed), the draft survives and the next "New Task" open shows it. This is current behavior and is *desirable* — we keep it. The dirty-check protects against accidental ESC; it does not erase legitimate drafts on Save success (Save calls `resetForm()` which clears both the form and the persisted draft).
- **Z-index conflicts with existing overlays.** The current drawer uses `z-index: 100`. Other overlays (PipelineOverlays, DagOverlay, PlaygroundModal) need an audit so the new modal layers above them. The simple rule: modal at `200`, backdrop at `200`, all other overlays stay ≤ `150`. Codified as a token in `tokens.css` if there are more than two consumers.
- **Test churn.** PlannerView's existing tests assert that clicking "Add Task" sets internal state. Those assertions are replaced with assertions against the new modal store mock.
