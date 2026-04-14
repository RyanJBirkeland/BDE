# Stores

Zustand state stores. One store per domain concern.
Source: `src/renderer/src/stores/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `sprintTasks.ts` | Primary sprint task store — CRUD, optimistic updates, polling merge. | `useSprintTasks`, `selectActiveTaskCount`, `selectReviewTaskCount`, `selectFailedTaskCount` |
| `healthCheck.ts` | Tracks stuck task IDs and dismissed IDs for the health-check overlay. Cross-store derived view (`useVisibleStuckTasks`) lives in `hooks/useVisibleStuckTasks.ts`. | `useHealthCheckStore` |
| `taskWorkbenchValidation.ts` | Validation check results for the Task Workbench (structural, semantic, operational). Extracted from `taskWorkbench.ts` for cohesion. | `useTaskWorkbenchValidation` |
| `ideFileCache.ts` | File content and loading-state cache for the IDE editor. Extracted from `ide.ts` for cohesion. | `useIDEFileCache` |
