# Pipeline UX & Speed — Quick-Create, Notifications, Shortcuts, Cost, Saved Views, Density

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Task Pipeline the fastest, most keyboard-driven interface in BDE. Add inline task creation from any view, desktop notifications for background events, single-key action shortcuts, per-task cost badges, saved filter presets, and a compact list density toggle.

**Architecture:** Six features, mostly renderer-only. Task 1 (Quick-Create) touches `App.tsx` and a new component. Task 2 (Desktop Notifications) extends the existing `useDesktopNotifications` hook and adds a settings integration. Tasks 3-6 are renderer-only. All six features are independent and can be parallelized.

**Tech Stack:** TypeScript, React, Zustand, Electron `Notification` API, vitest, CSS

**Spec:** `docs/superpowers/specs/2026-04-03-developer-persona-audit.md` (items 2, 3, 6, 13, 16, 29)

---

## Task 1: Quick-Create from Any View (Cmd+N)

A floating inline creation bar at the top of any view. `Cmd+N` opens it. Title + `Enter` creates a backlog task. Title + `Cmd+Enter` creates and queues with auto-generated spec.

**Files:**

- Create: `src/renderer/src/components/ui/QuickCreateBar.tsx`
- Create: `src/renderer/src/components/ui/__tests__/QuickCreateBar.test.tsx`
- Modify: `src/renderer/src/App.tsx` (add Cmd+N handler + render QuickCreateBar)
- Modify: `src/renderer/src/stores/sprintUI.ts` (add `quickCreateOpen` state)
- Modify: `src/renderer/src/assets/neon-shell.css` (add `.quick-create-*` styles)
- Modify: `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts` (remove `n` → openWorkbench, avoid conflict with Cmd+N)

### Step 1: Add quickCreateOpen state to sprintUI store

- [ ] **1a: Write failing test for quickCreateOpen toggle**

```typescript
// src/renderer/src/stores/__tests__/sprintUI-quickCreate.test.ts
import { useSprintUI } from '../sprintUI'

describe('sprintUI quickCreate state', () => {
  beforeEach(() => {
    useSprintUI.setState({ quickCreateOpen: false })
  })

  it('defaults quickCreateOpen to false', () => {
    expect(useSprintUI.getState().quickCreateOpen).toBe(false)
  })

  it('toggles quickCreateOpen', () => {
    useSprintUI.getState().toggleQuickCreate()
    expect(useSprintUI.getState().quickCreateOpen).toBe(true)
    useSprintUI.getState().toggleQuickCreate()
    expect(useSprintUI.getState().quickCreateOpen).toBe(false)
  })

  it('setQuickCreateOpen sets explicit value', () => {
    useSprintUI.getState().setQuickCreateOpen(true)
    expect(useSprintUI.getState().quickCreateOpen).toBe(true)
    useSprintUI.getState().setQuickCreateOpen(false)
    expect(useSprintUI.getState().quickCreateOpen).toBe(false)
  })
})
```

Run: `npx vitest run src/renderer/src/stores/__tests__/sprintUI-quickCreate.test.ts`
Expected: FAIL — `quickCreateOpen` and `toggleQuickCreate` don't exist yet.

- [ ] **1b: Implement quickCreateOpen in sprintUI store**

In `src/renderer/src/stores/sprintUI.ts`, add to the interface:

```typescript
quickCreateOpen: boolean
setQuickCreateOpen: (open: boolean) => void
toggleQuickCreate: () => void
```

Add to the store creation:

```typescript
quickCreateOpen: false,
setQuickCreateOpen: (open): void => set({ quickCreateOpen: open }),
toggleQuickCreate: (): void => set((s) => ({ quickCreateOpen: !s.quickCreateOpen })),
```

- [ ] **1c: Verify test passes**

Run: `npx vitest run src/renderer/src/stores/__tests__/sprintUI-quickCreate.test.ts`

### Step 2: Build QuickCreateBar component

- [ ] **2a: Write failing test for QuickCreateBar**

```typescript
// src/renderer/src/components/ui/__tests__/QuickCreateBar.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { QuickCreateBar } from '../QuickCreateBar'

// Mock window.api.sprint
const mockCreate = vi.fn().mockResolvedValue({ id: 'new-1', title: 'Test' })
const mockGeneratePrompt = vi.fn().mockResolvedValue({ taskId: 'new-1', spec: '## Spec', prompt: 'Test' })

vi.stubGlobal('window', {
  ...window,
  api: {
    sprint: { create: mockCreate, generatePrompt: mockGeneratePrompt },
    getRepoPaths: vi.fn().mockResolvedValue({ bde: '/path/bde' })
  }
})

describe('QuickCreateBar', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders input when open', () => {
    render(<QuickCreateBar open={true} onClose={onClose} defaultRepo="bde" />)
    expect(screen.getByPlaceholderText(/task title/i)).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<QuickCreateBar open={false} onClose={onClose} defaultRepo="bde" />)
    expect(screen.queryByPlaceholderText(/task title/i)).not.toBeInTheDocument()
  })

  it('creates backlog task on Enter', async () => {
    render(<QuickCreateBar open={true} onClose={onClose} defaultRepo="bde" />)
    const input = screen.getByPlaceholderText(/task title/i)
    fireEvent.change(input, { target: { value: 'Fix bug' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Fix bug',
          repo: 'bde',
          status: 'backlog'
        })
      )
    })
  })

  it('closes on Escape', () => {
    render(<QuickCreateBar open={true} onClose={onClose} defaultRepo="bde" />)
    const input = screen.getByPlaceholderText(/task title/i)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('creates queued task on Cmd+Enter', async () => {
    render(<QuickCreateBar open={true} onClose={onClose} defaultRepo="bde" />)
    const input = screen.getByPlaceholderText(/task title/i)
    fireEvent.change(input, { target: { value: 'Add feature' } })
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Add feature',
          repo: 'bde',
          status: 'queued'
        })
      )
    })
  })
})
```

Run: `npx vitest run src/renderer/src/components/ui/__tests__/QuickCreateBar.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **2b: Implement QuickCreateBar component**

```typescript
// src/renderer/src/components/ui/QuickCreateBar.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Zap } from 'lucide-react'
import { useSprintTasks } from '../../stores/sprintTasks'
import { toast } from '../../stores/toasts'
import { TASK_STATUS } from '../../../../shared/constants'
import { SPRINGS, useReducedMotion } from '../../lib/motion'

