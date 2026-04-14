# WorkbenchForm Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `useTaskFormState`, `useSpecQualityChecks`, `useTaskCreation` hooks from WorkbenchForm.tsx, leaving a thin UI-only component.

**Architecture:** WorkbenchForm currently mixes data management, async operations, and UI logic. We extract three custom hooks to isolate concerns: (1) store state + derived validity, (2) debounced semantic validation via IPC, (3) task creation/update with stable refs to avoid closure stalenesss. The component becomes a pure presentational shell that delegates all business logic.

**Tech Stack:** TypeScript, React, Zustand, Vitest

---

## Task 1: Create `useTaskFormState.ts`

**Files:**
- Create: `src/renderer/src/hooks/useTaskFormState.ts`
- Modify: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`

- [ ] Read WorkbenchForm.tsx and identify the 16 Zustand store selectors (lines 57–72) and derived state concerns
- [ ] Create `src/renderer/src/hooks/useTaskFormState.ts` with:
  - Props/interface: none (internal hook only)
  - State owned: `title`, `repo`, `priority`, `advancedOpen`, `mode`, `taskId`, `spec`, `specType`, `dependsOn`, `playgroundEnabled`, `maxCostUsd`, `model`, `pendingGroupId`, `crossRepoContract`, `setField()`, `resetForm()`
  - Key logic: Wraps all 16 `useTaskWorkbenchStore` selectors; derives `isDirty` (spec vs last saved), `isValid` (title + repo present), `canQueue` (isValid + spec length ≥ 50)
  - Returns object: `{ title, repo, ..., setField, resetForm, isDirty, isValid, canQueue }`
- [ ] In WorkbenchForm.tsx, replace the 16 individual `useTaskWorkbenchStore` selector calls with a single `const form = useTaskFormState()` call
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test -- --testNamePattern="WorkbenchForm"` — must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract useTaskFormState from WorkbenchForm"`

---

## Task 2: Create `useSpecQualityChecks.ts`

**Files:**
- Create: `src/renderer/src/hooks/useSpecQualityChecks.ts`
- Modify: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`

- [ ] Read WorkbenchForm.tsx lines 149–222 (debounced semantic check with `useDebouncedAsync`)
- [ ] Create `src/renderer/src/hooks/useSpecQualityChecks.ts` with:
  - Props/interface: `{ spec: string; title: string; repo: string; specType: string | null }`
  - State owned: `setSemanticChecks` (via store), `semanticLoading` flag (via store)
  - Key logic: Mirrors current lines 149–222; calls `window.api.workbench.checkSpec()` after 2s debounce; on error, sets all checks to `warn` status
  - Returns nothing (side effect hook; updates store directly via `setSemanticChecks`)
- [ ] In WorkbenchForm.tsx, replace the `useDebouncedAsync` block (lines 149–222) with `useSpecQualityChecks({ spec, title, repo, specType })`
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test -- --testNamePattern="WorkbenchForm"` — must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract useSpecQualityChecks from WorkbenchForm"`

---

## Task 3: Create `useTaskCreation.ts`

**Files:**
- Create: `src/renderer/src/hooks/useTaskCreation.ts`
- Modify: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`

- [ ] Read WorkbenchForm.tsx lines 91–146 (`createOrUpdateTask` callback) and lines 229–319 (`handleSubmit`)
- [ ] Identify the stale closure issue: current code uses `useTaskWorkbenchStore.getState()` at lines 93 and 287–288 to read form state _outside_ reactive subscriptions. This must be replaced with stable refs.
- [ ] Create `src/renderer/src/hooks/useTaskCreation.ts` with:
  - Props/interface: `{ mode: string; taskId: string | null; formData: { title, repo, priority, spec, specType, dependsOn, playgroundEnabled, maxCostUsd, model, pendingGroupId, crossRepoContract } }`
  - State owned: `useRef` for formData (auto-updates via useEffect); `setSemanticChecks`, `setOperationalChecks` via store
  - Key logic:
    - Maintain `formDataRef` via `useEffect` that updates whenever formData deps change
    - `save(targetStatus)` reads fresh values from `formDataRef.current` instead of `useTaskWorkbenchStore.getState()`
    - Runs operational checks and warning collection (current lines 234–303)
    - Calls `createTask()` or `updateTask()` based on mode
    - Returns `{ save, isSaving, error }` for UI to call with `'backlog' | 'queued'` arg
- [ ] In WorkbenchForm.tsx:
  - Delete the `createOrUpdateTask` callback (lines 91–146)
  - In `handleSubmit`, call `const { save } = useTaskCreation({ mode, taskId, formData })` at hook level
  - Replace `await createOrUpdateTask(...)` call with `await save(...)`
  - Remove all `useTaskWorkbenchStore.getState()` calls
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test -- --testNamePattern="WorkbenchForm"` — must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract useTaskCreation from WorkbenchForm with stable refs"`

---

## Task 4: Refactor WorkbenchForm.tsx to thin UI shell

**Files:**
- Modify: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`

- [ ] Verify WorkbenchForm now imports the three new hooks: `useTaskFormState`, `useSpecQualityChecks`, `useTaskCreation`
- [ ] Clean up: Remove any now-unused imports (`useTaskWorkbenchStore` direct usage should be gone except initial hook calls)
- [ ] Verify line count: WorkbenchForm should be ≤250 lines (was 570L, now mostly UI render)
- [ ] Run `npm run typecheck` — zero errors required
- [ ] Run `npm test` — all tests pass, especially task-workbench tests
- [ ] Run `npm run lint` — no issues
- [ ] Commit: `git add -A && git commit -m "refactor: reduce WorkbenchForm to UI-only thin shell"`

---

## Implementation Notes

### Stale Closure Prevention (Task 3 Critical Detail)

The current `createOrUpdateTask` callback captures `title`, `repo`, etc. in its dependency array (lines 130–145). But at line 93, it reads `specType` via `useTaskWorkbenchStore.getState()` — a stale read escape hatch.

The new `useTaskCreation` hook replaces this pattern:

```typescript
// OLD (escape hatch):
const createOrUpdateTask = useCallback(
  async (targetStatus) => {
    const specType = useTaskWorkbenchStore.getState().specType  // STALE!
    // ...
  },
  [deps...]
)

// NEW (stable ref):
export function useTaskCreation({ mode, taskId, formData }) {
  const formDataRef = useRef(formData)
  
  useEffect(() => {
    formDataRef.current = formData
  }, [formData])
  
  const save = useCallback(async (targetStatus) => {
    const { specType } = formDataRef.current  // ALWAYS FRESH
    // ...
  }, []) // stable, no deps needed
  
  return { save }
}
```

Because `formDataRef` is updated in every render via `useEffect`, the stable callback always reads the latest values.

### Queue Confirmation Modal

The `showQueueConfirm` and `queueConfirmMessage` state stays in WorkbenchForm — these are pure UI concerns. The confirmation modal is rendered at lines 560–567 with no business logic.

### Test Coverage

After refactoring, verify:
- `useTaskFormState` correctly derives `isDirty`, `isValid`, `canQueue`
- `useSpecQualityChecks` debounces and calls the IPC method
- `useTaskCreation` handles both create and edit flows without stale closures
- WorkbenchForm renders all UI elements with correct event handlers

---

## Success Criteria

- All three hooks created with proper TypeScript interfaces
- WorkbenchForm reduced to ≤250 lines (down from 570L)
- `npm run typecheck` passes with zero errors
- `npm test` passes with zero regressions
- No direct `useTaskWorkbenchStore.getState()` calls remain in WorkbenchForm
- No stale closure warnings or bugs in queue/save flow
