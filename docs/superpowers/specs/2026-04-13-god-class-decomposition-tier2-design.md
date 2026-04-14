# God Class Decomposition — Tier 2 (UI & Infrastructure)

**Date:** 2026-04-13  
**Status:** Approved  
**Scope:** 6 files, structural extraction only — no behavior changes  
**Source audit:** `docs/superpowers/audits/2026-04-13/uncle-bob/team-3-solid/lens-srp.md`

---

## Goal

Decompose 6 god classes identified in the Uncle Bob audit. Each file currently has 2–6 independent reasons to change. After decomposition, each file has one responsibility. No behavior changes — all existing tests must continue to pass.

These are independent refactors. All 6 can be executed as parallel pipeline agent tasks in separate worktrees.

---

## Task 1: EpicDetail.tsx (746L → 5 files)

**File:** `src/renderer/src/components/planner/EpicDetail.tsx`  
**Approach:** B — file split + extract custom hook for drag state

### Extraction plan

| New file | Responsibility | Owns |
|----------|---------------|------|
| `EpicHeader.tsx` | Epic name, goal, icon, status badge, overflow menu | Read-only render |
| `EpicProgress.tsx` | Task status counts, progress bar calculation and render | Pure computation from task array |
| `TaskRow.tsx` | Single task row render + inline spec editing | Own edit open/close state |
| `TaskList.tsx` | Map task array to rows, drag/drop coordination | `dragIndex`, `dragOverIndex` state; calls `onReorderTasks` |
| `EpicDetail.tsx` | Thin facade — composes header, progress, task list | `onQueueAll`, `onAddDependency`, epic-level callbacks |

### Constraints
- `TaskRow` inline spec editing state (`isEditingSpec`, `editedSpec`) moves from EpicDetail into TaskRow
- Drag state (`dragIndex`, `dragOverIndex`) moves from EpicDetail into TaskList
- `EpicDetail` passes callbacks down; no internal state beyond what's needed for child coordination
- All `useMemo` hooks for derived values move to the component that owns the data

---

## Task 2: MemorySection.tsx (592L → 4 components + 1 hook)

**File:** `src/renderer/src/components/settings/MemorySection.tsx`  
**Approach:** B — file split + extract data-fetching hook

### Extraction plan

| New file | Responsibility | Owns |
|----------|---------------|------|
| `MemoryFileList.tsx` | Render grouped file list (pinned/daily/projects/other) | `files`, `loadingFiles` |
| `MemoryFileEditor.tsx` | Textarea editor, save/discard buttons | `selectedPath`, `content`, `savedContent`, `isDirty` |
| `MemorySearch.tsx` | Search input, results dropdown, debounce | `searchQuery`, `searchResults`, `isSearching` |
| `useMemoryFiles.ts` | `listFiles()`, `loadFiles()`, `loadActiveFiles()` IPC calls | Returns `{ files, activeFiles, loading, reload }` |
| `MemorySection.tsx` | Tab/panel coordinator; composes above | Minimal: selected file for editor coordination |

### Constraints
- `useMemoryFiles` is a pure data hook — no UI concerns
- Dirty state check before switching files remains in `MemorySection` as coordination logic (it gates the switch)
- File creation (`creating` state + new-file flow) stays in `MemorySection` as it coordinates list reload

---

## Task 3: WorkbenchForm.tsx (570L → 3 hooks + thin component)

