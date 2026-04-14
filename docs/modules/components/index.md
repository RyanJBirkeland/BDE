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
| `VirtualizedDiffContent.tsx` | diff | Virtualized rendering of diff rows (file headers, hunk headers, lines). Manages scroll/viewport via ResizeObserver and binary-search visibility window. Exports shared row types (`FlatRow`, `HunkAddress`) and height constants used by `DiffViewer`. | `VirtualizedDiffContent`, `FlatRow`, `HunkAddress`, `rowHeight`, `ROW_HEIGHT`, `FILE_HEADER_HEIGHT`, `HUNK_HEADER_HEIGHT` |
| `VirtualizedDiffBanner.tsx` | diff | Banner shown above large diffs in virtualized mode, with a "Load full diff" button to disable virtualization and enable commenting. | `VirtualizedDiffBanner` |