interface QuickCreateBarProps {
  open: boolean
  onClose: () => void
  defaultRepo: string
}

export function QuickCreateBar({ open, onClose, defaultRepo }: QuickCreateBarProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const loadData = useSprintTasks((s) => s.loadData)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (open) {
      setTitle('')
      // Focus after animation
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const handleSubmit = useCallback(
    async (queue: boolean) => {
      const trimmed = title.trim()
      if (!trimmed || submitting) return

      setSubmitting(true)
      try {
        const status = queue ? TASK_STATUS.QUEUED : TASK_STATUS.BACKLOG
        await window.api.sprint.create({
          title: trimmed,
          repo: defaultRepo,
          prompt: trimmed,
          priority: 3,
          status
        })
        toast.success(queue ? 'Task queued' : 'Task added to backlog')
        setTitle('')
        onClose()
        loadData()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create task')
      } finally {
        setSubmitting(false)
      }
    },
    [title, submitting, defaultRepo, onClose, loadData]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit(e.metaKey || e.ctrlKey)
      }
    },
    [onClose, handleSubmit]
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="quick-create-bar"
          initial={{ opacity: 0, y: -32 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -32 }}
          transition={reduced ? { duration: 0 } : SPRINGS.snappy}
          data-testid="quick-create-bar"
        >
          <Plus size={14} className="quick-create-bar__icon" />
          <input
            ref={inputRef}
            type="text"
            className="quick-create-bar__input"
            placeholder="Task title — Enter to backlog, Cmd+Enter to queue"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={submitting}
            aria-label="Quick create task title"
          />
          <div className="quick-create-bar__hints">
            <span className="quick-create-bar__hint">
              <kbd>Enter</kbd> Backlog
            </span>
            <span className="quick-create-bar__hint quick-create-bar__hint--queue">
              <Zap size={10} />
              <kbd>Cmd+Enter</kbd> Queue
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **2c: Add CSS styles**

In `src/renderer/src/assets/neon-shell.css`, add at the end:

```css
/* ── Quick Create Bar ── */
.quick-create-bar {
  position: fixed;
  top: 68px; /* below header + traffic light zone */
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--neon-surface);
  border: 1px solid var(--neon-cyan-border);
  border-radius: 8px;
  box-shadow: var(--bde-shadow-lg);
  width: min(560px, 80vw);
  font-family: var(--bde-font-code);
}
.quick-create-bar__icon { color: var(--neon-cyan); flex-shrink: 0; }
.quick-create-bar__input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--neon-text);
  font-size: 13px;
  font-family: var(--bde-font-code);
}
.quick-create-bar__input::placeholder { color: var(--neon-text-dim); }
.quick-create-bar__hints {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.quick-create-bar__hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--neon-text-dim);
}
.quick-create-bar__hint kbd {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--neon-surface-deep);
  border: 1px solid var(--neon-border);
  font-size: 9px;
}
.quick-create-bar__hint--queue { color: var(--neon-orange); }
```

- [ ] **2d: Verify test passes**

Run: `npx vitest run src/renderer/src/components/ui/__tests__/QuickCreateBar.test.tsx`

### Step 3: Wire Cmd+N in App.tsx

- [ ] **3a: Add Cmd+N handler to App.tsx**

In `src/renderer/src/App.tsx`, import `QuickCreateBar` and `useSprintUI`, then:

1. In the `handleKeyDown` callback, after the `Cmd+R` block, add:

```typescript
if (e.metaKey && e.key === 'n') {
  e.preventDefault()
  useSprintUI.getState().toggleQuickCreate()
  return
}
```

2. Inside the `App` return JSX, just before `<CommandPalette>`, render:

```tsx
<QuickCreateBar
  open={useSprintUI.getState().quickCreateOpen}
  onClose={() => useSprintUI.getState().setQuickCreateOpen(false)}
  defaultRepo="bde"
/>
```

Note: Use the store via hook selectors (not getState) for reactivity. Add:

```typescript
const quickCreateOpen = useSprintUI((s) => s.quickCreateOpen)
const setQuickCreateOpen = useSprintUI((s) => s.setQuickCreateOpen)
const toggleQuickCreate = useSprintUI((s) => s.toggleQuickCreate)
```

- [ ] **3b: Remove standalone `n` shortcut from useSprintKeyboardShortcuts**

In `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts`, the bare `n` key currently opens the workbench. Remove that binding (lines 61-64) to avoid conflict with Cmd+N. The workbench is still accessible via Cmd+0.

- [ ] **3c: Run full test suite**

Run: `npm test`
Run: `npm run typecheck`

- [ ] **3d: Commit**

```
feat: add Cmd+N quick-create bar for inline task creation from any view
```

---

## Task 2: Desktop Notifications — Configurable per Event Type

Extend the existing `useDesktopNotifications` hook to cover failure and review-needed events, make notification types configurable via settings, and add click-to-navigate.

**Files:**

- Modify: `src/renderer/src/hooks/useDesktopNotifications.ts`
- Create: `src/renderer/src/hooks/__tests__/useDesktopNotifications.test.ts`
- Modify: `src/renderer/src/stores/notifications.ts` (add `review_needed` type)
- Modify: `src/renderer/src/stores/sprintUI.ts` or create settings integration for notification prefs
- Modify: `src/renderer/src/assets/neon-shell.css` (no new CSS needed — uses native Notification API)

### Step 1: Write failing tests for extended notifications

- [ ] **1a: Write test for failure and review notifications**

```typescript
// src/renderer/src/hooks/__tests__/useDesktopNotifications.test.ts
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useDesktopNotifications } from '../useDesktopNotifications'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useNotificationsStore } from '../../stores/notifications'

// Mock Notification API
const mockNotification = vi.fn()
vi.stubGlobal('Notification', class {
  static permission = 'granted'
  static requestPermission = vi.fn().mockResolvedValue('granted')
  constructor(title: string, opts: unknown) { mockNotification(title, opts) }
})

// Mock document.hasFocus to return false (background)
vi.spyOn(document, 'hasFocus').mockReturnValue(false)

const makeTask = (overrides = {}) => ({
  id: 'task-1',
  title: 'Test task',
  repo: 'bde',
  status: 'backlog',
  priority: 3,
  prompt: null,
  notes: null,
  spec: null,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides
})

describe('useDesktopNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSprintTasks.setState({ tasks: [], prMergedMap: {} })
    useNotificationsStore.setState({ notifications: [] })
  })

  it('fires notification on task failure (active → failed)', () => {
    // Seed initial state
    useSprintTasks.setState({ tasks: [makeTask({ status: 'active' })] })
    const { rerender } = renderHook(() => useDesktopNotifications())

    // Transition to failed
    act(() => {
      useSprintTasks.setState({ tasks: [makeTask({ status: 'failed' })] })
    })
    rerender()

    expect(mockNotification).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      expect.objectContaining({ body: expect.stringContaining('Test task') })
    )
  })

  it('fires notification on review needed (active → review)', () => {
    useSprintTasks.setState({ tasks: [makeTask({ status: 'active' })] })
    const { rerender } = renderHook(() => useDesktopNotifications())

    act(() => {
      useSprintTasks.setState({ tasks: [makeTask({ status: 'review' })] })
    })
    rerender()

    expect(mockNotification).toHaveBeenCalledWith(
      expect.stringContaining('review'),
      expect.objectContaining({ body: expect.stringContaining('Test task') })
    )
  })
})
```

Run: `npx vitest run src/renderer/src/hooks/__tests__/useDesktopNotifications.test.ts`
Expected: FAIL — current hook doesn't handle `failed` or `review` transitions.

- [ ] **1b: Implement failure and review notification triggers**

In `src/renderer/src/hooks/useDesktopNotifications.ts`, in the task status change loop, after the `active → done` block, add:

```typescript
// Agent failed: active → failed/error
if (
  prev.status === TASK_STATUS.ACTIVE &&
  (task.status === TASK_STATUS.FAILED || task.status === TASK_STATUS.ERROR)
) {
  if (!shouldNotify()) continue

  const title = 'Agent failed'
  const message = `${task.title} — ${task.notes?.slice(0, 80) || 'check logs'}`

  addNotification({
    type: 'agent_failed',
    title,
    message,
    viewLink: `/sprint/${task.id}`
  })

  fireDesktopNotification(title, message)
  notifiedTasksRef.current.add(task.id)
}

// Review needed: active → review
if (prev.status === TASK_STATUS.ACTIVE && task.status === 'review') {
  if (!shouldNotify()) continue

  const title = 'Review needed'
  const message = `${task.title} — agent completed, awaiting review`

  addNotification({
    type: 'agent_completed',
    title,
    message,
    viewLink: `/sprint/${task.id}`
  })

  fireDesktopNotification(title, message)
  notifiedTasksRef.current.add(task.id)
}
```

- [ ] **1c: Add click-to-navigate support**

Replace the `fireDesktopNotification` function to accept a callback:

```typescript
function fireDesktopNotification(title: string, body: string, onClick?: () => void): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') {
    const n = new Notification(title, { body, silent: false })
    if (onClick) {
      n.onclick = () => {
        window.focus()
        onClick()
      }
    }
  }
}
```

For each notification call, pass a navigate callback. For task transitions:

```typescript
fireDesktopNotification(title, message, () => {
  window.dispatchEvent(
    new CustomEvent('bde:navigate', { detail: { view: 'sprint' } })
  )
})
```

- [ ] **1d: Run tests and typecheck**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useDesktopNotifications.test.ts`
Run: `npm run typecheck`

- [ ] **1e: Commit**

```
feat: extend desktop notifications for task failure and review-needed events
```

---

## Task 3: Pipeline Keyboard Shortcuts — Action Keys

Single-key shortcuts when a task is selected in the Pipeline: `L` launch, `S` stop, `R` retry, `D` delete, `Q` queue, `E` edit, `V` view spec. `J/K` for cross-stage navigation.

**Files:**

- Modify: `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx` (pass new action handlers to hook)
- Create: `src/renderer/src/hooks/__tests__/useSprintKeyboardShortcuts.test.ts`

### Step 1: Write failing tests for new shortcuts

- [ ] **1a: Write tests for L, S, Q, E, V, J, K shortcuts**

```typescript
// src/renderer/src/hooks/__tests__/useSprintKeyboardShortcuts.test.ts
import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useSprintKeyboardShortcuts } from '../useSprintKeyboardShortcuts'
import { useSprintUI } from '../../stores/sprintUI'
import { useSprintTasks } from '../../stores/sprintTasks'

