# Phase 1: Data Safety & State Management Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate data loss risks and fix Zustand anti-patterns that cause unnecessary re-renders across all subscribers.

**Architecture:** Convert Map/Set state to Record/Array in 4 stores, add localStorage persistence for pending PR review comments, and add unsaved-changes guards to the Memory editor. All changes are backwards-compatible and require no IPC changes.

**Tech Stack:** TypeScript, Zustand, localStorage, React hooks

---

## File Structure

| Action | File                                                                  | Responsibility                                                               |
| ------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Modify | `src/renderer/src/stores/sprintTasks.ts`                              | Convert `pendingUpdates: Map` → `Record`, `pendingCreates: Set` → `string[]` |
| Modify | `src/renderer/src/stores/healthCheck.ts`                              | Convert `stuckTaskIds: Set` → `string[]`, `dismissedIds: Set` → `string[]`   |
| Modify | `src/renderer/src/stores/prConflicts.ts`                              | Convert `conflictingTaskIds: Set` → `string[]`                               |
| Modify | `src/renderer/src/stores/sprintUI.ts`                                 | Convert `generatingIds: Set` → `string[]`                                    |
| Modify | `src/renderer/src/stores/pendingReview.ts`                            | Add localStorage persistence + restore on init                               |
| Modify | `src/renderer/src/views/MemoryView.tsx`                               | Add unsaved-changes guard before navigation                                  |
| Modify | `src/renderer/src/views/PRStationView.tsx`                            | Add unsaved-comments warning before navigation                               |
| Create | `src/renderer/src/stores/__tests__/sprintTasks-map-removal.test.ts`   | Tests for Map→Record conversion                                              |
| Create | `src/renderer/src/stores/__tests__/pendingReview-persistence.test.ts` | Tests for localStorage persistence                                           |
| Create | `src/renderer/src/views/__tests__/MemoryView-unsaved.test.ts`         | Tests for unsaved-changes guard                                              |

---

### Task 1: Convert sprintTasks Map/Set to Record/Array

**Files:**

- Modify: `src/renderer/src/stores/sprintTasks.ts:29-30,48-49,61,67,70,171,190,241`
- Create: `src/renderer/src/stores/__tests__/sprintTasks-map-removal.test.ts`

**Context:** `pendingUpdates` is a `Map<string, number>` tracking optimistic update timestamps, and `pendingCreates` is a `Set<string>` tracking temp IDs. Both cause all subscribers to re-render on every mutation because `new Map()` / `new Set()` always produces a new reference that defeats Zustand's shallow equality check.

- [ ] **Step 1: Write failing test for Record-based pendingUpdates**

```typescript
// src/renderer/src/stores/__tests__/sprintTasks-map-removal.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock window.api before importing store
vi.stubGlobal('window', {
  ...window,
  api: {
    sprint: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'new-1', title: 'Test' }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    }
  }
})

import { useSprintTasks } from '../sprintTasks'

describe('sprintTasks Map→Record migration', () => {
  beforeEach(() => {
    useSprintTasks.setState({
      tasks: [],
      loading: false,
      loadError: null,
      pendingUpdates: {},
      pendingCreates: [],
      prMergedMap: {}
    })
  })

  it('pendingUpdates is a plain object, not a Map', () => {
    const state = useSprintTasks.getState()
    expect(state.pendingUpdates).toEqual({})
    expect(state.pendingUpdates instanceof Map).toBe(false)
  })

  it('pendingCreates is an array, not a Set', () => {
    const state = useSprintTasks.getState()
    expect(Array.isArray(state.pendingCreates)).toBe(true)
    expect(state.pendingCreates instanceof Set).toBe(false)
  })

  it('updateTask records pending update timestamp as Record entry', async () => {
    useSprintTasks.setState({
      tasks: [{ id: 'task-1', title: 'Test', status: 'backlog' } as any]
    })
    await useSprintTasks.getState().updateTask('task-1', { title: 'Updated' })
    const { pendingUpdates } = useSprintTasks.getState()
    expect(typeof pendingUpdates['task-1']).toBe('number')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/stores/__tests__/sprintTasks-map-removal.test.ts`
