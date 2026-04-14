# Hooks

React hooks for shared logic across components.
Source: `src/renderer/src/hooks/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `useFilteredTasks.ts` | Derives filtered and partitioned task subsets from sprint store + UI filter state. Uses `useShallow` to prevent re-renders when task array contents are unchanged. | `useFilteredTasks` |
| `useIDEFileOperations.ts` | Manages IDE file I/O: loads file content on tab switch, exposes save/change/close/open-folder/open-file handlers. Encapsulates the saving-in-progress guard ref. | `useIDEFileOperations` |
| `useIDEKeyboard.ts` | Registers IDE keyboard shortcuts (Cmd+S/W/O/B/J/P, terminal shortcuts) while the IDE view is active. | `useIDEKeyboard` |
| `useIDEStateRestoration.ts` | On mount, reads `ide.state` from settings and restores rootPath, open tabs, active tab, and display preferences to the IDE store. | `useIDEStateRestoration` |
| `useIDEUnsavedGuard.ts` | Registers a `beforeunload` handler that blocks page unload when any open IDE tab has unsaved changes. | `useIDEUnsavedGuard` |
| `useSprintPipelineState.ts` | Centralises all store subscriptions for `SprintPipeline`. Returns tasks, selection, UI overlay state, and derived values (selectedTask, conflictingTasks, partition). | `useSprintPipelineState` |