const makeTask = (id: string, status: string) => ({
  id,
  title: `Task ${id}`,
  repo: 'bde',
  status,
  priority: 3,
  prompt: null,
  notes: null,
  spec: '## Spec\n## Details',
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString()
})

describe('useSprintKeyboardShortcuts', () => {
  const onLaunch = vi.fn()
  const onStop = vi.fn()
  const onEdit = vi.fn()
  const onViewSpec = vi.fn()
  const onQueue = vi.fn()
  const openWorkbench = vi.fn()
  const setConflictDrawerOpen = vi.fn()
  const onRetry = vi.fn()
  const onDelete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useSprintUI.setState({
      selectedTaskId: 'task-1',
      drawerOpen: true,
      specPanelOpen: false
    })
    useSprintTasks.setState({
      tasks: [
        makeTask('task-1', 'backlog'),
        makeTask('task-2', 'active'),
        makeTask('task-3', 'queued')
      ]
    })
  })

  it('L key launches selected backlog task', () => {
    renderHook(() =>
      useSprintKeyboardShortcuts({
        openWorkbench,
        setConflictDrawerOpen,
        onLaunch,
        onStop,
        onEdit,
        onViewSpec,
        onQueue,
        onRetry,
        onDelete
      })
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }))
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1' }))
  })

  it('S key stops selected active task', () => {
    useSprintUI.setState({ selectedTaskId: 'task-2' })

    renderHook(() =>
      useSprintKeyboardShortcuts({
        openWorkbench,
        setConflictDrawerOpen,
        onLaunch,
        onStop,
        onEdit,
        onViewSpec,
        onQueue,
        onRetry,
        onDelete
      })
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }))
    expect(onStop).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-2' }))
  })

  it('V key opens spec panel', () => {
    renderHook(() =>
      useSprintKeyboardShortcuts({
        openWorkbench,
        setConflictDrawerOpen,
        onLaunch,
        onStop,
        onEdit,
        onViewSpec,
        onQueue,
        onRetry,
        onDelete
      })
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }))
    expect(onViewSpec).toHaveBeenCalled()
  })

  it('Q key queues selected backlog task', () => {
    renderHook(() =>
      useSprintKeyboardShortcuts({
        openWorkbench,
        setConflictDrawerOpen,
        onLaunch,
        onStop,
        onEdit,
        onViewSpec,
        onQueue,
        onRetry,
        onDelete
      })
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))
    expect(onQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1' }))
  })

  it('ignores action keys when focused on text input', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    renderHook(() =>
      useSprintKeyboardShortcuts({
        openWorkbench,
        setConflictDrawerOpen,
        onLaunch,
        onStop,
        onEdit,
        onViewSpec,
        onQueue,
        onRetry,
        onDelete
      })
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }))
    expect(onLaunch).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })
})
```

Run: `npx vitest run src/renderer/src/hooks/__tests__/useSprintKeyboardShortcuts.test.ts`
Expected: FAIL — onLaunch, onStop, onQueue, onViewSpec not accepted as args yet.

- [ ] **1b: Extend the hook interface and implementation**

In `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts`:

1. Extend the args interface:

```typescript
interface UseSprintKeyboardShortcutsArgs {
  openWorkbench: () => void
  setConflictDrawerOpen: Dispatch<SetStateAction<boolean>>
  onRetry?: (task: SprintTask) => void
  onDelete?: (task: SprintTask) => void
  onLaunch?: (task: SprintTask) => void
  onStop?: (task: SprintTask) => void
  onEdit?: (task: SprintTask) => void
  onViewSpec?: () => void
  onQueue?: (task: SprintTask) => void
}
```

2. In the `handleKeyDown` function, inside the `selectedId` block, add handlers for each new key:

```typescript
if (e.key === 'l' && onLaunch) {
  if (task.status === 'backlog' || task.status === 'queued') {
    e.preventDefault()
    onLaunch(task)
  }
  return
}

