# Stores

Zustand state stores. One store per domain concern.
Source: `src/renderer/src/stores/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `sprintTasks.ts` | Primary sprint task store — CRUD, optimistic updates, polling merge. | `useSprintTasks`, `selectActiveTaskCount`, `selectReviewTaskCount`, `selectFailedTaskCount` |
| `sprintSelection.ts` | Task selection state — selected task ID, multi-select set, drawer open state. | `useSprintSelection`, `selectSelectedTaskId`, `selectSelectedTaskIds`, `selectLogDrawerTaskId`, `selectDrawerOpen`, `selectSpecPanelOpen`, `selectIsTaskSelected` |
| `sprintFilters.ts` | Sprint pipeline filter state — status, repo, tag, search query. | `useSprintFilters`, `selectStatusFilter`, `selectRepoFilter`, `selectTagFilter`, `selectSearchQuery`, `StatusFilter` |
| `sprintUI.ts` | Sprint pipeline UI state — drawer visibility, display density, generating task IDs. | `useSprintUI`, `selectDoneViewOpen`, `selectConflictDrawerOpen`, `selectHealthCheckDrawerOpen`, `selectQuickCreateOpen`, `selectPipelineDensity`, `selectGeneratingIds`, `selectIsGenerating`, `PipelineDensity` |
| `notifications.ts` | Persistent notification history — last 50 critical events, persisted to localStorage. | `useNotificationsStore`, `selectUnreadCount`, `Notification`, `NotificationType` |
| `taskWorkbenchValidation.ts` | Validation check results for the Task Workbench (structural, semantic, operational). Extracted from `taskWorkbench.ts` for cohesion. | `useTaskWorkbenchValidation` |
| `ideFileCache.ts` | File content and loading-state cache for the IDE editor. Extracted from `ide.ts` for cohesion. | `useIDEFileCache` |
