# Resizable Panels & Drawers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every fixed-size drawer and panel sidebar in BDE freely resizable so users can control their workspace layout.

**Architecture:** Two patterns — a `useDrawerResize` hook for right-anchored `position:fixed` overlay drawers (TaskDetailDrawer, ConflictDrawer, HealthCheckDrawer), and `react-resizable-panels` `<Group>`/`<Panel>`/`<Separator>` wrapping for in-flow panel splits (CodeReview, Agents, DiffViewer, Settings). Session-only sizing (no persistence). Subtle hover-only handles matching existing IDEView style.

**Tech Stack:** React 18, TypeScript strict, `react-resizable-panels` v4.7.2 (already installed), vitest + @testing-library/react for tests.

**Spec:** `docs/superpowers/specs/2026-04-08-resizable-panels-design.md`

---

## File Map

| File                                                       | Action     | Purpose                                                                |
| ---------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `src/renderer/src/hooks/useDrawerResize.ts`                | **CREATE** | Shared hook for right-anchored overlay drawers                         |
| `src/renderer/src/hooks/__tests__/useDrawerResize.test.ts` | **CREATE** | Unit tests for hook                                                    |
| `src/renderer/src/assets/design-system.css`                | **MODIFY** | Add `.drawer-resize-handle` + `.panel-separator` CSS                   |
| `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`  | **MODIFY** | Replace inline drag logic with `useDrawerResize`                       |
| `src/renderer/src/components/sprint/ConflictDrawer.tsx`    | **MODIFY** | Add `useDrawerResize` + resize handle div                              |
| `src/renderer/src/components/sprint/HealthCheckDrawer.tsx` | **MODIFY** | Add `useDrawerResize` + resize handle div                              |
| `src/renderer/src/views/CodeReviewView.tsx`                | **MODIFY** | Wrap in Group/Panel/Separator                                          |
| `src/renderer/src/assets/code-review-neon.css`             | **MODIFY** | Remove fixed `.cr-queue` width                                         |
| `src/renderer/src/views/AgentsView.tsx`                    | **MODIFY** | Wrap inner flex row in Group/Panel/Separator                           |
| `src/renderer/src/assets/agents-neon.css`                  | **MODIFY** | Remove fixed `.agents-sidebar` width + `resize: horizontal`            |
| `src/renderer/src/components/diff/DiffViewer.tsx`          | **MODIFY** | Wrap DiffFileList in Group/Panel/Separator                             |
| `src/renderer/src/assets/diff.css`                         | **MODIFY** | Remove fixed `.diff-sidebar` width                                     |
| `src/renderer/src/views/SettingsView.tsx`                  | **MODIFY** | Wrap in Group/Panel/Separator                                          |
| `src/renderer/src/assets/settings-v2-neon.css`             | **MODIFY** | Remove fixed `.stg-sidebar` width                                      |
| `src/renderer/src/views/IDEView.tsx`                       | **MODIFY** | Fix conditional-mount sidebar using `usePanelRef` + `collapsible` prop |

---

## Task 1: Create `useDrawerResize` hook

**Files:**