if (e.key === 's' && onStop) {
  if (task.status === 'active') {
    e.preventDefault()
    onStop(task)
  }
  return
}

if (e.key === 'e' && onEdit) {
  e.preventDefault()
  onEdit(task)
  return
}

if (e.key === 'v' && onViewSpec) {
  if (task.spec) {
    e.preventDefault()
    onViewSpec()
  }
  return
}

if (e.key === 'q' && onQueue) {
  if (task.status === 'backlog') {
    e.preventDefault()
    onQueue(task)
  }
  return
}
```

3. Add J/K navigation for cross-stage task selection. After the single-key action block, but still inside the selectedId guard:

```typescript
if (e.key === 'j' || e.key === 'k') {
  e.preventDefault()
  const allTasks = useSprintTasks.getState().tasks
  const currentIndex = allTasks.findIndex((t) => t.id === selectedId)
  if (currentIndex === -1) return
  const delta = e.key === 'j' ? 1 : -1
  const nextIndex = Math.max(0, Math.min(allTasks.length - 1, currentIndex + delta))
  useSprintUI.getState().setSelectedTaskId(allTasks[nextIndex].id)
  return
}
```

- [ ] **1c: Wire new action handlers in SprintPipeline.tsx**

In `src/renderer/src/components/sprint/SprintPipeline.tsx`, update the `useSprintKeyboardShortcuts` call to pass the new handlers:

```typescript
useSprintKeyboardShortcuts({
  openWorkbench: () => setView('task-workbench'),
  setConflictDrawerOpen: (value) => {
    setConflictDrawerOpen(typeof value === 'function' ? value(conflictDrawerOpen) : value)
  },
  onRetry: handleRetry,
  onDelete: handleDeleteTask,
  onLaunch: launchTask,
  onStop: handleStop,
  onEdit: (task) => {
    useTaskWorkbenchStore.getState().loadTask(task)
    setView('task-workbench')
  },
  onViewSpec: () => setSpecPanelOpen(true),
  onQueue: handleAddToQueue
})
```

- [ ] **1d: Run tests and typecheck**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useSprintKeyboardShortcuts.test.ts`
Run: `npm test`
Run: `npm run typecheck`

- [ ] **1e: Commit**

```
feat: add single-key pipeline shortcuts (L/S/R/D/Q/E/V/J/K) for selected tasks
```

---

## Task 4: Cost Visibility Per Task

Show cost badge on completed TaskPills, cost breakdown in TaskDetailDrawer, and aggregate "today" cost in Dashboard.

**Files:**

- Modify: `src/renderer/src/components/sprint/TaskPill.tsx` (add cost badge)
- Modify: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` (add cost breakdown section)
- Modify: `src/renderer/src/views/DashboardView.tsx` (or `ActivitySection`) — aggregate cost card
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css` (cost badge styles)
- Create: `src/renderer/src/hooks/useTaskCost.ts` (lookup cost data by agent_run_id)
- Create: `src/renderer/src/hooks/__tests__/useTaskCost.test.ts`

### Step 1: Create useTaskCost hook

- [ ] **1a: Write failing test**

```typescript
// src/renderer/src/hooks/__tests__/useTaskCost.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskCost } from '../useTaskCost'
import { useCostDataStore } from '../../stores/costData'
import { renderHook } from '@testing-library/react'

describe('useTaskCost', () => {
  beforeEach(() => {
    useCostDataStore.setState({
      localAgents: [
        {
          id: 'agent-1',
          model: 'claude-sonnet-4-20250514',
          startedAt: '2026-04-03T10:00:00Z',
          finishedAt: '2026-04-03T10:05:00Z',
          costUsd: 0.42,
          tokensIn: 12000,
          tokensOut: 8000,
          cacheRead: 1000,
          cacheCreate: 500,
          durationMs: 300000,
          numTurns: 15,
          taskTitle: 'Fix bug',
          prUrl: null,
          repo: 'bde'
        }
      ],
      totalCost: 0.42,
      isFetching: false
    })
  })

  it('returns cost data for matching agent_run_id', () => {
    const { result } = renderHook(() => useTaskCost('agent-1'))
    expect(result.current).not.toBeNull()
    expect(result.current?.costUsd).toBe(0.42)
    expect(result.current?.tokensIn).toBe(12000)
  })

  it('returns null for unknown agent_run_id', () => {
    const { result } = renderHook(() => useTaskCost('agent-999'))
    expect(result.current).toBeNull()
  })

  it('returns null for null agent_run_id', () => {
    const { result } = renderHook(() => useTaskCost(null))
    expect(result.current).toBeNull()
  })
})
```

Run: `npx vitest run src/renderer/src/hooks/__tests__/useTaskCost.test.ts`
Expected: FAIL — hook doesn't exist.

- [ ] **1b: Implement useTaskCost hook**

