# BDE Tech Debt Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up remaining tech debt from the code review — fix stale tests, remove dead code, deduplicate KanbanColumn, extract inline styles in TaskCard, and split SpecDrawer into focused sub-components.

**Architecture:** All changes are isolated refactors. No behavioral changes. Each task produces identical runtime behavior (verified by existing tests + typecheck).

**Tech Stack:** TypeScript, Vitest, React, Electron

**Note:** Error boundaries were already in place (verified in SprintCenter.tsx) — no action needed there.

---

## File Structure

| Action | File                                                        | Responsibility                                                                                     |
| ------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Modify | `src/main/agent-manager/__tests__/index.test.ts`            | Fix 11 stale tests referencing removed checkAuthStatus                                             |
| Modify | `src/main/agent-manager/dependency-index.ts`                | Remove unused `update()` and `remove()` methods                                                    |
| Modify | `src/main/agent-manager/__tests__/dependency-index.test.ts` | Remove tests for deleted methods                                                                   |
| Modify | `src/renderer/src/components/sprint/KanbanColumn.tsx`       | Deduplicate readOnly/interactive task mapping                                                      |
| Modify | `src/renderer/src/components/sprint/TaskCard.tsx`           | Extract inline styles to CSS classes                                                               |
| Create | `src/renderer/src/components/sprint/SpecEditor.tsx`         | Edit mode textarea (extracted from SpecDrawer)                                                     |
| Create | `src/renderer/src/components/sprint/SpecViewer.tsx`         | View mode rendered markdown (extracted from SpecDrawer; sanitized via DOMPurify in renderMarkdown) |
| Modify | `src/renderer/src/components/sprint/SpecDrawer.tsx`         | Compose from SpecEditor + SpecViewer                                                               |

---

### Task 1: Fix 11 Stale Agent Manager Tests

The drain loop no longer calls `checkAuthStatus` — auth is validated by the SDK at spawn time. 11 tests still reference the removed auth flow. Additionally, the initial drain is now deferred by `INITIAL_DRAIN_DEFER_MS` (5000ms), so tests using only `flush()` never trigger it.

**Files:**

- Modify: `src/main/agent-manager/__tests__/index.test.ts`

- [ ] **Step 1: Read the test file and identify all auth-related code**

Lines to change:

- Line 30-32: `vi.mock('../../auth-guard', ...)` — remove entirely
- Line 67: `import { checkAuthStatus } from '../../auth-guard'` — remove
- Line 104: `vi.mocked(checkAuthStatus).mockResolvedValue(...)` in setupDefaultMocks — remove
- Lines 167-179: Test "runs initial drain immediately (calls checkAuthStatus + getQueuedTasks)" — rewrite
- Lines 206-224: Test "skips drain when auth expired" — replace
- Lines 226-242: Test "skips drain when no token found" — replace

- [ ] **Step 2: Remove auth-guard mock and import**

Delete lines 30-32 (the `vi.mock('../../auth-guard', ...)` block).
Delete line 67 (`import { checkAuthStatus } from '../../auth-guard'`).
Delete line 104 (`vi.mocked(checkAuthStatus).mockResolvedValue(...)` from setupDefaultMocks).

- [ ] **Step 3: Fix "runs initial drain" test (lines 167-179)**

This test should verify the drain loop calls `getQueuedTasks` (no auth check). The drain is deferred by `INITIAL_DRAIN_DEFER_MS` (5000ms), so it needs fake timers.

Replace the test with:

```typescript
it('runs initial drain after defer period', async () => {
  vi.useFakeTimers()
  const logger = makeLogger()
  const mgr = createAgentManager(baseConfig, logger)

  mgr.start()
  // Drain is deferred by INITIAL_DRAIN_DEFER_MS (5000ms)
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
  await vi.advanceTimersByTimeAsync(6_000)
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

  expect(vi.mocked(getQueuedTasks)).toHaveBeenCalled()

  mgr.stop(0).catch(() => {})
  vi.useRealTimers()
})
```

- [ ] **Step 4: Replace "skips drain when auth expired" (lines 206-224)**

Auth is now validated at SDK spawn time, not in the drain loop. Replace with a test that verifies spawn-time auth failure handling:

