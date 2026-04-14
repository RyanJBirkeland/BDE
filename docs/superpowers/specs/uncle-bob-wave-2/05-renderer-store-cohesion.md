# Renderer Store Cohesion

## Goal

Improve separation of concerns across four large renderer files by extracting cohesion violations into focused modules. No behavioral changes — only restructuring to reduce mixed responsibilities.

## Files Analyzed

| File | Lines | Status |
|------|-------|--------|
| `src/renderer/src/stores/sprintTasks.ts` | ~442 | Optimistic update logic tangled with polling |
| `src/renderer/src/stores/taskWorkbench.ts` | ~389 | Validation state mixed with form state |
| `src/renderer/src/stores/ide.ts` | ~348 | File cache mixed with editor tab state |
| `src/renderer/src/components/sprint/SprintPipeline.tsx` | ~483 | Mega-coordinator with 7+ store subscriptions inline |

Already-split stores (`sprintUI.ts`, `sprintSelection.ts`, `sprintFilters.ts`) are **correct and complete — do not re-split**.

## Findings per File

### sprintTasks.ts
- Optimistic update protection (`pendingUpdates`, `pendingCreates`, TTL expiry, field merging) is scattered across `loadData()`, `updateTask()`, `mergeSseUpdate()` — tangled, hard to test independently
- Business logic (WIP checks, agent spawning, repo path lookup) lives inline in `launchTask()` action

### taskWorkbench.ts
- Validation results (`structuralChecks`, `semanticChecks`, `operationalChecks`) are stored state but conceptually separate from the form state they validate
- Draft persistence (localStorage, debouncing, `PersistedDraft`) mixes form domain with storage domain

### ide.ts
- File content caching (`fileContents`, `fileLoadingStates`) belongs in a dedicated cache store, not mixed with tab/layout state
- Clearing cache on tab close requires cross-concern coupling

### SprintPipeline.tsx
- Subscribes to 7+ stores directly in the component body — presentation and data orchestration mixed
- Computed lookups (task by ID, stats, conflict detection) re-calculated on every render

## Recommended Extractions

### A. Extract optimistic update logic from `sprintTasks.ts`

Create `src/renderer/src/lib/optimisticUpdateManager.ts` with pure functions:
- `mergePendingFields(serverTask, pendingUpdates)` — preserve pending fields, merge rest from server
- `expirePendingUpdates(pendingUpdates, ttlMs)` — filter out expired entries
- `trackPendingOperation(pendingUpdates, taskId, fields)` — add tracking entry

Update `sprintTasks.ts` to import and call these functions in `loadData()`, `updateTask()`, `mergeSseUpdate()`. Remove inline TTL and merge logic. **`pendingUpdates` state stays in the store** — only the logic is extracted.

### B. Extract validation state from `taskWorkbench.ts`

Create `src/renderer/src/stores/taskWorkbenchValidation.ts` — new Zustand store:
- State: `structuralChecks`, `semanticChecks`, `operationalChecks`, `semanticLoading`, `operationalLoading`
- Actions: `setStructuralChecks()`, `setSemanticChecks()`, `setOperationalChecks()`

Remove validation state from `useTaskWorkbenchStore`. Update all components that read/set validation checks to use the new store. Form state, dirty tracking, and `isDirty()` stay in `taskWorkbench.ts`.

### C. Extract file cache from `ide.ts`

Create `src/renderer/src/stores/ideFileCache.ts` — new Zustand store:
- State: `fileContents: Record<string, string>`, `fileLoadingStates: Record<string, boolean>`
- Actions: `setFileContent(path, content)`, `setFileLoading(path, loading)`, `clearFileContent(path)`

Remove `fileContents` and `fileLoadingStates` from `useIDEStore`. Update `closeTab()` in ide.ts to call `ideFileCache.clearFileContent(path)` when closing the last tab for a file. Update all components that read file content to import from `useIDEFileCache`.

### D. Extract store orchestration from `SprintPipeline.tsx`

