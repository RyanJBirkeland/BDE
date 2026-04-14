# Components

React UI components, organized by domain group.
Source: `src/renderer/src/components/`

| Module | Group | Purpose | Key Exports |
|--------|-------|---------|-------------|
| `ReviewQueue.tsx` | code-review | Displays tasks awaiting review with keyboard navigation (j/k). Scoped store subscription via `useShallow` to avoid re-renders on unrelated task changes. | `ReviewQueue` |
| `Sidebar.tsx` | layout | Persistent nav sidebar with view badges for review/failed counts. Uses named selectors from sprintTasks store. | `Sidebar` |
| `AgentCard.tsx` | agents | Compact card showing agent status, cost, and duration. Uses `useBackoffInterval` for the live duration ticker. | `AgentCard` |
| `WorkbenchForm.tsx` | task-workbench | Task creation/edit form with AI copilot, dependency picker, and validation checks. Uses `useShallow` for tasks subscription. | `WorkbenchForm` |
| `BatchActionsToolbar.tsx` | code-review | Renders the batch action buttons (Merge All, Ship All, Create PRs, Discard All, Clear) with in-flight spinner state. Extracted from `TopBar` to eliminate JSX duplication. | `BatchActionsToolbar` |