```typescript
it('marks task as error when spawnAgent rejects with auth error', async () => {
  vi.useFakeTimers()
  const logger = makeLogger()
  setupDefaultMocks()
  vi.mocked(getQueuedTasks).mockResolvedValueOnce([makeTask()])
  vi.mocked(claimTask).mockResolvedValueOnce(makeTask())
  vi.mocked(spawnAgent).mockRejectedValueOnce(new Error('Authentication failed: token expired'))

  const mgr = createAgentManager(baseConfig, logger)
  mgr.start()
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
  await vi.advanceTimersByTimeAsync(6_000)
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

  expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
    'task-1',
    expect.objectContaining({ status: 'error' })
  )

  mgr.stop(0).catch(() => {})
  vi.useRealTimers()
})
```

- [ ] **Step 5: Replace "skips drain when no token found" (lines 226-242)**

Replace with a test for a different drain-loop behavior — verifying the drain loop skips when no slots available:

```typescript
it('skips drain when no concurrency slots available', async () => {
  vi.useFakeTimers()
  const config = { ...baseConfig, maxConcurrent: 1 }
  const task = makeTask()
  const { handle } = makeBlockingHandle()

  setupDefaultMocks()
  vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
  vi.mocked(claimTask).mockResolvedValueOnce(task)
  vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

  const logger = makeLogger()
  const mgr = createAgentManager(config, logger)
  mgr.start()
  // First drain — spawns one agent, fills the slot
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
  await vi.advanceTimersByTimeAsync(6_000)
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

  // Reset mock to track second drain
  vi.mocked(getQueuedTasks).mockClear()

  // Advance past poll interval to trigger second drain
  await vi.advanceTimersByTimeAsync(baseConfig.pollIntervalMs + 100)
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

  // Second drain should not fetch tasks (no slots)
  expect(vi.mocked(getQueuedTasks)).not.toHaveBeenCalled()

  mgr.stop(0).catch(() => {})
  vi.useRealTimers()
})
```

- [ ] **Step 6: Fix remaining failing tests that use flush() instead of fake timers**

The drain is deferred by 5s, so `flush()` alone doesn't trigger it. Update each test to use fake timers.

Pattern to apply to each test:

1. Add `vi.useFakeTimers()` at start
2. After `mgr.start()`, advance timers:
   ```typescript
   for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
   await vi.advanceTimersByTimeAsync(6_000)
   for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
   ```
3. Replace `await mgr.stop(...)` + `await flush()` with `mgr.stop(0).catch(() => {})` and `vi.useRealTimers()`

Apply to these tests:

- "claims task, spawns agent, registers in active map" (lines 183-204)
- "skips task when repo path not found" (lines 244-258)
- "marks task error when setupWorktree fails" (lines 261-278)
- "respects concurrency limit" (lines 315-336)
- "aborts active agents and sets running = false" (lines 340-360)
- "delegates to handle.steer()" (lines 428-445)
- "calls handle.abort()" (lines 457-474)

Also update `spawnAgent` mock call expectation (line 195-199) to use `expect.objectContaining` since logger is now passed:

```typescript
expect(vi.mocked(spawnAgent)).toHaveBeenCalledWith(
  expect.objectContaining({
    prompt: 'Do the thing',
    cwd: '/tmp/wt/myrepo/task-1',
    model: 'claude-sonnet-4-5'
  })
)
```

Similarly update `setupWorktree` expectation to use `expect.objectContaining` if it checks exact args.

- [ ] **Step 7: Run tests**

Run: `cd ~/projects/BDE && npm run test:main -- --reporter=verbose 2>&1 | grep -E "(index\.test|✓|×)" | head -25`
Expected: All 18 tests PASS (16 original + 2 added in prior PR)

- [ ] **Step 8: Commit**

```bash
git add src/main/agent-manager/__tests__/index.test.ts
git commit -m "fix: update stale agent-manager tests — remove checkAuthStatus refs, use fake timers"
```

---

### Task 2: Remove Dead `update()` and `remove()` from DependencyIndex

Since the drain loop now rebuilds the full index each cycle, these methods are unused.

**Files:**

