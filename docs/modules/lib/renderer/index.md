# Lib — Renderer

Utility functions and shared helpers for the renderer process.
Source: `src/renderer/src/lib/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `copy-to-clipboard.ts` | Copy text to system clipboard with standard BDE toast feedback. Shows "Copied to clipboard" on success, "Could not copy — please copy manually" on failure. Shared helper extracted from onboarding steps. | `copyToClipboard` |
| `render-markdown.ts` | Convert markdown to sanitized HTML safe for dangerouslySetInnerHTML. Includes DOMPurify hook that validates href protocols (https/http/mailto only). | `renderMarkdown` |
| `dashboard-types.ts` | Shared dashboard domain types used by stores and components. Owns `FeedEvent` to keep the store layer free of component imports. | `FeedEvent` |
| `optimisticUpdateManager.ts` | Pure functions for managing optimistic update state in the sprint tasks store. No Zustand dependency. `PendingUpdate.fields` is typed `readonly SprintTaskField[]` (alias for `keyof SprintTask`) so typoed field names are a compile error at every producer. | `mergePendingFields`, `expirePendingUpdates`, `trackPendingOperation`, `PendingUpdate`, `PendingUpdates`, `SprintTaskField` |
| `task-status-ui.ts` | Backward-compatible re-export shim. `STATUS_METADATA`, `BucketKey`, and `StatusMetadata` now live in `src/shared/task-statuses.ts`; this file re-exports them for renderer callers. | `STATUS_METADATA`, `BucketKey`, `StatusMetadata` |
| `view-resolver.tsx` | Maps `View` keys to lazily-loaded React components. Moved from `components/layout/` to break the `layout↔panels` import cycle. Also exports `VIEW_LOADERS` for hover-based preloading. | `resolveView`, `VIEW_LOADERS` |
| `services/git.ts` | Git IPC adapter — wraps `window.api.git.*` for use by stores | `getRepoPaths`, `getGitStatus`, `getGitDiff`, `stageFiles`, `unstageFiles`, `commit`, `push`, `getBranches` |
| `services/sprint.ts` | Sprint task IPC adapter — wraps `window.api.sprint.*` | `listTasks`, `updateTask`, `deleteTask`, `createTask`, `batchUpdate`, `generatePrompt` |
| `services/groups.ts` | Task groups IPC adapter — wraps `window.api.groups.*` | `listGroups`, `getGroupTasks`, `createGroup`, `updateGroup`, `deleteGroup`, `addTask`, `removeTask`, `queueAll`, `reorderTasks`, `addDependency`, `removeDependency`, `updateDependencyCondition` |
| `services/settings-storage.ts` | Settings persistence IPC adapter — wraps `window.api.settings.*` | `getSetting`, `setSetting`, `getJsonSetting`, `setJsonSetting` |
| `services/agents.ts` | Agent management IPC adapter — wraps `window.api.agents.*` | `subscribeToAgentEvents`, `getAgentEventHistory`, `listAgents`, `readAgentLog`, `importAgent`, `getProcesses`, `spawnLocal`, `tailLog` |
| `services/dashboard.ts` | Dashboard/system/PR metrics IPC adapter — wraps `window.api.dashboard.*`, `window.api.system.*`, `window.api.pr.*` | `getCompletionsPerHour`, `getRecentEvents`, `getPrList`, `getDailySuccessRate`, `getLoadAverage` |
| `services/cost.ts` | Cost history IPC adapter — wraps `window.api.cost.*` | `getAgentCostHistory` |
| `view-registry.ts` | Single source of truth for view metadata (label, icon, shortcut, description). `ViewMetadata` interface includes optional `hidden?: true` flag — hidden views are excluded from sidebar and navigation. Derives backward-compat exports `VIEW_LABELS`, `VIEW_ICONS`, `VIEW_SHORTCUTS`, `VIEW_SHORTCUT_MAP`. | `VIEW_REGISTRY`, `ViewMetadata`, `VIEW_LABELS`, `VIEW_ICONS`, `VIEW_SHORTCUTS`, `VIEW_SHORTCUT_MAP` |
| `utils.ts` | Shared renderer utilities. | `cwdToRepoLabel` |
| `format.ts` | Pure formatting utilities for the renderer. `repoColor(repoName, repos)` and `repoBadgeVariant(repoName, repos)` both accept an explicit `RepoOption[]` list — no hardcoded repo names. Badge variant derived from index-based cycle (0→info, 1→warning, 2→success). Also exports `timeAgo`, `formatElapsed`, `formatDuration`, `formatDurationMs`, `modelBadgeLabel`, `formatDate`, `formatTime`. | `timeAgo`, `formatElapsed`, `formatDuration`, `formatDurationMs`, `modelBadgeLabel`, `repoBadgeVariant`, `repoColor`, `formatDate`, `formatTime` |