- Create: `src/renderer/src/hooks/useDrawerResize.ts`
- Create: `src/renderer/src/hooks/__tests__/useDrawerResize.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/src/hooks/__tests__/useDrawerResize.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useDrawerResize } from '../useDrawerResize'

describe('useDrawerResize', () => {
  beforeEach(() => {
    // Reset cursor style before each test
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  afterEach(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it('initialises width to defaultWidth', () => {
    const { result } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 200, maxWidth: 700 })
    )
    expect(result.current.width).toBe(400)
  })

  it('increases width when dragged left', () => {
    const { result } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 200, maxWidth: 700 })
    )

    act(() => {
      result.current.handleResizeStart({
        preventDefault: () => {},
        clientX: 500
      } as React.MouseEvent)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450 }))
    })

    // dragged left 50px → width should grow by 50
    expect(result.current.width).toBe(450)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  it('clamps width to minWidth', () => {
    const { result } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 300, maxWidth: 700 })
    )

    act(() => {
      result.current.handleResizeStart({
        preventDefault: () => {},
        clientX: 500
      } as React.MouseEvent)
    })

    act(() => {
      // Drag far right — would shrink below min
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }))
    })

    expect(result.current.width).toBe(300)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  it('clamps width to maxWidth', () => {
    const { result } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 200, maxWidth: 500 })
    )

    act(() => {
      result.current.handleResizeStart({
        preventDefault: () => {},
        clientX: 500
      } as React.MouseEvent)
    })

    act(() => {
      // Drag far left — would grow past max
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }))
    })

    expect(result.current.width).toBe(500)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  it('sets col-resize cursor on drag start and resets on mouseup', () => {
    const { result } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 200, maxWidth: 700 })
    )

    act(() => {
      result.current.handleResizeStart({
        preventDefault: () => {},
        clientX: 500
      } as React.MouseEvent)
    })

    expect(document.body.style.cursor).toBe('col-resize')

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(document.body.style.cursor).toBe('')
  })

  it('cleans up document listeners on unmount during drag', () => {
    const { result, unmount } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 200, maxWidth: 700 })
    )

    act(() => {
      result.current.handleResizeStart({
        preventDefault: () => {},
        clientX: 500
      } as React.MouseEvent)
    })

    expect(document.body.style.cursor).toBe('col-resize')

    // Unmount mid-drag — should clean up
    unmount()

    expect(document.body.style.cursor).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/ryan/projects/BDE
npx vitest run src/renderer/src/hooks/__tests__/useDrawerResize.test.ts
```