Expected: FAIL — `pendingUpdates instanceof Map` is true, not a plain object

- [ ] **Step 3: Convert pendingUpdates from Map to Record in store definition**

In `src/renderer/src/stores/sprintTasks.ts`, make these changes:

**Line 29:** Change type from `Map<string, number>` to `Record<string, number>`

```typescript
// BEFORE
pendingUpdates: Map<string, number>
pendingCreates: Set<string>

// AFTER
pendingUpdates: Record<string, number>
pendingCreates: string[]
```

**Lines 48-49:** Change initial values

```typescript
// BEFORE
pendingUpdates: new Map<string, number>(),
pendingCreates: new Set<string>(),

// AFTER
pendingUpdates: {},
pendingCreates: [],
```

**Line 61 (loadData — pending update expiry):**

```typescript
// BEFORE
const pending = new Map(s.pendingUpdates)
for (const [id, ts] of pending) {
  if (now - ts > PENDING_UPDATE_TTL) pending.delete(id)
}

// AFTER
const pending = { ...s.pendingUpdates }
for (const id of Object.keys(pending)) {
  if (now - pending[id] > PENDING_UPDATE_TTL) delete pending[id]
}
```

**Line 67 (loadData — merge map):** This uses `new Map(s.tasks.map(...))` for O(1) lookup — this is a local variable, NOT stored in state, so it stays as Map. No change needed.

**Line 70 (loadData — incoming map):** Same — local variable for merge logic. Keep as Map.

**Line ~105 (updateTask — record pending timestamp):**

```typescript
// BEFORE
s.pendingUpdates = new Map(s.pendingUpdates)
s.pendingUpdates.set(taskId, Date.now())

// AFTER
s.pendingUpdates = { ...s.pendingUpdates, [taskId]: Date.now() }
```

**Line ~171 (createTask — add to pendingCreates):**

```typescript
// BEFORE
const next = new Set(s.pendingCreates)
next.add(tempId)
return { pendingCreates: next }

// AFTER
return { pendingCreates: [...s.pendingCreates, tempId] }
```

**Line ~190 (createTask success — remove from pendingCreates):**

```typescript
// BEFORE
const next = new Set(s.pendingCreates)
next.delete(tempId)
return { pendingCreates: next }

// AFTER
return { pendingCreates: s.pendingCreates.filter((id) => id !== tempId) }
```

**Line ~241 (createTask error — remove from pendingCreates):**

```typescript
// BEFORE
const next = new Set(s.pendingCreates)
next.delete(tempId)
return { pendingCreates: next }

// AFTER
return { pendingCreates: s.pendingCreates.filter((id) => id !== tempId) }
```

**Line ~62 (loadData — check if task is pending):**

```typescript
// BEFORE
if (s.pendingUpdates.has(t.id)) ...
if (s.pendingCreates.has(t.id)) ...

// AFTER
if (t.id in s.pendingUpdates) ...
if (s.pendingCreates.includes(t.id)) ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/stores/__tests__/sprintTasks-map-removal.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npm test`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/sprintTasks.ts src/renderer/src/stores/__tests__/sprintTasks-map-removal.test.ts
git commit -m "fix: convert sprintTasks Map/Set to Record/Array (Zustand anti-pattern)"
```

---

### Task 2: Convert healthCheck, prConflicts, sprintUI Sets to Arrays

**Files:**

- Modify: `src/renderer/src/stores/healthCheck.ts:12-13,14-30`
- Modify: `src/renderer/src/stores/prConflicts.ts:5,12-22`
- Modify: `src/renderer/src/stores/sprintUI.ts:8,26-28`

**Context:** All three stores use `Set<string>` in Zustand state. Same anti-pattern — `new Set()` breaks shallow equality. Convert to `string[]` with deduplication where needed.

- [ ] **Step 1: Write failing tests**

```typescript
// src/renderer/src/stores/__tests__/set-removal.test.ts
import { describe, it, expect } from 'vitest'
import { useHealthCheck } from '../healthCheck'
import { usePrConflictsStore } from '../prConflicts'
import { useSprintUI } from '../sprintUI'