```typescript
// src/renderer/src/hooks/useTaskCost.ts
import { useMemo } from 'react'
import { useCostDataStore } from '../stores/costData'
import type { AgentCostRecord } from '../../../shared/types'

export function useTaskCost(agentRunId: string | null): AgentCostRecord | null {
  const localAgents = useCostDataStore((s) => s.localAgents)
  return useMemo(() => {
    if (!agentRunId) return null
    return localAgents.find((a) => a.id === agentRunId) ?? null
  }, [agentRunId, localAgents])
}
```

- [ ] **1c: Verify test passes**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useTaskCost.test.ts`

### Step 2: Add cost badge to TaskPill

- [ ] **2a: Write failing test for cost badge on TaskPill**

```typescript
// In an existing or new TaskPill test file
// src/renderer/src/components/sprint/__tests__/TaskPill-cost.test.tsx
import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { TaskPill } from '../TaskPill'
import { useCostDataStore } from '../../../stores/costData'

// Mock framer-motion to avoid layout issues in tests
vi.mock('framer-motion', () => ({
  motion: { div: (props: Record<string, unknown>) => <div {...props} /> },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children
}))

const doneTask = {
  id: 'task-done',
  title: 'Completed task',
  repo: 'bde',
  status: 'done' as const,
  priority: 3,
  prompt: null,
  notes: null,
  spec: null,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: 'agent-cost-1',
  pr_number: null,
  pr_status: null,
  pr_url: null,
  pr_mergeable_state: null,
  claimed_by: null,
  started_at: '2026-04-03T10:00:00Z',
  completed_at: '2026-04-03T10:05:00Z',
  template_name: null,
  depends_on: null,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString()
}