Expected: FAIL — "useDrawerResize is not a function" (module doesn't exist yet)

- [ ] **Step 3: Implement `useDrawerResize`**

Create `src/renderer/src/hooks/useDrawerResize.ts`:

```ts
import { useState, useRef, useCallback, useEffect } from 'react'

interface UseDrawerResizeConfig {
  defaultWidth: number
  minWidth: number
  maxWidth: number
}

interface UseDrawerResizeResult {
  width: number
  handleResizeStart: (e: React.MouseEvent) => void
}

export function useDrawerResize({
  defaultWidth,
  minWidth,
  maxWidth
}: UseDrawerResizeConfig): UseDrawerResizeResult {
  const [width, setWidth] = useState(defaultWidth)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(defaultWidth)
  // Stores the cleanup closure so unmount mid-drag works correctly.
  // Must be a ref (not a state or effect dep) to avoid stale closure issues.
  const cleanupRef = useRef<(() => void) | null>(null)

  // Run cleanup on unmount to release listeners if component is removed mid-drag
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startWidth.current = width
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: MouseEvent): void => {
        if (!dragging.current) return
        // Right-anchored drawers: dragging left (lower clientX) increases width
        const delta = startX.current - ev.clientX
        const next = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta))
        setWidth(next)
      }

      const onUp = (): void => {
        dragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        cleanupRef.current = null
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)

      cleanupRef.current = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    },
    [width, minWidth, maxWidth]
  )

  return { width, handleResizeStart }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/renderer/src/hooks/__tests__/useDrawerResize.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: Zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useDrawerResize.ts src/renderer/src/hooks/__tests__/useDrawerResize.test.ts
git commit -m "feat: add useDrawerResize hook for right-anchored overlay drawers"
```

---

## Task 2: Add shared CSS for resize handles and panel separators

**Files:**

- Modify: `src/renderer/src/assets/design-system.css`

- [ ] **Step 1: Append to `design-system.css`**

Add the following at the end of `src/renderer/src/assets/design-system.css`:

```css
/* ── Drawer resize handle (right-anchored overlay drawers) ───────────────── */
.drawer-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
}

.drawer-resize-handle::after {
  content: '';
  position: absolute;
  inset: 0;
  background: transparent;
  transition:
    background 150ms ease,
    box-shadow 150ms ease;
}

.drawer-resize-handle:hover::after,
.drawer-resize-handle:active::after {
  background: var(--neon-cyan);
  box-shadow: 0 0 8px var(--neon-cyan-glow);
  opacity: 0.6;
}

/* ── Shared panel separator (react-resizable-panels) ─────────────────────── */
.panel-separator {
  background: var(--neon-purple-border);
}

.panel-separator:hover,
.panel-separator:active {
  background: var(--neon-cyan);
  box-shadow: 0 0 8px var(--neon-cyan-glow);
}
```

- [ ] **Step 2: Verify design-system.css is imported globally**

```bash
grep -r "design-system.css" /Users/ryan/projects/BDE/src/renderer/src --include="*.tsx" --include="*.ts" | head -5
```

Expected: at least one import entry. If not found, check `src/renderer/src/main.tsx` or `src/renderer/src/App.tsx` — add `import './assets/design-system.css'` if missing.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/assets/design-system.css
git commit -m "feat: add drawer-resize-handle and panel-separator CSS"
```

---

## Task 3: Refactor TaskDetailDrawer to use `useDrawerResize`

**Files:**

- Modify: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`

The existing inline drag logic (lines 61–133) is replaced by the hook. The constants at lines 13–15 move into the hook call.

- [ ] **Step 1: Open `TaskDetailDrawer.tsx` and read lines 1–175** to understand existing state and refs before editing.

- [ ] **Step 2: Replace inline drag logic with hook**

In `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`:

Remove the three constants at the top of the file:

```ts
// DELETE these three lines
const MIN_DRAWER_WIDTH = 280
const MAX_DRAWER_WIDTH = 700
const DEFAULT_DRAWER_WIDTH = 380
```

Add the hook import after the existing imports:

```ts
import { useDrawerResize } from '../../hooks/useDrawerResize'
```

Inside the component body, remove:

- `const [width, setWidth] = useState(DEFAULT_DRAWER_WIDTH)` (line 61)
- `const dragging = useRef(false)` (line 63)
- `const startX = useRef(0)` (line 64)
- `const startWidth = useRef(DEFAULT_DRAWER_WIDTH)` (line 65)
- `const cleanupRef = useRef<...>(null)` (line 82)
- The `useEffect` cleanup block (lines 84–91)
- The entire `handleResizeStart` `useCallback` (lines 93–133)

Replace all of the above with a single line:

```ts
const { width, handleResizeStart } = useDrawerResize({
  defaultWidth: 380,
  minWidth: 280,
  maxWidth: 700
})
```

The JSX already uses `handleResizeStart` and `width` — no JSX changes needed.

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/
```

Expected: All tests in that folder pass.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: Zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/sprint/TaskDetailDrawer.tsx
git commit -m "refactor: use shared useDrawerResize hook in TaskDetailDrawer"
```

---

## Task 4: Add resize to ConflictDrawer

**Files:**

- Modify: `src/renderer/src/components/sprint/ConflictDrawer.tsx`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css` (remove fixed width)
- Reference test: `src/renderer/src/components/sprint/__tests__/ConflictDrawer.test.tsx`

- [ ] **Step 1: Read ConflictDrawer.tsx lines 1–60 and the existing test** to understand the current structure before editing.

- [ ] **Step 2: Write a failing test** that checks the resize handle exists

In `src/renderer/src/components/sprint/__tests__/ConflictDrawer.test.tsx`, add a new test after the existing ones:

```tsx
it('renders a resize handle', () => {
  const { container } = render(
    <ConflictDrawer open={true} tasks={[makeTask()]} onClose={vi.fn()} onOpenExternal={vi.fn()} />
  )
  expect(container.querySelector('.drawer-resize-handle')).not.toBeNull()
})
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/ConflictDrawer.test.tsx
```

Expected: FAIL — `.drawer-resize-handle` not found.

- [ ] **Step 4: Implement — add hook and handle div**

In `src/renderer/src/components/sprint/ConflictDrawer.tsx`:

Add import:

```ts
import { useDrawerResize } from '../../hooks/useDrawerResize'
```

Inside the component body (before the return), add:

```ts
const { width, handleResizeStart } = useDrawerResize({
  defaultWidth: 440,
  minWidth: 300,
  maxWidth: 650
})
```

In the JSX, find the element with `className="conflict-drawer ..."` and:

1. Add `style={{ width }}` to it
2. Add the resize handle as its **first child**:

```tsx
<div
  className={`conflict-drawer ${open ? 'conflict-drawer--open' : ''}`}
  style={{ width }}
  ref={drawerRef}
  role="dialog"
  aria-modal="true"
  aria-label="Merge conflicts"
>
  <div className="drawer-resize-handle" onMouseDown={handleResizeStart} />
  {/* rest of existing content unchanged */}
```

- [ ] **Step 5: Remove fixed width from CSS**

In `src/renderer/src/assets/sprint-pipeline-neon.css`, find `.conflict-drawer` (around line 1877) and remove the `width: 440px` line. The drawer's `position: fixed; right: 0; top: 0; bottom: 0` lines stay. Also update the `transform: translateX(440px)` on `.conflict-drawer` (closed state) to use a CSS variable or just remove the transition offset — the simplest fix is to change it to `transform: translateX(100%)` so it always slides fully off-screen regardless of width.

Before:

```css
.conflict-drawer {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 440px;
  /* ... */
  transform: translateX(440px);
}
```

After:

```css
.conflict-drawer {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  /* width removed — controlled by inline style from useDrawerResize */
  /* ... */
  transform: translateX(100%);
}
```

- [ ] **Step 6: Run all ConflictDrawer tests**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/ConflictDrawer.test.tsx
```

Expected: All tests pass including the new resize handle test.

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: Zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/sprint/ConflictDrawer.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat: make ConflictDrawer resizable"
```

---

## Task 5: Add resize to HealthCheckDrawer

**Files:**

- Modify: `src/renderer/src/components/sprint/HealthCheckDrawer.tsx`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css` (remove fixed width for `.health-drawer`)

Pattern is identical to Task 4. Follow the same steps.

- [ ] **Step 1: Write failing test**

Find the existing HealthCheckDrawer test file (check `src/renderer/src/components/sprint/__tests__/`). If it doesn't exist, create it with the minimal setup from ConflictDrawer.test.tsx as a template. Add:

```tsx
it('renders a resize handle', () => {
  const { container } = render(
    <HealthCheckDrawer
      open={true}
      tasks={[makeTask()]}
      onClose={vi.fn()}
      onRescue={vi.fn()}
      onDismiss={vi.fn()}
    />
  )
  expect(container.querySelector('.drawer-resize-handle')).not.toBeNull()
})
```

Check `HealthCheckDrawer`'s prop types to get the exact prop names for the test.

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/HealthCheckDrawer.test.tsx
```

- [ ] **Step 3: Implement — add hook and handle div**

In `src/renderer/src/components/sprint/HealthCheckDrawer.tsx`:

Add import:

```ts
import { useDrawerResize } from '../../hooks/useDrawerResize'
```

Inside component, add:

```ts
const { width, handleResizeStart } = useDrawerResize({
  defaultWidth: 440,
  minWidth: 300,
  maxWidth: 600
})
```

Add `style={{ width }}` to the `.health-drawer` div and insert the resize handle as its first child:

```tsx
<div className={`health-drawer ${open ? 'health-drawer--open' : ''}`} style={{ width }} ref={drawerRef} ...>
  <div className="drawer-resize-handle" onMouseDown={handleResizeStart} />
  {/* existing content unchanged */}
```

- [ ] **Step 4: Update CSS in `sprint-pipeline-neon.css`**

Find `.health-drawer` (around line 2075) and apply the same changes as Task 4:

- Remove `width: 440px`
- Change `transform: translateX(440px)` to `transform: translateX(100%)`

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/HealthCheckDrawer.test.tsx
```

Expected: All pass.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/renderer/src/components/sprint/HealthCheckDrawer.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat: make HealthCheckDrawer resizable"
```

---

## Task 6: Make CodeReview layout resizable

**Files:**

- Modify: `src/renderer/src/views/CodeReviewView.tsx`
- Modify: `src/renderer/src/assets/code-review-neon.css`

- [ ] **Step 1: Read both files before editing**

Read `CodeReviewView.tsx` (full file, it's short) and the `.cr-queue` rules in `code-review-neon.css`.

- [ ] **Step 2: Write a failing render test**

In `src/renderer/src/views/__tests__/CodeReviewView.test.tsx` (create if it doesn't exist):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CodeReviewView from '../CodeReviewView'

// Mock all child components and stores used by CodeReviewView
vi.mock('../../stores/commandPalette', () => ({
  useCommandPaletteStore: () => ({ registerCommands: vi.fn(), unregisterCommands: vi.fn() })
}))
vi.mock('../../stores/codeReview', () => ({
  useCodeReviewStore: () => ({
    selectedTaskId: null,
    selectTask: vi.fn(),
    selectAllBatch: vi.fn(),
    clearBatch: vi.fn()
  })
}))
vi.mock('../../stores/sprintTasks', () => ({
  useSprintTasks: () => ({ tasks: [] })
}))
vi.mock('../../stores/toasts', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('../../components/code-review/ReviewQueue', () => ({
  ReviewQueue: () => <div data-testid="review-queue" />
}))
vi.mock('../../components/code-review/ReviewDetail', () => ({
  ReviewDetail: () => <div data-testid="review-detail" />
}))
vi.mock('../../components/code-review/ReviewActions', () => ({
  ReviewActions: () => <div data-testid="review-actions" />
}))
vi.mock('../../components/code-review/BatchActions', () => ({
  BatchActions: () => <div data-testid="batch-actions" />
}))

describe('CodeReviewView', () => {
  it('renders ReviewQueue and main content', () => {
    render(<CodeReviewView />)
    expect(screen.getByTestId('review-queue')).toBeDefined()
    expect(screen.getByTestId('review-detail')).toBeDefined()
  })
})
```

Run to confirm it passes before the change:

```bash
npx vitest run src/renderer/src/views/__tests__/CodeReviewView.test.tsx
```

This is a "does it still render" smoke test — it should pass before AND after the change.

- [ ] **Step 3: Update `CodeReviewView.tsx`**

Add import at the top:

```ts
import { Group, Panel, Separator } from 'react-resizable-panels'
```

Replace the render return from:

```tsx
<motion.div className="cr-view" ...>
  <ReviewQueue />
  <BatchActions />
  <div className="cr-main">
    <ReviewDetail />
    <ReviewActions />
  </div>
</motion.div>
```

To:

```tsx
<motion.div className="cr-view" ...>
  <Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
    <Panel defaultSize={22} minSize={12} maxSize={40}>
      <ReviewQueue />
    </Panel>
    <Separator className="panel-separator" />
    <Panel minSize={40}>
      <div className="cr-main">
        <ReviewDetail />
        <ReviewActions />
      </div>
    </Panel>
  </Group>
  <BatchActions />
</motion.div>
```

Note: `<BatchActions />` is `position: absolute` — it stays as a sibling of `<Group>`, not inside a Panel.

- [ ] **Step 4: Update `code-review-neon.css`**

Find `.cr-queue` and remove these two lines:

```css
width: 260px;
min-width: 160px;
```

Keep all other `.cr-queue` rules (`height: 100%`, `overflow-y: auto`, `flex-direction: column`, borders, etc.).

Also ensure `.cr-view` has `display: flex; flex-direction: column; height: 100%` — it likely already does, just confirm.

- [ ] **Step 5: Run test to confirm it still passes**

```bash
npx vitest run src/renderer/src/views/__tests__/CodeReviewView.test.tsx
```

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/renderer/src/views/CodeReviewView.tsx src/renderer/src/assets/code-review-neon.css
git commit -m "feat: make CodeReview queue sidebar resizable"
```

---

## Task 7: Make Agents view sidebar resizable

**Files:**

- Modify: `src/renderer/src/views/AgentsView.tsx`
- Modify: `src/renderer/src/assets/agents-neon.css`

- [ ] **Step 1: Read AgentsView.tsx lines 238–320** to understand the exact flex container structure wrapping `.agents-sidebar`.

- [ ] **Step 2: Write a smoke test** (or add to existing AgentsView.test.tsx if it exists)

Check `src/renderer/src/views/__tests__/AgentsView.test.tsx`. Add or confirm there's a test that the component renders without error. Run it before editing:

```bash
npx vitest run src/renderer/src/views/__tests__/AgentsView.test.tsx
```

- [ ] **Step 3: Update `AgentsView.tsx`**

Add import:

```ts
import { Group, Panel, Separator } from 'react-resizable-panels'
```

Find the inner flex row (around line 255):

```tsx
<div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
  <div className="agents-sidebar">{/* ... */}</div>
  {/* agent console content */}
</div>
```

Replace with:

```tsx
<Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
  <Panel defaultSize={20} minSize={12} maxSize={40}>
    <div className="agents-sidebar">{/* unchanged content */}</div>
  </Panel>
  <Separator className="panel-separator" />
  <Panel minSize={40}>{/* unchanged console content */}</Panel>
</Group>
```

The outer `<motion.div style={{ display: 'flex', flexDirection: 'column', ... }}>` stays unchanged.

- [ ] **Step 4: Update `agents-neon.css`**

Find `.agents-sidebar` and remove:

- `width: 220px`
- `min-width: 180px`
- `max-width: 400px`
- `resize: horizontal` ← **critical: this creates a conflicting native resize handle**
- `overflow: hidden` (was paired with `resize: horizontal`; replace with `overflow-y: auto` if not already present)

Keep: `height: 100%`, `flex-direction: column`, border and background rules.

- [ ] **Step 5: Run tests + typecheck**

```bash
npx vitest run src/renderer/src/views/__tests__/AgentsView.test.tsx
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/views/AgentsView.tsx src/renderer/src/assets/agents-neon.css
git commit -m "feat: make Agents sidebar resizable"
```

---

## Task 8: Make Diff file sidebar resizable

**Files:**

- Modify: `src/renderer/src/components/diff/DiffViewer.tsx`
- Modify: `src/renderer/src/assets/diff.css`

- [ ] **Step 1: Read `DiffViewer.tsx` around lines 430–445** to see the `.diff-view-container` return structure. Confirm `diff-content` has `ref={containerRef}`.

- [ ] **Step 2: Add import to `DiffViewer.tsx`**

```ts
import { Group, Panel, Separator } from 'react-resizable-panels'
```

- [ ] **Step 3: Wrap the file list and content**

The main return (non-empty case, around line 433):

```tsx
// Before
<div className="diff-view-container">
  <DiffFileList files={files} activeFileIndex={activeFileIndex} onSelect={scrollToFile} />
  <div className="diff-content" ref={containerRef}>
    {/* ... */}
  </div>
</div>

// After
<div className="diff-view-container">
  <Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
    <Panel defaultSize={22} minSize={10} maxSize={40}>
      <DiffFileList files={files} activeFileIndex={activeFileIndex} onSelect={scrollToFile} />
    </Panel>
    <Separator className="panel-separator" />
    <Panel minSize={40}>
      <div className="diff-content" ref={containerRef}>
        {/* unchanged content */}
      </div>
    </Panel>
  </Group>
</div>
```

The `ref={containerRef}` stays on the inner `<div className="diff-content">` — the Panel wrapper doesn't affect it.

- [ ] **Step 4: Update `diff.css`**

Find `.diff-sidebar` (line 139) and remove:

- `width: 200px`
- `flex-shrink: 0`

Keep: `display: flex; flex-direction: column; background; backdrop-filter; border-right; overflow: hidden`.

The `.diff-view__loading-sidebar { width: 260px }` (skeleton loader shown before data loads) can stay — it's unrelated to the resizable layout.

- [ ] **Step 5: Run tests + typecheck**

```bash
npx vitest run src/renderer/src/components/diff/
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/diff/DiffViewer.tsx src/renderer/src/assets/diff.css
git commit -m "feat: make diff file sidebar resizable"
```

---

## Task 9: Make Settings sidebar resizable

**Files:**

- Modify: `src/renderer/src/views/SettingsView.tsx`
- Modify: `src/renderer/src/assets/settings-v2-neon.css`

- [ ] **Step 1: Read `SettingsView.tsx`** (full file, short) to see the `.stg-layout` structure.

- [ ] **Step 2: Update `SettingsView.tsx`**

Add import:

```ts
import { Group, Panel, Separator } from 'react-resizable-panels'
```

The return is currently:

```tsx
<div className="stg-layout">
  <SettingsSidebar sections={SECTIONS} activeId={activeId} onSelect={handleSelect} />
  <motion.div className="stg-content" ...>
    {/* content */}
  </motion.div>
  <div aria-live="polite" className="sr-only">{meta.title} settings</div>
</div>
```

Replace with:

```tsx
<div className="stg-layout">
  <Group orientation="horizontal" style={{ flex: 1, height: '100%' }}>
    <Panel defaultSize={18} minSize={12} maxSize={30}>
      <SettingsSidebar sections={SECTIONS} activeId={activeId} onSelect={handleSelect} />
    </Panel>
    <Separator className="panel-separator" />
    <Panel minSize={50}>
      <motion.div className="stg-content" ...>
        {/* content unchanged */}
      </motion.div>
    </Panel>
  </Group>
  <div aria-live="polite" className="sr-only">{meta.title} settings</div>
</div>
```

- [ ] **Step 3: Update `settings-v2-neon.css`**

Find `.stg-sidebar` and remove:

- `width: 180px`
- `min-width: 180px`
- `flex-shrink: 0`

Keep: border-right, padding, background, overflow-y, height.

Confirm `.stg-layout` has `display: flex; height: 100%` (already does — just verify, no change needed).

- [ ] **Step 4: Run tests + typecheck**

```bash
npx vitest run
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/views/SettingsView.tsx src/renderer/src/assets/settings-v2-neon.css
git commit -m "feat: make Settings sidebar resizable"
```

---

## Task 10: Fix IDEView sidebar collapse using imperative Panel API

**Files:**

- Modify: `src/renderer/src/views/IDEView.tsx`

The IDE sidebar is already inside a `react-resizable-panels` Group. The current pattern conditionally unmounts the sidebar Panel (`{!sidebarCollapsed && <Panel>}`), which causes the library to lose size tracking. Fix it using the imperative `collapse()`/`expand()` API.

- [ ] **Step 1: Read IDEView.tsx lines 315–390** to see the current conditional Panel mount pattern.

- [ ] **Step 2: Add `usePanelRef` import**

In `IDEView.tsx`, add to the `react-resizable-panels` import:

```ts
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
```

- [ ] **Step 3: Replace conditional mount with imperative collapse**

In the component body, add:

```ts
const sidebarPanelRef = usePanelRef()

useEffect(() => {
  if (sidebarCollapsed) {
    sidebarPanelRef.current?.collapse()
  } else {
    sidebarPanelRef.current?.expand()
  }
}, [sidebarCollapsed, sidebarPanelRef])
```

In the JSX, replace the conditional Panel mount:

```tsx
// Before (conditional mount — causes library to lose size tracking)
{!sidebarCollapsed && (
  <>
    <Panel defaultSize={20} minSize={10}>
      <FileSidebar onOpenFile={handleOpenFile} />
    </Panel>
    <Separator className="ide-separator ide-separator--h" />
  </>
)}
<Panel defaultSize={sidebarCollapsed ? 100 : 80} minSize={30}>
  {/* editor content */}
</Panel>

// After (always-mounted, imperative collapse)
<Panel panelRef={sidebarPanelRef} defaultSize={20} minSize={10} collapsible>
  <FileSidebar onOpenFile={handleOpenFile} />
</Panel>
<Separator className="ide-separator ide-separator--h" />
<Panel defaultSize={80} minSize={30}>
  {/* editor content — remove the sidebarCollapsed ? 100 : 80 conditional */}
</Panel>
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npx vitest run src/renderer/src/views/__tests__/IDEView.test.tsx 2>/dev/null || echo "no IDE tests"
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/views/IDEView.tsx
git commit -m "fix: use imperative Panel API for IDEView sidebar collapse"
```

---

## Task 11: Final validation

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: Zero errors (warnings OK).

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: Zero errors.

- [ ] **Step 4: Manual smoke test** (if running the app)

For each surface, verify:

- [ ] TaskDetailDrawer — drag left edge, width updates live; release off-screen, drag state cleans up
- [ ] ConflictDrawer — drag handle, slides to correct width
- [ ] HealthCheckDrawer — drag handle, slides to correct width
- [ ] CodeReview — drag separator between queue and detail panels
- [ ] Agents — drag separator between fleet list and console
- [ ] Diff viewer — drag separator between file list and diff content
- [ ] Settings — drag separator between nav and content panels
- [ ] IDE sidebar — ⌘B still toggles collapse; separator still draggable when open
- [ ] App restart: all sizes reset to defaults (session-only confirmed)