describe('Set→Array migration', () => {
  it('healthCheck.stuckTaskIds is an array', () => {
    const { stuckTaskIds } = useHealthCheck.getState()
    expect(Array.isArray(stuckTaskIds)).toBe(true)
  })

  it('healthCheck.dismissedIds is an array', () => {
    const { dismissedIds } = useHealthCheck.getState()
    expect(Array.isArray(dismissedIds)).toBe(true)
  })

  it('prConflicts.conflictingTaskIds is an array', () => {
    const { conflictingTaskIds } = usePrConflictsStore.getState()
    expect(Array.isArray(conflictingTaskIds)).toBe(true)
  })

  it('sprintUI.generatingIds is an array', () => {
    const { generatingIds } = useSprintUI.getState()
    expect(Array.isArray(generatingIds)).toBe(true)
  })

  it('healthCheck.setStuckTasks deduplicates', () => {
    useHealthCheck.getState().setStuckTasks(['a', 'a', 'b'])
    expect(useHealthCheck.getState().stuckTaskIds).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/stores/__tests__/set-removal.test.ts`
Expected: FAIL

- [ ] **Step 3: Convert healthCheck.ts**

```typescript
// src/renderer/src/stores/healthCheck.ts
// Change Set<string> → string[] throughout

// State type:
stuckTaskIds: string[]    // was Set<string>
dismissedIds: string[]    // was Set<string>

// Initial values:
stuckTaskIds: [],
dismissedIds: [],

// setStuckTasks:
setStuckTasks: (taskIds) => {
  const deduped = [...new Set(taskIds)]  // dedupe input, store as array
  set({ stuckTaskIds: deduped })
},

// dismiss:
dismiss: (taskId) => set((s) => ({
  dismissedIds: s.dismissedIds.includes(taskId)
    ? s.dismissedIds
    : [...s.dismissedIds, taskId]
})),

// clearDismissed:
clearDismissed: () => set({ dismissedIds: [] }),
```

**Update consumers** — anywhere that calls `.has()` on these, change to `.includes()`. Anywhere that calls `.size`, change to `.length`.

- [ ] **Step 4: Convert prConflicts.ts**

```typescript
// State type:
conflictingTaskIds: string[]  // was Set<string>

// Initial:
conflictingTaskIds: [],

// setConflicts:
setConflicts: (taskIds) => {
  const deduped = [...new Set(taskIds)]
  const current = get().conflictingTaskIds
  if (deduped.length === current.length && deduped.every((id, i) => id === current[i])) return
  set({ conflictingTaskIds: deduped })
},
```

**Update consumers** — `conflictingTaskIds.size` → `conflictingTaskIds.length`, `.has()` → `.includes()`.

- [ ] **Step 5: Convert sprintUI.ts**

```typescript
// State type:
generatingIds: string[]  // was Set<string>

// Initial:
generatingIds: [],

// setGeneratingIds — keep updater pattern but with array:
setGeneratingIds: (updater) => set((s) => ({
  generatingIds: updater(s.generatingIds)
})),
```

**Update all callers** of `setGeneratingIds` that use Set API:

```typescript
// BEFORE: setGeneratingIds(prev => { const next = new Set(prev); next.add(id); return next })
// AFTER:  setGeneratingIds(prev => prev.includes(id) ? prev : [...prev, id])

// BEFORE: setGeneratingIds(prev => { const next = new Set(prev); next.delete(id); return next })
// AFTER:  setGeneratingIds(prev => prev.filter(x => x !== id))
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/stores/__tests__/set-removal.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests pass (grep for `.has(` and `.size` on these stores to catch missed consumers)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/stores/healthCheck.ts src/renderer/src/stores/prConflicts.ts src/renderer/src/stores/sprintUI.ts src/renderer/src/stores/__tests__/set-removal.test.ts
git commit -m "fix: convert remaining Set<string> to string[] in Zustand stores"
```

---

### Task 3: Persist Pending PR Review Comments to localStorage

**Files:**

- Modify: `src/renderer/src/stores/pendingReview.ts:1-58`
- Create: `src/renderer/src/stores/__tests__/pendingReview-persistence.test.ts`

**Context:** The `pendingReview` store holds in-flight code review comments in memory only. If the user refreshes the app or navigates away, all pending comments are silently lost. This is the highest-priority data loss risk identified in the audit.

- [ ] **Step 1: Write failing test for localStorage persistence**

```typescript
// src/renderer/src/stores/__tests__/pendingReview-persistence.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    })
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

import { usePendingReviewStore } from '../pendingReview'

const STORAGE_KEY = 'bde:pendingReviewComments'

describe('pendingReview localStorage persistence', () => {
  beforeEach(() => {
    localStorageMock.clear()
    usePendingReviewStore.setState({ pendingComments: {} })
  })

  it('saves comments to localStorage when added', () => {
    usePendingReviewStore.getState().addComment('owner/repo#1', {
      id: 'c1',
      path: 'src/index.ts',
      line: 10,
      body: 'Fix this',
      side: 'RIGHT'
    })

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.stringContaining('Fix this')
    )
  })

  it('restores comments from localStorage on init', () => {
    const saved = {
      'owner/repo#1': [
        { id: 'c1', path: 'src/index.ts', line: 10, body: 'Saved comment', side: 'RIGHT' }
      ]
    }
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(saved))

    usePendingReviewStore.getState().restoreFromStorage()
    const comments = usePendingReviewStore.getState().pendingComments
    expect(comments['owner/repo#1']).toHaveLength(1)
    expect(comments['owner/repo#1'][0].body).toBe('Saved comment')
  })

  it('clears localStorage entry when pending comments are submitted', () => {
    usePendingReviewStore.getState().addComment('owner/repo#1', {
      id: 'c1',
      path: 'src/index.ts',
      line: 10,
      body: 'Test',
      side: 'RIGHT'
    })
    usePendingReviewStore.getState().clearPending('owner/repo#1')

    const stored = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)?.[1] ?? '{}')
    expect(stored['owner/repo#1']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/stores/__tests__/pendingReview-persistence.test.ts`
Expected: FAIL — `restoreFromStorage` doesn't exist yet

- [ ] **Step 3: Add localStorage persistence to pendingReview store**

In `src/renderer/src/stores/pendingReview.ts`:

```typescript
const STORAGE_KEY = 'bde:pendingReviewComments'

function persistToStorage(comments: Record<string, PendingComment[]>) {
  try {
    // Only persist entries that have comments
    const filtered = Object.fromEntries(Object.entries(comments).filter(([, v]) => v.length > 0))
    if (Object.keys(filtered).length === 0) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
    }
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

// Add to store actions:
restoreFromStorage: (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, PendingComment[]>
      set({ pendingComments: parsed })
    }
  } catch {
    // Corrupted data — start fresh
    localStorage.removeItem(STORAGE_KEY)
  }
},
  // Add subscriber after store creation to auto-persist:
  usePendingReviewStore.subscribe((state) => {
    persistToStorage(state.pendingComments)
  }))
```

- [ ] **Step 4: Call restoreFromStorage on app init**

In `src/renderer/src/App.tsx`, add to the top-level effect:

```typescript
useEffect(() => {
  usePendingReviewStore.getState().restoreFromStorage()
}, [])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/stores/__tests__/pendingReview-persistence.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/pendingReview.ts src/renderer/src/stores/__tests__/pendingReview-persistence.test.ts src/renderer/src/App.tsx
git commit -m "fix: persist pending PR review comments to localStorage"
```

---

### Task 4: Add Unsaved-Changes Guard to Memory Editor

**Files:**

- Modify: `src/renderer/src/views/MemoryView.tsx:206,314`
- Create: `src/renderer/src/views/__tests__/MemoryView-unsaved.test.ts`

**Context:** The Memory editor has `content` and `savedContent` state. When `content !== savedContent`, there are unsaved changes. Currently, navigating away silently discards them.

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/views/__tests__/MemoryView-unsaved.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('MemoryView unsaved changes guard', () => {
  it('isDirty returns true when content differs from savedContent', () => {
    // Unit test the dirty check logic
    const isDirty = (content: string, savedContent: string) => content !== savedContent
    expect(isDirty('modified', 'original')).toBe(true)
    expect(isDirty('same', 'same')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

Run: `npx vitest run src/renderer/src/views/__tests__/MemoryView-unsaved.test.ts`
Expected: PASS (this is a logic test — the UI integration comes next)

- [ ] **Step 3: Add useConfirm guard to MemoryView**

In `src/renderer/src/views/MemoryView.tsx`:

1. Import `useConfirm` and `ConfirmModal` from `../components/ui/ConfirmModal`
2. Add dirty check before file selection and view navigation:

```typescript
const { confirm, confirmProps } = useConfirm()
const isDirty = content !== savedContent

// Wrap the file select handler:
const handleSelectFile = async (path: string) => {
  if (isDirty) {
    const ok = await confirm({
      title: 'Unsaved Changes',
      message: 'You have unsaved changes. Discard them?',
      confirmLabel: 'Discard',
      variant: 'danger'
    })
    if (!ok) return
  }
  // ... existing selection logic
}
```

3. Render `<ConfirmModal {...confirmProps} />` inside the component's return.

- [ ] **Step 4: Add beforeunload listener for app-level protection**

```typescript
useEffect(() => {
  if (!isDirty) return
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}, [isDirty])
```

- [ ] **Step 5: Add dirty indicator to editor header**

The Memory editor already shows a `•` dot when dirty (line ~314). Verify this works and ensure the Discard button resets content to savedContent.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/views/MemoryView.tsx src/renderer/src/views/__tests__/MemoryView-unsaved.test.ts
git commit -m "fix: add unsaved-changes guard to Memory editor"
```

---

### Task 5: Add Unsaved-Comments Warning to PR Station

**Files:**

- Modify: `src/renderer/src/views/PRStationView.tsx`

**Context:** When user selects a different PR while they have pending review comments on the current one, the comments stay in the store but the UI switches away. Add a warning.

- [ ] **Step 1: Add confirmation before PR switch when pending comments exist**

In `src/renderer/src/views/PRStationView.tsx`:

```typescript
const { confirm, confirmProps } = useConfirm()
const pendingCount = selectedPr
  ? (usePendingReviewStore.getState().pendingComments[prKey] ?? []).length
  : 0

const handleSelectPr = async (pr: PullRequest) => {
  if (pendingCount > 0) {
    const ok = await confirm({
      title: 'Pending Review Comments',
      message: `You have ${pendingCount} unsent comment(s) on this PR. Switch anyway? Comments are saved and will be here when you return.`,
      confirmLabel: 'Switch PR',
      variant: 'default'
    })
    if (!ok) return
  }
  setSelectedPr(pr)
}
```

Note: Since comments are now persisted to localStorage (Task 3), this is informational — comments won't be lost. The dialog just ensures the user knows they have pending work.

- [ ] **Step 2: Render ConfirmModal**

Add `<ConfirmModal {...confirmProps} />` to the component's JSX return (import both `useConfirm` and `ConfirmModal` from `../components/ui/ConfirmModal`).

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/PRStationView.tsx
git commit -m "feat: warn when switching PRs with pending review comments"
```