Create `src/renderer/src/hooks/useSprintPipelineState.ts`:
- Centralizes all store subscriptions (sprintTasks, sprintSelection, sprintUI, filters, workbench, codeReview, events)
- Returns memoized data object: `{ tasks, selectedTask, loading, loadError, partition, stats, conflicts, ... }`
- Computes derived values (selected task lookup, conflict detection, stats) inside the hook

Update `SprintPipeline.tsx` to call `useSprintPipelineState()` and destructure. Component body stays at ~200 LOC focused on layout + rendering.

## Implementation Steps

1. Create `src/renderer/src/lib/optimisticUpdateManager.ts` — pure functions only, no Zustand imports
2. Update `src/renderer/src/stores/sprintTasks.ts` — import from optimisticUpdateManager, remove inline logic, preserve all existing public actions and state shape
3. Create `src/renderer/src/stores/taskWorkbenchValidation.ts` — new Zustand store, validation state only
4. Update `src/renderer/src/stores/taskWorkbench.ts` — remove validation state; update actions that set checks to delegate to new store
5. Update components that read validation checks (TaskWorkbench form components) — import from `useTaskWorkbenchValidation`
6. Create `src/renderer/src/stores/ideFileCache.ts` — new Zustand store, file content only
7. Update `src/renderer/src/stores/ide.ts` — remove file cache state; update `closeTab()` to call `ideFileCache.clearFileContent()`
8. Update components that read file content — import from `useIDEFileCache`
9. Create `src/renderer/src/hooks/useSprintPipelineState.ts` — extract and memoize all store subscriptions from SprintPipeline
10. Update `src/renderer/src/components/sprint/SprintPipeline.tsx` — replace direct store calls with `useSprintPipelineState()`

## Files to Change

**Create (4 new files):**
- `src/renderer/src/lib/optimisticUpdateManager.ts`
- `src/renderer/src/stores/taskWorkbenchValidation.ts`
- `src/renderer/src/stores/ideFileCache.ts`
- `src/renderer/src/hooks/useSprintPipelineState.ts`

**Modify (4 existing files):**
- `src/renderer/src/stores/sprintTasks.ts`
- `src/renderer/src/stores/taskWorkbench.ts`
- `src/renderer/src/stores/ide.ts`
- `src/renderer/src/components/sprint/SprintPipeline.tsx`

**Modify (components that use moved state — grep to find):**
```bash
grep -rl "structuralChecks\|semanticChecks\|operationalChecks" src/renderer/src
grep -rl "fileContents\|fileLoadingStates" src/renderer/src
```

**Update module docs:**
- `docs/modules/stores/index.md` — add rows for `taskWorkbenchValidation`, `ideFileCache`
- `docs/modules/hooks/index.md` — add row for `useSprintPipelineState`
- `docs/modules/lib/renderer/index.md` — add row for `optimisticUpdateManager`

## How to Test

**Important gotcha:** In Zustand tests, set store state BEFORE `render()` — calling `setState` after render does not trigger re-renders in test environments.

1. **optimisticUpdateManager.ts** — pure function unit tests:
   - `mergePendingFields`: server task + pending fields → pending fields preserved, non-pending overwritten
   - `expirePendingUpdates`: entries older than TTL removed, fresh entries kept
   - `trackPendingOperation`: adds entry with correct timestamp and fields

2. **taskWorkbenchValidation.ts** — unit tests:
   - Form updates in `taskWorkbench` do not mutate validation store
   - Setting checks via `useTaskWorkbenchValidation` does not affect `isDirty()` in form store

3. **ideFileCache.ts** — unit tests:
   - After `closeTab()` for last tab on a file, `fileContents[path]` is removed from cache
   - Re-opening same file path starts with empty cache (triggers fresh load)

4. **useSprintPipelineState hook** — unit tests:
   - Filtering tasks via `sprintFilters` store → hook returns filtered partition
   - `selectedTaskId` change → hook returns updated `selectedTask`

5. **Integration** — run full suite and verify no regressions:
   ```bash
   npm run typecheck && npm test
   ```

6. **Visual smoke test** — run `npm run dev`, verify Task Pipeline view renders correctly, filtering works, task selection opens drawer, IDE file content loads and caches properly.