describe('TaskPill cost badge', () => {
  beforeEach(() => {
    useCostDataStore.setState({
      localAgents: [
        {
          id: 'agent-cost-1',
          model: 'claude-sonnet-4-20250514',
          startedAt: '2026-04-03T10:00:00Z',
          finishedAt: '2026-04-03T10:05:00Z',
          costUsd: 0.42,
          tokensIn: 12000,
          tokensOut: 8000,
          cacheRead: 0,
          cacheCreate: 0,
          durationMs: 300000,
          numTurns: 15,
          taskTitle: 'Completed task',
          prUrl: null,
          repo: 'bde'
        }
      ],
      totalCost: 0.42,
      isFetching: false
    })
  })

  it('shows cost badge for done tasks with cost data', () => {
    render(<TaskPill task={doneTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('$0.42')).toBeInTheDocument()
  })
})
```

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskPill-cost.test.tsx`
Expected: FAIL — no cost badge rendered.

- [ ] **2b: Add cost badge to TaskPill**

In `src/renderer/src/components/sprint/TaskPill.tsx`:

1. Import the hook: `import { useTaskCost } from '../../hooks/useTaskCost'`
2. Inside the component, after the `elapsed` state setup:

```typescript
const costData = useTaskCost(task.agent_run_id)
const costLabel = costData?.costUsd != null && costData.costUsd > 0
  ? `$${costData.costUsd.toFixed(2)}`
  : null
```

3. In the JSX, after the duration span, add:

```tsx
{task.status === 'done' && costLabel && (
  <span className="task-pill__cost" title={`Agent cost: ${costLabel}`}>
    {costLabel}
  </span>
)}
```

- [ ] **2c: Add CSS for cost badge**

In `src/renderer/src/assets/sprint-pipeline-neon.css`, add after `.task-pill__duration`:

```css
.task-pill__cost {
  font-size: 9px;
  color: var(--neon-orange);
  background: var(--neon-orange-surface);
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
  font-family: var(--bde-font-code);
}
```

- [ ] **2d: Verify test passes**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskPill-cost.test.tsx`

### Step 3: Add cost breakdown to TaskDetailDrawer

- [ ] **3a: Add cost section to TaskDetailDrawer**

In `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`:

1. Import: `import { useTaskCost } from '../../hooks/useTaskCost'`
2. After `const agentEvents = ...`, add:

```typescript
const costData = useTaskCost(task.agent_run_id)
```

3. In the JSX, after the PR section and before the actions bar, add:

```tsx
{costData && costData.costUsd != null && (
  <div className="task-drawer__cost-section">
    <span className="task-drawer__label">Cost</span>
    <div className="task-drawer__cost-grid">
      <div className="task-drawer__cost-item">
        <span className="task-drawer__cost-value">${costData.costUsd.toFixed(3)}</span>
        <span className="task-drawer__cost-key">Total</span>
      </div>
      <div className="task-drawer__cost-item">
        <span className="task-drawer__cost-value">{costData.tokensIn?.toLocaleString() ?? '—'}</span>
        <span className="task-drawer__cost-key">Tokens In</span>
      </div>
      <div className="task-drawer__cost-item">
        <span className="task-drawer__cost-value">{costData.tokensOut?.toLocaleString() ?? '—'}</span>
        <span className="task-drawer__cost-key">Tokens Out</span>
      </div>
      {costData.numTurns != null && (
        <div className="task-drawer__cost-item">
          <span className="task-drawer__cost-value">{costData.numTurns}</span>
          <span className="task-drawer__cost-key">Turns</span>
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **3b: Add CSS for cost section**

In `src/renderer/src/assets/sprint-pipeline-neon.css`, add:

```css
/* ── Task Drawer: Cost Section ── */
.task-drawer__cost-section {
  padding: 8px 0;
  border-top: 1px solid var(--neon-border);
}
.task-drawer__cost-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 6px;
}
.task-drawer__cost-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.task-drawer__cost-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--neon-orange);
  font-family: var(--bde-font-code);
}
.task-drawer__cost-key {
  font-size: 9px;
  color: var(--neon-text-dim);
  text-transform: uppercase;
}
```

- [ ] **3c: Run tests and typecheck**

Run: `npm test`
Run: `npm run typecheck`

- [ ] **3d: Commit**

```
feat: add per-task cost visibility on TaskPill badges and TaskDetailDrawer breakdown
```

---

## Task 5: Saved Views / Filter Presets

Save named filter+sort configs. Access via PipelineFilterBar dropdown. Presets persisted to localStorage.

**Files:**

- Create: `src/renderer/src/stores/filterPresets.ts`
- Create: `src/renderer/src/stores/__tests__/filterPresets.test.ts`
- Modify: `src/renderer/src/components/sprint/PipelineFilterBar.tsx` (add preset dropdown)
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css` (preset dropdown styles)

### Step 1: Create filterPresets store

- [ ] **1a: Write failing test for filter presets store**

```typescript
// src/renderer/src/stores/__tests__/filterPresets.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterPresetsStore, type FilterPreset } from '../filterPresets'

describe('filterPresets store', () => {
  beforeEach(() => {
    useFilterPresetsStore.setState({ presets: [], activePresetId: null })
    localStorage.clear()
  })

  it('creates a preset', () => {
    useFilterPresetsStore.getState().savePreset({
      name: 'Standup',
      statusFilter: 'in-progress',
      repoFilter: null,
      searchQuery: ''
    })

    const presets = useFilterPresetsStore.getState().presets
    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('Standup')
    expect(presets[0].statusFilter).toBe('in-progress')
  })

  it('deletes a preset', () => {
    useFilterPresetsStore.getState().savePreset({
      name: 'Triage',
      statusFilter: 'failed',
      repoFilter: null,
      searchQuery: ''
    })
    const id = useFilterPresetsStore.getState().presets[0].id
    useFilterPresetsStore.getState().deletePreset(id)
    expect(useFilterPresetsStore.getState().presets).toHaveLength(0)
  })

  it('applies a preset and sets activePresetId', () => {
    useFilterPresetsStore.getState().savePreset({
      name: 'Active Only',
      statusFilter: 'in-progress',
      repoFilter: 'bde',
      searchQuery: 'auth'
    })
    const preset = useFilterPresetsStore.getState().presets[0]
    const result = useFilterPresetsStore.getState().applyPreset(preset.id)

    expect(result).toEqual({
      statusFilter: 'in-progress',
      repoFilter: 'bde',
      searchQuery: 'auth'
    })
    expect(useFilterPresetsStore.getState().activePresetId).toBe(preset.id)
  })

  it('persists to localStorage', () => {
    useFilterPresetsStore.getState().savePreset({
      name: 'Saved',
      statusFilter: 'done',
      repoFilter: null,
      searchQuery: ''
    })
    const stored = localStorage.getItem('bde:filter-presets')
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('Saved')
  })

  it('loads from localStorage', () => {
    const preset: FilterPreset = {
      id: 'test-id',
      name: 'Loaded',
      statusFilter: 'blocked',
      repoFilter: 'bde',
      searchQuery: 'fix'
    }
    localStorage.setItem('bde:filter-presets', JSON.stringify([preset]))
    useFilterPresetsStore.getState().loadPresets()
    expect(useFilterPresetsStore.getState().presets).toHaveLength(1)
    expect(useFilterPresetsStore.getState().presets[0].name).toBe('Loaded')
  })
})
```

Run: `npx vitest run src/renderer/src/stores/__tests__/filterPresets.test.ts`
Expected: FAIL — store doesn't exist.

- [ ] **1b: Implement filterPresets store**

```typescript
// src/renderer/src/stores/filterPresets.ts
import { create } from 'zustand'
import type { StatusFilter } from './sprintUI'

const STORAGE_KEY = 'bde:filter-presets'

export interface FilterPreset {
  id: string
  name: string
  statusFilter: StatusFilter
  repoFilter: string | null
  searchQuery: string
}

interface FilterPresetsState {
  presets: FilterPreset[]
  activePresetId: string | null
  savePreset: (input: Omit<FilterPreset, 'id'>) => void
  deletePreset: (id: string) => void
  applyPreset: (id: string) => { statusFilter: StatusFilter; repoFilter: string | null; searchQuery: string } | null
  loadPresets: () => void
  clearActivePreset: () => void
}

function persist(presets: FilterPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

export const useFilterPresetsStore = create<FilterPresetsState>((set, get) => ({
  presets: [],
  activePresetId: null,

  savePreset: (input): void => {
    const preset: FilterPreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...input
    }
    set((s) => {
      const next = [...s.presets, preset]
      persist(next)
      return { presets: next }
    })
  },

  deletePreset: (id): void => {
    set((s) => {
      const next = s.presets.filter((p) => p.id !== id)
      persist(next)
      return {
        presets: next,
        activePresetId: s.activePresetId === id ? null : s.activePresetId
      }
    })
  },

  applyPreset: (id) => {
    const preset = get().presets.find((p) => p.id === id)
    if (!preset) return null
    set({ activePresetId: id })
    return {
      statusFilter: preset.statusFilter,
      repoFilter: preset.repoFilter,
      searchQuery: preset.searchQuery
    }
  },

  loadPresets: (): void => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as FilterPreset[]
        set({ presets: Array.isArray(parsed) ? parsed : [] })
      }
    } catch {
      // Corrupted data — start fresh
    }
  },

  clearActivePreset: (): void => {
    set({ activePresetId: null })
  }
}))
```

- [ ] **1c: Verify test passes**

Run: `npx vitest run src/renderer/src/stores/__tests__/filterPresets.test.ts`

### Step 2: Add preset dropdown to PipelineFilterBar

- [ ] **2a: Modify PipelineFilterBar to include presets**

In `src/renderer/src/components/sprint/PipelineFilterBar.tsx`:

1. Import the store: `import { useFilterPresetsStore } from '../../stores/filterPresets'`
2. Import Lucide icons: `import { Search, Bookmark, X, Plus } from 'lucide-react'`
3. Add state for the save dialog:

```typescript
const [showSavePreset, setShowSavePreset] = useState(false)
const [presetName, setPresetName] = useState('')
```

4. Get store values:

```typescript
const presets = useFilterPresetsStore((s) => s.presets)
const activePresetId = useFilterPresetsStore((s) => s.activePresetId)
const savePreset = useFilterPresetsStore((s) => s.savePreset)
const deletePreset = useFilterPresetsStore((s) => s.deletePreset)
const applyPreset = useFilterPresetsStore((s) => s.applyPreset)
const clearActivePreset = useFilterPresetsStore((s) => s.clearActivePreset)
const loadPresets = useFilterPresetsStore((s) => s.loadPresets)
```

5. Load presets on mount: `useEffect(() => { loadPresets() }, [loadPresets])`

6. Add a preset section in the JSX after the repo chips:

```tsx
<div className="pipeline-filter-bar__presets">
  {presets.map((p) => (
    <button
      key={p.id}
      className={`pipeline-filter-bar__preset${activePresetId === p.id ? ' pipeline-filter-bar__preset--active' : ''}`}
      onClick={() => {
        const filters = applyPreset(p.id)
        if (filters) {
          setRepoFilter(filters.repoFilter)
          setSearchQuery(filters.searchQuery)
          useSprintUI.getState().setStatusFilter(filters.statusFilter)
        }
      }}
      title={`Apply preset: ${p.name}`}
    >
      <Bookmark size={10} />
      {p.name}
      <span
        className="pipeline-filter-bar__preset-delete"
        onClick={(e) => { e.stopPropagation(); deletePreset(p.id) }}
        role="button"
        tabIndex={0}
        aria-label={`Delete preset ${p.name}`}
      >
        <X size={8} />
      </span>
    </button>
  ))}
  <button
    className="pipeline-filter-bar__preset pipeline-filter-bar__preset--save"
    onClick={() => setShowSavePreset(true)}
    title="Save current filters as preset"
  >
    <Plus size={10} /> Save View
  </button>
</div>
{showSavePreset && (
  <div className="pipeline-filter-bar__save-form">
    <input
      type="text"
      placeholder="Preset name"
      value={presetName}
      onChange={(e) => setPresetName(e.target.value)}
      className="pipeline-filter-bar__input"
      autoFocus
      onKeyDown={(e) => {
        if (e.key === 'Enter' && presetName.trim()) {
          savePreset({
            name: presetName.trim(),
            statusFilter: useSprintUI.getState().statusFilter,
            repoFilter,
            searchQuery
          })
          setPresetName('')
          setShowSavePreset(false)
        }
        if (e.key === 'Escape') setShowSavePreset(false)
      }}
    />
  </div>
)}
```

7. Update the null-return guard to also show when presets exist:

```typescript
if (repos.length <= 1 && !searchQuery && presets.length === 0) return null
```

- [ ] **2b: Add CSS for presets**

In `src/renderer/src/assets/sprint-pipeline-neon.css`, add:

```css
/* ── Filter Presets ── */
.pipeline-filter-bar__presets {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-left: auto;
}
.pipeline-filter-bar__preset {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-family: var(--bde-font-code);
  background: var(--neon-surface-deep);
  border: 1px solid var(--neon-border);
  color: var(--neon-text-dim);
  cursor: pointer;
  transition: all 150ms ease;
}
.pipeline-filter-bar__preset:hover {
  border-color: var(--neon-cyan-border);
  color: var(--neon-text);
}
.pipeline-filter-bar__preset--active {
  border-color: var(--neon-cyan);
  color: var(--neon-cyan);
  background: var(--neon-cyan-surface);
}
.pipeline-filter-bar__preset--save {
  border-style: dashed;
  color: var(--neon-text-dim);
}
.pipeline-filter-bar__preset-delete {
  opacity: 0;
  transition: opacity 150ms ease;
  margin-left: 2px;
  cursor: pointer;
}
.pipeline-filter-bar__preset:hover .pipeline-filter-bar__preset-delete {
  opacity: 1;
}
.pipeline-filter-bar__save-form {
  margin-top: 4px;
}
```

- [ ] **2c: Run tests and typecheck**

Run: `npm test`
Run: `npm run typecheck`

- [ ] **2d: Commit**

```
feat: add saved filter presets to PipelineFilterBar with localStorage persistence
```

---

## Task 6: Pipeline Density Toggle

Switch between the current card view and a compact list/table view. Show more tasks in less vertical space.

**Files:**

- Modify: `src/renderer/src/stores/sprintUI.ts` (add `pipelineDensity` state)
- Create: `src/renderer/src/components/sprint/TaskRow.tsx` (compact list row component)
- Create: `src/renderer/src/components/sprint/__tests__/TaskRow.test.tsx`
- Modify: `src/renderer/src/components/sprint/PipelineStage.tsx` (render TaskRow or TaskPill based on density)
- Modify: `src/renderer/src/components/sprint/PipelineHeader.tsx` (add density toggle button)
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css` (compact row styles)

### Step 1: Add density state to sprintUI store

- [ ] **1a: Write failing test**

```typescript
// src/renderer/src/stores/__tests__/sprintUI-density.test.ts
import { useSprintUI } from '../sprintUI'

describe('sprintUI density toggle', () => {
  beforeEach(() => {
    useSprintUI.setState({ pipelineDensity: 'card' })
  })

  it('defaults to card density', () => {
    expect(useSprintUI.getState().pipelineDensity).toBe('card')
  })

  it('toggles between card and compact', () => {
    useSprintUI.getState().togglePipelineDensity()
    expect(useSprintUI.getState().pipelineDensity).toBe('compact')
    useSprintUI.getState().togglePipelineDensity()
    expect(useSprintUI.getState().pipelineDensity).toBe('card')
  })

  it('sets density explicitly', () => {
    useSprintUI.getState().setPipelineDensity('compact')
    expect(useSprintUI.getState().pipelineDensity).toBe('compact')
  })
})
```

Run: `npx vitest run src/renderer/src/stores/__tests__/sprintUI-density.test.ts`
Expected: FAIL — `pipelineDensity` doesn't exist.

- [ ] **1b: Implement density state**

In `src/renderer/src/stores/sprintUI.ts`:

1. Add type: `export type PipelineDensity = 'card' | 'compact'`
2. Add to interface:

```typescript
pipelineDensity: PipelineDensity
setPipelineDensity: (density: PipelineDensity) => void
togglePipelineDensity: () => void
```

3. Add to store:

```typescript
pipelineDensity: 'card' as PipelineDensity,
setPipelineDensity: (density): void => set({ pipelineDensity: density }),
togglePipelineDensity: (): void =>
  set((s) => ({ pipelineDensity: s.pipelineDensity === 'card' ? 'compact' : 'card' })),
```

- [ ] **1c: Verify test passes**

Run: `npx vitest run src/renderer/src/stores/__tests__/sprintUI-density.test.ts`

### Step 2: Build TaskRow compact component

- [ ] **2a: Write failing test for TaskRow**

```typescript
// src/renderer/src/components/sprint/__tests__/TaskRow.test.tsx
import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { TaskRow } from '../TaskRow'

const task = {
  id: 'task-1',
  title: 'Fix authentication bug',
  repo: 'bde',
  status: 'active' as const,
  priority: 2,
  prompt: null,
  notes: null,
  spec: null,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null,
  pr_url: null,
  pr_mergeable_state: null,
  claimed_by: null,
  started_at: '2026-04-03T10:00:00Z',
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString()
}

describe('TaskRow', () => {
  it('renders task title', () => {
    render(<TaskRow task={task} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('Fix authentication bug')).toBeInTheDocument()
  })

  it('renders repo badge', () => {
    render(<TaskRow task={task} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('bde')).toBeInTheDocument()
  })

  it('shows priority for P1-P2 tasks', () => {
    render(<TaskRow task={task} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('P2')).toBeInTheDocument()
  })

  it('applies selected class when selected', () => {
    render(<TaskRow task={task} selected={true} onClick={vi.fn()} />)
    const row = screen.getByRole('button', { name: /Fix authentication bug/i })
    expect(row.className).toContain('task-row--selected')
  })

  it('calls onClick with task id', () => {
    const onClick = vi.fn()
    render(<TaskRow task={task} selected={false} onClick={onClick} />)
    screen.getByRole('button', { name: /Fix authentication bug/i }).click()
    expect(onClick).toHaveBeenCalledWith('task-1')
  })
})
```

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskRow.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **2b: Implement TaskRow component**

```typescript
// src/renderer/src/components/sprint/TaskRow.tsx
import type { SprintTask } from '../../../../shared/types'
import { getDotColor } from '../../lib/task-format'
import { formatDuration } from '../../lib/format'
import { useTaskCost } from '../../hooks/useTaskCost'

interface TaskRowProps {
  task: SprintTask
  selected: boolean
  onClick: (id: string) => void
}

export function TaskRow({ task, selected, onClick }: TaskRowProps): React.JSX.Element {
  const costData = useTaskCost(task.agent_run_id)
  const costLabel = costData?.costUsd != null && costData.costUsd > 0
    ? `$${costData.costUsd.toFixed(2)}`
    : null

  return (
    <button
      className={`task-row${selected ? ' task-row--selected' : ''}`}
      onClick={() => onClick(task.id)}
      role="button"
      aria-label={`Task: ${task.title}, status: ${task.status}`}
      data-testid="task-row"
    >
      <span
        className="task-row__dot"
        style={{ background: getDotColor(task.status, task.pr_status) }}
      />
      <span className="task-row__title" title={task.title}>
        {task.title}
      </span>
      {task.priority <= 2 && (
        <span className="task-row__priority">P{task.priority}</span>
      )}
      <span className="task-row__repo">{task.repo}</span>
      {task.status === 'done' && task.started_at && task.completed_at && (
        <span className="task-row__duration">
          {formatDuration(task.started_at, task.completed_at)}
        </span>
      )}
      {task.status === 'done' && costLabel && (
        <span className="task-row__cost">{costLabel}</span>
      )}
    </button>
  )
}
```

- [ ] **2c: Verify test passes**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskRow.test.tsx`

### Step 3: Wire density toggle into PipelineStage and PipelineHeader

- [ ] **3a: Add density toggle button to PipelineHeader**

In `src/renderer/src/components/sprint/PipelineHeader.tsx`:

1. Import: `import { List, LayoutGrid } from 'lucide-react'`
2. Import: `import { useSprintUI } from '../../stores/sprintUI'`
3. Inside the component, add:

```typescript
const pipelineDensity = useSprintUI((s) => s.pipelineDensity)
const togglePipelineDensity = useSprintUI((s) => s.togglePipelineDensity)
```

4. In the JSX, after the health check badge, add:

```tsx
<button
  className="sprint-pipeline__badge sprint-pipeline__density-toggle"
  onClick={togglePipelineDensity}
  title={pipelineDensity === 'card' ? 'Switch to compact view' : 'Switch to card view'}
  aria-label={`View: ${pipelineDensity}`}
>
  {pipelineDensity === 'card' ? <List size={12} /> : <LayoutGrid size={12} />}
</button>
```

- [ ] **3b: Modify PipelineStage to render TaskRow in compact mode**

In `src/renderer/src/components/sprint/PipelineStage.tsx`:

1. Import: `import { TaskRow } from './TaskRow'`
2. Import: `import { useSprintUI } from '../../stores/sprintUI'`
3. Inside the component:

```typescript
const density = useSprintUI((s) => s.pipelineDensity)
```

4. In the cards rendering block, conditionally render:

```tsx
{density === 'compact' ? (
  tasks.map((task) => (
    <TaskRow
      key={task.id}
      task={task}
      selected={task.id === selectedTaskId}
      onClick={onTaskClick}
    />
  ))
) : (
  <AnimatePresence mode="popLayout">
    {tasks.map((task) => (
      <TaskPill
        key={task.id}
        task={task}
        selected={task.id === selectedTaskId}
        onClick={onTaskClick}
      />
    ))}
  </AnimatePresence>
)}
```

- [ ] **3c: Add CSS for compact rows and density toggle**

In `src/renderer/src/assets/sprint-pipeline-neon.css`, add:

```css
/* ── Density Toggle ── */
.sprint-pipeline__density-toggle {
  color: var(--neon-text-dim);
  border-color: var(--neon-border);
  margin-left: auto;
}
.sprint-pipeline__density-toggle:hover {
  color: var(--neon-cyan);
  border-color: var(--neon-cyan-border);
}

/* ── Compact Task Row ── */
.task-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--neon-border);
  color: var(--neon-text);
  font-family: var(--bde-font-code);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  transition: background 100ms ease;
}
.task-row:hover {
  background: var(--neon-surface);
}
.task-row--selected {
  background: var(--neon-cyan-surface);
  border-color: var(--neon-cyan-border);
}
.task-row__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.task-row__title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-row__priority {
  font-size: 9px;
  color: var(--neon-orange);
  flex-shrink: 0;
}
.task-row__repo {
  font-size: 9px;
  color: var(--neon-cyan);
  background: var(--neon-cyan-surface);
  padding: 0 4px;
  border-radius: 3px;
  flex-shrink: 0;
}
.task-row__duration {
  font-size: 9px;
  color: var(--neon-text-dim);
  flex-shrink: 0;
}
.task-row__cost {
  font-size: 9px;
  color: var(--neon-orange);
  flex-shrink: 0;
}
```

- [ ] **3d: Run tests and typecheck**

Run: `npm test`
Run: `npm run typecheck`

- [ ] **3e: Commit**

```
feat: add pipeline density toggle with compact list view for higher task density
```

---

## Verification Checklist

After all tasks are complete, run the full CI-equivalent checks:

```bash
npm run typecheck   # Zero errors
npm test            # All tests pass
npm run lint        # Zero errors (warnings OK)
```

All six features are independent — failing one does not block others. Each task produces a self-contained commit that can be merged independently.