- Modify: `src/main/agent-manager/dependency-index.ts`
- Modify: `src/main/agent-manager/__tests__/dependency-index.test.ts`
- Modify: `src/main/agent-manager/__tests__/index.test.ts`

- [ ] **Step 1: Read both source and test files**

- [ ] **Step 2: Remove from dependency-index.ts**

Remove from the `DependencyIndex` interface (lines 8-9):

```typescript
update(taskId: string, oldDeps: TaskDependency[] | null, newDeps: TaskDependency[] | null): void
remove(taskId: string): void
```

Remove the `removeEdges` helper function (lines 33-42) — only used by `update()`.

Remove the `update` method implementation (lines 49-52).
Remove the `remove` method implementation (lines 53-55).

- [ ] **Step 3: Update mock in index.test.ts**

In `src/main/agent-manager/__tests__/index.test.ts`, remove `update: vi.fn()` and `remove: vi.fn()` from the dependency-index mock (lines 19-20).

- [ ] **Step 4: Remove tests for update/remove in dependency-index.test.ts**

Read the test file and remove any tests that call `update()` or `remove()`.

- [ ] **Step 5: Run typecheck and tests**

Run: `cd ~/projects/BDE && npm run typecheck && npm run test:main`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/dependency-index.ts \
  src/main/agent-manager/__tests__/dependency-index.test.ts \
  src/main/agent-manager/__tests__/index.test.ts
git commit -m "chore: remove unused update/remove from DependencyIndex (rebuild-only now)"
```

---

### Task 3: Deduplicate KanbanColumn Task Mapping

The readOnly and interactive branches in KanbanColumn render nearly identical JSX. The only differences are: (1) `SortableContext` wrapper, (2) `isGenerating` prop, (3) drop-hint in empty state.

**Files:**

- Modify: `src/renderer/src/components/sprint/KanbanColumn.tsx`

- [ ] **Step 1: Read the file**

- [ ] **Step 2: Extract shared task rendering**

Replace the duplicated mapping (lines 74-133) with a single rendering function:

```tsx
const renderTasks = () => {
  if (tasks.length === 0) {
    return (
      <div className="kanban-col__empty">
        <EmptyState title={EMPTY_LABELS[status]} />
        {!readOnly && <span className="kanban-col__drop-hint">Drop cards here</span>}
      </div>
    )
  }
  return tasks.map((task, i) => (
    <motion.div
      key={task.id}
      layoutId={reduced || tasks.length > 10 ? undefined : task.id}
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.default}
    >
      <TaskCard
        task={task}
        index={i}
        prMerged={prMergedMap[task.id] ?? false}
        isGenerating={!readOnly ? (generatingIds?.has(task.id) ?? false) : undefined}
        onPushToSprint={onPushToSprint}
        onLaunch={onLaunch}
        onViewSpec={onViewSpec}
        onViewOutput={onViewOutput}
        onMarkDone={onMarkDone}
        onStop={onStop}
      />
    </motion.div>
  ))
}