**File:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`  
**Approach:** B — extract logic into custom hooks, leave UI in component

### Extraction plan

| New file | Responsibility | Owns |
|----------|---------------|------|
| `useTaskFormState.ts` | Wraps `useTaskWorkbenchStore`; derives `isDirty`, `isValid`, `canQueue` | Store proxy + derived state |
| `useSpecQualityChecks.ts` | Debounced semantic check; calls `window.api.workbench.checkSpec()` | `checks`, `isChecking`, `checkError` |
| `useTaskCreation.ts` | `createOrUpdateTask()` logic; calls IPC; handles both create and edit flows | Returns `{ save, isSaving, error }` |
| `WorkbenchForm.tsx` | UI only; composes hooks; renders form fields, check indicators, queue button | No business logic |

### Constraints
- `WorkbenchForm` imports only from the three hooks above — no direct `useTaskWorkbenchStore.getState()` calls
- `useTaskCreation` uses stable refs to avoid stale closures (replaces the current `getState()` escape hatch)
- Queue confirmation modal state stays in `WorkbenchForm` (pure UI concern)

---

## Task 4: tearoff-manager.ts (633L → 4 files)

**File:** `src/main/tearoff-manager.ts`  
**Approach:** A — mechanical split, no new abstractions

### Extraction plan

| New file | Responsibility | Owns |
|----------|---------------|------|
| `tearoff-window-manager.ts` | BrowserWindow creation, setup, 2-phase close flow | `tearoffWindows: Map` |
| `tearoff-state-persistence.ts` | Debounced bounds save to settings | `resizeTimers: Map` |
| `cross-window-drag-coordinator.ts` | Cursor polling, window hit-test, drag IPC messaging | `activeDrag` state |
| `tearoff-handlers.ts` | Registers all tearoff-related IPC channels; calls above modules | No state of its own |
| `tearoff-manager.ts` | Re-exports `registerTearoffHandlers` — backward-compat shim | Thin |

### Constraints
- `tearoff-window-manager` receives a bounds-save callback instead of importing persistence directly
- All `setInterval`/`clearInterval` for cursor polling stays in drag coordinator
- IPC channel strings come from `src/shared/ipc-channels/` — no new inline strings

---

## Task 5: panelLayout.ts (562L → 3 files)

**File:** `src/renderer/src/stores/panelLayout.ts`  
**Approach:** A — extract pure functions, keep store thin

### Extraction plan

| New file | Responsibility | Owns |
|----------|---------------|------|
| `panel-tree.ts` | Pure tree functions: `createLeaf`, `findLeaf`, `findLeafParent`, `splitNode`, `addTab`, `closeTab`, `moveTab`, `setActiveTab` | No state — pure input→output |
| `panel-persistence.ts` | `loadLayout()`, `saveLayout()` — reads/writes `panel.layout` setting | Pure functions, takes layout as argument |
| `panelLayout.ts` | Zustand store — imports from above two; owns UI state (`dragging`, `activePanel`, undo stack if any) | Store actions call tree functions, then call persistence |

### Constraints
- `panel-tree.ts` has zero imports from Zustand, React, or Electron
- `panel-persistence.ts` has zero imports from Zustand or React
- All existing store action names remain identical (no consumer changes needed)

---

## Task 6: preload/index.ts (467L → 7 domain files)

**File:** `src/preload/index.ts`  
**Approach:** A — mechanical split by domain

### Extraction plan

| New file | Domain | Methods |
|----------|--------|---------|
| `api-settings.ts` | Settings + Claude config | `settings.*`, `claudeConfig.*` |
| `api-git.ts` | Git operations | `gitStatus`, `gitDiff`, `gitStage`, `gitUnstage`, `gitCommit`, `gitPush`, `gitBranches`, `gitLog` |
| `api-sprint.ts` | Sprint tasks + groups | `sprint.*`, `groups.*` |
| `api-memory.ts` | Memory files | `memory.*` |
| `api-agents.ts` | Agent history + streaming | `agents.*`, `workbench.*` |
| `api-webhooks.ts` | Webhooks | `webhooks.*` |
| `api-utilities.ts` | Clipboard, playground, window, github, tearoff | Remaining methods |
| `preload/index.ts` | Re-assembles `api` object | `import * as X from './api-X'; export const api = { ...X }` |

### Constraints
- `window.api` shape is **identical** after refactor — no renderer code changes
- Each domain file calls `contextBridge`-safe wrappers only — no new logic
- IPC channel strings come from `src/shared/ipc-channels/` imports already in place

---

## Cross-Task Constraints

1. **Verification gate:** Every task must pass `npm run typecheck && npm test && npm run lint` before committing
2. **No behavior changes:** If a test breaks, the extraction is wrong — fix the extraction, not the test
3. **Re-exports for backward compat:** Where existing imports in consuming files would break, add a re-export in the original file location (remove once all callers are updated)
4. **Independent worktrees:** Each task runs in `~/worktrees/BDE/Users-ryan-projects-BDE/<taskId>/`
5. **Commit message format:** `refactor: decompose <FileName> into single-responsibility modules`

---

## What This Is NOT

- Not a behavior change
- Not adding new features or abstractions beyond what's needed for the split
- Not changing IPC channel names, store action names, or component prop interfaces
- Not touching Tier 1 god classes (`AgentManagerImpl`, `run-agent.ts`, `prompt-composer.ts`) — those are a separate effort

---

## Success Criteria

- All 6 files split as described
- `npm run typecheck` passes with zero errors
- `npm test` passes with zero regressions
- Each new file is ≤200 lines
- Original god class file is ≤100 lines (thin facade/re-export or store shell)
