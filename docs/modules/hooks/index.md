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
| `useSprintPipelineState.ts` | Centralises all store subscriptions for SprintPipeline. Returns tasks, selection, UI overlay state, and derived values. | `useSprintPipelineState` |
| `useAgentViewLifecycle.ts` | Registers the five view-lifecycle effects for AgentsView: event listener init, history fetch, event history load, spawn-modal listener, scratchpad banner check. | `useAgentViewLifecycle` |
| `useAgentViewCommands.ts` | Registers and unregisters Spawn Agent and Clear Console commands in the command palette while AgentsView is mounted. | `useAgentViewCommands` |
| `useAgentSlashCommands.ts` | Handles slash commands in AgentConsole: /stop, /retry, /focus, /checkpoint, /test, /scope, /status. Returns handleCommand. | `useAgentSlashCommands` |
| `useBatchActions.ts` | Wraps useBatchReviewActions with confirm dialogs and in-flight state tracking for batch merge/ship/PR/discard. Used by TopBar. | `useBatchActions`, `BatchActionKey` |
| `useGitCommands.ts` | Registers git operation commands (stage all, commit, push, switch branch) in the command palette. Extracted from GitTreeView. | `useGitCommands` |
| `useWebhookManager.ts` | Owns all webhook CRUD state and async operations (list, create, update, delete, test). Returns state and handlers for the webhook settings UI. | `useWebhookManager`, `WebhookManager` |
| `useVisibleStuckTasks.ts` | Derives the list of stuck tasks that have not been dismissed. Composes `useHealthCheckStore` + `useSprintTasks` — lives in hooks (not stores) to keep cross-store logic out of the store layer. | `useVisibleStuckTasks` |
| `useBatchReviewActions.ts` | Batch review actions (merge locally, ship it, create PR, discard) over a set of tasks. Shared loop-count-toast logic extracted into file-private `executeBatchAction`. | `useBatchReviewActions`, `UseBatchReviewActionsResult` |