const content = (
  <div className="kanban-col__cards">
    {readOnly ? (
      renderTasks()
    ) : (
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {renderTasks()}
      </SortableContext>
    )}
  </div>
)
```

- [ ] **Step 3: Run typecheck and tests**

Run: `cd ~/projects/BDE && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/sprint/KanbanColumn.tsx
git commit -m "chore: deduplicate task rendering in KanbanColumn"
```

---

### Task 4: Extract Inline Styles in TaskCard Dependency Chips

The dependency chips use inline styles instead of CSS classes. Extract to a CSS class.

**Files:**

- Modify: `src/renderer/src/components/sprint/TaskCard.tsx:68-85`
- Modify: CSS file for sprint styles (find via grep for `.task-card`)

- [ ] **Step 1: Find the CSS file**

Run: `grep -rl "\.task-card" src/renderer/src/` to find the sprint CSS file.

- [ ] **Step 2: Replace inline styles with CSS classes**

Replace the inline-styled dependency chip (lines 68-85):

```tsx
{
  task.depends_on && task.depends_on.length > 0 && (
    <div className="task-card__deps">
      {task.depends_on.map((dep) => (
        <span
          key={dep.id}
          className={`task-card__dep-chip ${dep.type === 'hard' ? 'task-card__dep-chip--hard' : ''}`}
        >
          {dep.type === 'hard' ? '●' : '○'} {dep.id.slice(0, 8)}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Add CSS classes to the sprint stylesheet**

```css
.task-card__deps {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.task-card__dep-chip {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.task-card__dep-chip--hard {
  background: var(--color-surface-raised);
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/sprint/TaskCard.tsx <css-file>
git commit -m "chore: extract inline styles to CSS classes in TaskCard dependency chips"
```

---

### Task 5: Split SpecDrawer Into Sub-Components

SpecDrawer is 302 lines with 7 state hooks. Extract the edit textarea and the rendered markdown view into focused sub-components.

**Files:**

- Create: `src/renderer/src/components/sprint/SpecEditor.tsx`
- Create: `src/renderer/src/components/sprint/SpecViewer.tsx`
- Modify: `src/renderer/src/components/sprint/SpecDrawer.tsx`

- [ ] **Step 1: Read SpecDrawer.tsx**

- [ ] **Step 2: Create SpecEditor.tsx**

Extract the edit textarea (lines 212-222) into its own component:

```tsx
import { useEffect, useRef } from 'react'

type SpecEditorProps = {
  value: string
  onChange: (value: string) => void
}

export function SpecEditor({ value, onChange }: SpecEditorProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    editorRef.current?.focus()
  }, [])

  return (
    <textarea
      ref={editorRef}
      className="spec-drawer__editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Write your spec in markdown..."
    />
  )
}
```

- [ ] **Step 3: Create SpecViewer.tsx**

Extract the rendered markdown view (lines 223-234). Note: `renderMarkdown` uses DOMPurify for sanitization — this is verified safe.

```tsx
import { renderMarkdown } from '../../lib/render-markdown'
import { EmptyState } from '../ui/EmptyState'

type SpecViewerProps = {
  content: string
  onEdit: () => void
}

export function SpecViewer({ content, onEdit }: SpecViewerProps) {
  if (!content) {
    return (
      <EmptyState
        title="No spec yet"
        description="Write a spec to guide the agent"
        action={{ label: 'Write Spec', onClick: onEdit }}
      />
    )
  }

  return (
    <div
      className="spec-drawer__rendered"
      // Safe: renderMarkdown sanitizes via DOMPurify
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  )
}
```

- [ ] **Step 4: Update SpecDrawer.tsx to use sub-components**

Add imports:

```tsx
import { SpecEditor } from './SpecEditor'
import { SpecViewer } from './SpecViewer'
```

Replace the body section (lines 211-234) with:

```tsx
<div className="spec-drawer__body">
  {editing ? (
    <SpecEditor
      value={draft}
      onChange={(v) => {
        setDraft(v)
        setDirty(true)
      }}
    />
  ) : (
    <SpecViewer content={draft} onEdit={() => setEditing(true)} />
  )}
</div>
```

Remove from SpecDrawer:

- `editorRef` state hook (line 34)
- The `useEffect` that focuses the editor (lines 133-135)
- The `renderMarkdown` import (line 7)

- [ ] **Step 5: Run typecheck and tests**

Run: `cd ~/projects/BDE && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/sprint/SpecEditor.tsx \
  src/renderer/src/components/sprint/SpecViewer.tsx \
  src/renderer/src/components/sprint/SpecDrawer.tsx
git commit -m "chore: extract SpecEditor and SpecViewer from SpecDrawer"
```

---

## Summary

| Task                     | What                                                                         | Est.   |
| ------------------------ | ---------------------------------------------------------------------------- | ------ |
| 1. Fix stale tests       | Rewrite 11 tests to match current drain loop (no auth check, deferred drain) | 20 min |
| 2. Remove dead code      | Delete unused `update()`/`remove()` from DependencyIndex                     | 5 min  |
| 3. Dedup KanbanColumn    | Extract shared task rendering function                                       | 5 min  |
| 4. Extract inline styles | Move TaskCard dep chip styles to CSS                                         | 5 min  |
| 5. Split SpecDrawer      | Extract SpecEditor + SpecViewer sub-components                               | 10 min |
