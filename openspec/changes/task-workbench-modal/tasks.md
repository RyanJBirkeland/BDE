# Tasks — Task Workbench Modal

Implement in this order. Each task should leave the build green (`npm run typecheck && npm test && npm run lint`). Open the modal at the end of every task and confirm it still renders.

## 1. Create the modal store ✅

**File:** `src/renderer/src/stores/taskWorkbenchModal.ts` (new)

- Define `TaskWorkbenchModalState` with `open`, `editingTask`, and `lastFocusedElement` (ref-like — store the raw `HTMLElement | null`).
- Implement `openForCreate({ groupId? })` — captures `document.activeElement` as `lastFocusedElement`, calls `useTaskWorkbenchStore.getState().resetForm()`, optionally sets `pendingGroupId`, sets `open: true` and `editingTask: null`.
- Implement `openForEdit(task)` — captures `document.activeElement`, calls `useTaskWorkbenchStore.getState().loadTask(task)`, sets `open: true` and `editingTask: task`.
- Implement `close()` — sets `open: false`, leaves `editingTask` untouched until next open (avoids title flicker during exit transition). Restores focus to `lastFocusedElement` on the next tick.
- Tests in `src/renderer/src/stores/__tests__/taskWorkbenchModal.test.ts` covering each action.

## 2. Build the modal shell ✅

**File:** `src/renderer/src/components/task-workbench/TaskWorkbenchModal.tsx` (new) + `.css`

- Render a backdrop + dialog when `open`. Use a portal (`createPortal` to `document.body`) so the modal escapes any panel `overflow: hidden` ancestors.
- Header: title (`'New Task'` if `editingTask === null`, else `Edit: ${editingTask.title}` truncated to 80 chars with ellipsis) and a close button.
- Body: render `<TaskWorkbench onSubmitted={() => store.close()} />` — pass through any existing props.
- Implement `requestDismiss()` per design doc. Wire to backdrop `onClick`, X button `onClick`, and a keydown handler on the dialog for `Escape`.
- ARIA attributes (`role="dialog"`, `aria-modal`, `aria-labelledby`).
- Focus on mount: focus the title input (`document.getElementById('wb-title')` or via a ref bridge — see WorkbenchForm to find the input id).
- Focus trap: two sentinel divs at start/end of dialog with `tabIndex={0}` and a `focus` handler that wraps focus.

## 3. Surface `onSubmitted` from TaskWorkbench ✅

**File:** `src/renderer/src/components/task-workbench/TaskWorkbench.tsx`

- Add optional `onSubmitted?: () => void` prop. Pass it to `WorkbenchForm` (or wherever the create/queue handlers live — likely `useTaskCreation` or `WorkbenchActions`). On successful submit, call it.
- Update existing tests that render `TaskWorkbench` to ignore the new prop (it's optional).

## 4. Wire SprintPipeline ✅

**File:** `src/renderer/src/components/sprint/SprintPipeline.tsx`

- Replace the `onEdit` handler (line ~387) with `useTaskWorkbenchModalStore.getState().openForEdit(selectedTask)`.
- Remove the `loadTaskInWorkbench` import / variable.
- Verify by clicking Edit on a task in Pipeline: the modal opens, the Pipeline view stays visible behind it.

## 5. Wire PlannerView ✅

**File:** `src/renderer/src/views/PlannerView.tsx`

- Remove `const [workbenchOpen, setWorkbenchOpen] = useState(false)`.
- Replace `handleAddTask` and `handleEditTask` per design doc.
- Remove the `<WorkbenchPanel ... />` render.
- Remove the `WorkbenchPanel` import.
- Update `src/renderer/src/views/__tests__/PlannerView.test.tsx` to mock `useTaskWorkbenchModalStore` and assert `openForCreate` / `openForEdit` are called.

## 6. Mount the modal at app root ✅

**File:** `src/renderer/src/App.tsx`

- Import and render `<TaskWorkbenchModal />` alongside the existing `<ToastContainer />` (or equivalent root-level mounts).

## 7. Delete WorkbenchPanel ✅

```bash
rm src/renderer/src/components/planner/WorkbenchPanel.tsx
rm src/renderer/src/components/planner/WorkbenchPanel.css
```

- `grep -rn WorkbenchPanel src` should return nothing afterward. Delete any lingering test imports.

## 8. Z-index audit ✅

**File:** `src/renderer/src/assets/tokens.css` (or wherever overlay z-indexes live)

- Add `--bde-z-modal: 200;` and `--bde-z-overlay: 150;` if not already defined.
- Verify `PipelineOverlays`, `DagOverlay`, `PlaygroundModal`, and `TaskDetailDrawer` use ≤ 150. Bump them to use the token if they hardcode values.

## 9. Module documentation ✅

Per CLAUDE.md pre-commit requirement, update:

- `docs/modules/components/index.md` — add row for `TaskWorkbenchModal` (group `task-workbench`); remove row for `WorkbenchPanel`.
- `docs/modules/stores/index.md` — add row for `taskWorkbenchModal`.
- Create `docs/modules/components/TaskWorkbenchModal.md` (Public API: default export + `openForCreate` / `openForEdit` behavior).

## 10. Verification ✅

Before committing:

```bash
npm run typecheck   # zero errors
npm test            # all green
npm run lint        # zero errors
```

Manual smoke:

1. Pipeline → click a task → click Edit → modal opens, Pipeline visible behind. Click X → modal closes. Click Edit again, type in title, click backdrop → confirm prompt appears. Confirm Discard → modal closes, no save.
2. Planner → select an epic → Add Task → modal opens with `pendingGroupId` set, title says "New Task". Type a title → ESC → confirm prompt. Cancel → modal stays open, focus returned to title input.
3. Planner → select a task → modal opens with title `Edit: <task title>`. Save Changes → modal closes, task list reflects update.
4. Modal width is comfortable on a 1440px viewport; spec textarea and Copilot are both readable.

## Test coverage

New / updated tests:

- `src/renderer/src/stores/__tests__/taskWorkbenchModal.test.ts` (new): open/close, focus capture, form-store interaction.
- `src/renderer/src/components/task-workbench/__tests__/TaskWorkbenchModal.test.tsx` (new): renders when open, dirty dismissal triggers confirm, clean dismissal closes immediately, ESC closes, backdrop click closes, X closes, focus-trap wraps.
- `src/renderer/src/views/__tests__/PlannerView.test.tsx`: replace `workbenchOpen` assertions with modal-store assertions.
- `src/renderer/src/components/sprint/__tests__/SprintPipeline.test.tsx` (if it exists): assert Edit calls `openForEdit` and does not call `setView`.

## Out of scope (not in this change)

- Generic `<Modal>` primitive extraction.
- Global keyboard shortcut to launch New Task.
- Neon theme pass on the modal shell.
- Any change to `taskWorkbench` form fields, validation, or persistence.
