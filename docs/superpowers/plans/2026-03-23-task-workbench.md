# Task Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `NewTicketModal` with a full panel view — the Task Workbench — featuring a progressive-disclosure form, an AI Copilot sidebar, and tiered readiness checks that gate task submission.

**Architecture:** The workbench is a first-class panel view (`'task-workbench'`) in the existing panel system. Left pane holds the task form (title, repo, spec editor with inline AI actions, readiness checks, action buttons). Right pane holds a collapsible AI Copilot chat sidebar. All AI operations shell out to the `claude` CLI via `execFileAsync` in new IPC handlers. Form state lives in a dedicated Zustand store. The `N` shortcut and `+ New Ticket` button open the workbench panel instead of the modal.

**Tech Stack:** React 18, Zustand, TypeScript strict, `react-resizable-panels` (existing dep), `claude` CLI for AI, Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-03-23-task-workbench-design.md`

**What Already Exists:**

- `src/shared/ipc-channels.ts` — `WorkbenchChannels` interface fully defined (5 channels)
- `src/preload/index.ts` — `window.api.workbench.*` fully wired (5 methods)
- `src/main/handlers/workbench.ts` — `checkOperational` and `researchRepo` fully implemented; `chat`, `generateSpec`, `checkSpec` are stubs
- `src/main/index.ts` — `registerWorkbenchHandlers()` already called

---

## File Inventory

### New Files (9)

| File                                                              | Responsibility                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/renderer/src/views/TaskWorkbenchView.tsx`                    | View wrapper (motion fade-in, renders `<TaskWorkbench />`)                           |
| `src/renderer/src/components/task-workbench/TaskWorkbench.tsx`    | Main layout — resizable two-column split (form + copilot)                            |
| `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`    | The task form — title, repo, advanced fields, spec editor, readiness checks, actions |
| `src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx` | AI chat sidebar — message list, input, "Insert into spec" buttons                    |
| `src/renderer/src/components/task-workbench/ReadinessChecks.tsx`  | Collapsed/expanded readiness check display                                           |
| `src/renderer/src/components/task-workbench/SpecEditor.tsx`       | Markdown textarea with inline AI toolbar (Generate, Template, Research)              |
| `src/renderer/src/components/task-workbench/WorkbenchActions.tsx` | Split action button (Save to Backlog / Queue Now / Launch)                           |
| `src/renderer/src/stores/taskWorkbench.ts`                        | Zustand store — form state, copilot messages, check results                          |
| `src/renderer/src/hooks/useReadinessChecks.ts`                    | Tier 1 structural checks (pure logic, runs on every form change)                     |

### Modified Files (6)

| File                                                   | What Changes                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `src/renderer/src/stores/panelLayout.ts`               | Add `'task-workbench'` to `View` union, add label to `VIEW_LABELS`                   |
| `src/renderer/src/components/panels/PanelLeaf.tsx`     | Add lazy import + case in `resolveView()` switch                                     |
| `src/renderer/src/App.tsx`                             | Add to `VIEW_ORDER` and `VIEW_TITLES`                                                |
| `src/renderer/src/components/sprint/SprintToolbar.tsx` | Replace `NewTicketModal` open with workbench panel open                              |
| `src/renderer/src/components/sprint/SprintCenter.tsx`  | Remove `NewTicketModal` rendering and `modalOpen` state                              |
| `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts` | `N` key opens workbench panel instead of modal                                       |
| `src/main/handlers/workbench.ts`                       | Replace `chat`, `generateSpec`, `checkSpec` stubs with real `claude` CLI invocations |

---

## Task 1: Zustand Store — `taskWorkbench.ts`

**Files:**

- Create: `src/renderer/src/stores/taskWorkbench.ts`
- Create: `src/renderer/src/stores/__tests__/taskWorkbench.test.ts`
- Reference: `src/renderer/src/stores/sprintTasks.ts` (for `CreateTicketInput` type)
- Reference: `src/renderer/src/lib/constants.ts` (for `REPO_OPTIONS`)

- [ ] **Step 1: Write the failing tests for core store actions**

```typescript
// src/renderer/src/stores/__tests__/taskWorkbench.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTaskWorkbenchStore } from '../taskWorkbench'

// Mock window.api
vi.stubGlobal('window', {
  api: {
    workbench: {
      chat: vi.fn(),
      generateSpec: vi.fn(),
      checkSpec: vi.fn(),
      checkOperational: vi.fn(),
      researchRepo: vi.fn()
    },
    sprint: {
      create: vi.fn()
    }
  }
})

describe('taskWorkbench store', () => {
  beforeEach(() => {
    useTaskWorkbenchStore.getState().resetForm()
  })

  it('has correct defaults', () => {
    const s = useTaskWorkbenchStore.getState()
    expect(s.mode).toBe('create')
    expect(s.taskId).toBeNull()
    expect(s.title).toBe('')
    expect(s.repo).toBe('BDE')
    expect(s.priority).toBe(3)
    expect(s.spec).toBe('')
    expect(s.copilotVisible).toBe(true)
    expect(s.copilotMessages).toHaveLength(1) // welcome message
    expect(s.copilotMessages[0].role).toBe('system')
  })

  it('setField updates a single field', () => {
    useTaskWorkbenchStore.getState().setField('title', 'Fix auth bug')
    expect(useTaskWorkbenchStore.getState().title).toBe('Fix auth bug')
  })

  it('setField updates repo', () => {
    useTaskWorkbenchStore.getState().setField('repo', 'life-os')
    expect(useTaskWorkbenchStore.getState().repo).toBe('life-os')
  })

  it('resetForm restores defaults', () => {
    const store = useTaskWorkbenchStore.getState()
    store.setField('title', 'Something')
    store.setField('spec', 'Some spec')
    store.resetForm()
    const s = useTaskWorkbenchStore.getState()
    expect(s.title).toBe('')
    expect(s.spec).toBe('')
    expect(s.mode).toBe('create')
  })

  it('loadTask populates form from SprintTask', () => {
    useTaskWorkbenchStore.getState().loadTask({
      id: 'task-123',
      title: 'Existing task',
      repo: 'life-os',
      priority: 2,
      spec: '## Problem\nSomething',
      prompt: null,
      notes: null,
      status: 'backlog',
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
      updated_at: '2026-01-01',
      created_at: '2026-01-01'
    })
    const s = useTaskWorkbenchStore.getState()
    expect(s.mode).toBe('edit')
    expect(s.taskId).toBe('task-123')
    expect(s.title).toBe('Existing task')
    expect(s.repo).toBe('life-os')
    expect(s.priority).toBe(2)
    expect(s.spec).toBe('## Problem\nSomething')
  })

  it('toggleCopilot flips visibility', () => {
    expect(useTaskWorkbenchStore.getState().copilotVisible).toBe(true)
    useTaskWorkbenchStore.getState().toggleCopilot()
    expect(useTaskWorkbenchStore.getState().copilotVisible).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/stores/__tests__/taskWorkbench.test.ts`
Expected: FAIL — module `../taskWorkbench` not found

- [ ] **Step 3: Implement the store**

```typescript
// src/renderer/src/stores/taskWorkbench.ts
import { create } from 'zustand'
import type { SprintTask } from '../../../shared/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  insertable?: boolean
}

export interface CheckResult {
  id: string
  label: string
  tier: 1 | 2 | 3
  status: 'pass' | 'warn' | 'fail' | 'pending'
  message: string
}

interface TaskWorkbenchState {
  // --- Form ---
  mode: 'create' | 'edit'
  taskId: string | null
  title: string
  repo: string
  priority: number
  spec: string
  taskTemplateName: string
  advancedOpen: boolean

  // --- Copilot ---
  copilotVisible: boolean
  copilotMessages: CopilotMessage[]
  copilotLoading: boolean

  // --- Readiness ---
  checksExpanded: boolean
  structuralChecks: CheckResult[]
  semanticChecks: CheckResult[]
  operationalChecks: CheckResult[]
  semanticLoading: boolean
  operationalLoading: boolean

  // --- Actions ---
  setField: (field: string, value: unknown) => void
  resetForm: () => void
  loadTask: (task: SprintTask) => void
  toggleCopilot: () => void
  toggleChecksExpanded: () => void
  setStructuralChecks: (checks: CheckResult[]) => void
  setSemanticChecks: (checks: CheckResult[]) => void
  setOperationalChecks: (checks: CheckResult[]) => void
  addCopilotMessage: (msg: CopilotMessage) => void
  setCopilotLoading: (loading: boolean) => void
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const WELCOME_MESSAGE: CopilotMessage = {
  id: 'welcome',
  role: 'system',
  content:
    'I can help you craft this task. Try asking me to research the codebase, brainstorm approaches, or review your spec.',
  timestamp: Date.now()
}

function defaults(): Pick<
  TaskWorkbenchState,
  | 'mode'
  | 'taskId'
  | 'title'
  | 'repo'
  | 'priority'
  | 'spec'
  | 'taskTemplateName'
  | 'advancedOpen'
  | 'copilotVisible'
  | 'copilotMessages'
  | 'copilotLoading'
  | 'checksExpanded'
  | 'structuralChecks'
  | 'semanticChecks'
  | 'operationalChecks'
  | 'semanticLoading'
  | 'operationalLoading'
> {
  return {
    mode: 'create',
    taskId: null,
    title: '',
    repo: 'BDE',
    priority: 3,
    spec: '',
    taskTemplateName: '',
    advancedOpen: false,
    copilotVisible: true,
    copilotMessages: [{ ...WELCOME_MESSAGE, timestamp: Date.now() }],
    copilotLoading: false,
    checksExpanded: false,
    structuralChecks: [],
    semanticChecks: [],
    operationalChecks: [],
    semanticLoading: false,
    operationalLoading: false
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTaskWorkbenchStore = create<TaskWorkbenchState>((set) => ({
  ...defaults(),

  setField: (field, value) => set({ [field]: value } as Partial<TaskWorkbenchState>),

  resetForm: () => set(defaults()),

  loadTask: (task) =>
    set({
      mode: 'edit',
      taskId: task.id,
      title: task.title,
      repo: task.repo,
      priority: task.priority,
      spec: task.spec ?? '',
      taskTemplateName: task.template_name ?? '',
      copilotMessages: [{ ...WELCOME_MESSAGE, timestamp: Date.now() }],
      semanticChecks: [],
      operationalChecks: []
    }),

  toggleCopilot: () => set((s) => ({ copilotVisible: !s.copilotVisible })),
  toggleChecksExpanded: () => set((s) => ({ checksExpanded: !s.checksExpanded })),

  setStructuralChecks: (checks) => set({ structuralChecks: checks }),
  setSemanticChecks: (checks) => set({ semanticChecks: checks, semanticLoading: false }),
  setOperationalChecks: (checks) => set({ operationalChecks: checks, operationalLoading: false }),

  addCopilotMessage: (msg) => set((s) => ({ copilotMessages: [...s.copilotMessages, msg] })),

  setCopilotLoading: (loading) => set({ copilotLoading: loading })
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/stores/__tests__/taskWorkbench.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/taskWorkbench.ts src/renderer/src/stores/__tests__/taskWorkbench.test.ts
git commit -m "feat(workbench): add taskWorkbench Zustand store with form, copilot, and check state"
```

---

## Task 2: Readiness Checks Hook — `useReadinessChecks.ts`

**Files:**

- Create: `src/renderer/src/hooks/useReadinessChecks.ts`
- Create: `src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts`
- Reference: `src/renderer/src/stores/taskWorkbench.ts` (for `CheckResult` type)

- [ ] **Step 1: Write the failing tests for Tier 1 structural checks**

```typescript
// src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts
import { describe, it, expect } from 'vitest'
import { computeStructuralChecks } from '../useReadinessChecks'

describe('computeStructuralChecks', () => {
  it('fails when title is empty', () => {
    const checks = computeStructuralChecks({ title: '', repo: 'BDE', spec: '' })
    const titleCheck = checks.find((c) => c.id === 'title-present')
    expect(titleCheck?.status).toBe('fail')
  })

  it('passes when title is non-empty', () => {
    const checks = computeStructuralChecks({ title: 'Fix bug', repo: 'BDE', spec: '' })
    const titleCheck = checks.find((c) => c.id === 'title-present')
    expect(titleCheck?.status).toBe('pass')
  })

  it('fails when spec is empty', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: '' })
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('fail')
  })

  it('warns when spec is very short (1-50 chars)', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: 'Short spec here' })
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('warn')
  })

  it('passes when spec is >50 chars', () => {
    const longSpec = 'A'.repeat(51)
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: longSpec })
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('pass')
  })

  it('warns when spec has 1 heading', () => {
    const spec = '## Problem\nSome description that is long enough to pass the length check yes'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const specStructure = checks.find((c) => c.id === 'spec-structure')
    expect(specStructure?.status).toBe('warn')
  })

  it('passes when spec has 2+ headings', () => {
    const spec = '## Problem\nDescription\n## Solution\nMore text that is long enough'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const specStructure = checks.find((c) => c.id === 'spec-structure')
    expect(specStructure?.status).toBe('pass')
  })

  it('fails when spec has no headings', () => {
    const spec = 'Just a wall of text without any markdown headings at all and its pretty long'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const specStructure = checks.find((c) => c.id === 'spec-structure')
    expect(specStructure?.status).toBe('fail')
  })

  it('always passes repo check when repo is set', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: '' })
    const repoCheck = checks.find((c) => c.id === 'repo-selected')
    expect(repoCheck?.status).toBe('pass')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts`
Expected: FAIL — cannot resolve `../useReadinessChecks`

- [ ] **Step 3: Implement the hook**

```typescript
// src/renderer/src/hooks/useReadinessChecks.ts
import { useEffect } from 'react'
import { useTaskWorkbenchStore, type CheckResult } from '../stores/taskWorkbench'

// ---------------------------------------------------------------------------
// Tier 1: Structural checks (pure, synchronous, runs on every form change)
// ---------------------------------------------------------------------------

interface FormSnapshot {
  title: string
  repo: string
  spec: string
}

export function computeStructuralChecks(form: FormSnapshot): CheckResult[] {
  const checks: CheckResult[] = []

  // Title present
  checks.push({
    id: 'title-present',
    label: 'Title',
    tier: 1,
    status: form.title.trim() ? 'pass' : 'fail',
    message: form.title.trim() ? 'Title provided' : 'Title is required'
  })

  // Repo selected
  checks.push({
    id: 'repo-selected',
    label: 'Repo',
    tier: 1,
    status: form.repo ? 'pass' : 'fail',
    message: form.repo ? `Repo: ${form.repo}` : 'No repo selected'
  })

  // Spec present
  const specLen = form.spec.trim().length
  let specStatus: 'pass' | 'warn' | 'fail'
  let specMsg: string
  if (specLen === 0) {
    specStatus = 'fail'
    specMsg = 'Spec is empty'
  } else if (specLen <= 50) {
    specStatus = 'warn'
    specMsg = 'Spec is very short — consider adding more detail'
  } else {
    specStatus = 'pass'
    specMsg = `Spec: ${specLen} characters`
  }
  checks.push({ id: 'spec-present', label: 'Spec', tier: 1, status: specStatus, message: specMsg })

  // Spec has structure (markdown headings)
  const headingCount = (form.spec.match(/^## /gm) ?? []).length
  let structureStatus: 'pass' | 'warn' | 'fail'
  let structureMsg: string
  if (headingCount >= 2) {
    structureStatus = 'pass'
    structureMsg = `${headingCount} sections`
  } else if (headingCount === 1) {
    structureStatus = 'warn'
    structureMsg = 'Only 1 section — consider adding Problem/Solution/Files structure'
  } else {
    structureStatus = 'fail'
    structureMsg = 'No sections — use ## headings to structure the spec'
  }
  checks.push({
    id: 'spec-structure',
    label: 'Structure',
    tier: 1,
    status: structureStatus,
    message: structureMsg
  })

  return checks
}

// ---------------------------------------------------------------------------
// React hook — wires structural checks to store on every form change
// ---------------------------------------------------------------------------

export function useReadinessChecks(): void {
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const setStructuralChecks = useTaskWorkbenchStore((s) => s.setStructuralChecks)

  useEffect(() => {
    const checks = computeStructuralChecks({ title, repo, spec })
    setStructuralChecks(checks)
  }, [title, repo, spec, setStructuralChecks])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useReadinessChecks.ts src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts
git commit -m "feat(workbench): add Tier 1 structural readiness checks hook"
```

---

## Task 3: Register the View — Panel System Integration

**Files:**

- Modify: `src/renderer/src/stores/panelLayout.ts:7,35-43`
- Modify: `src/renderer/src/components/panels/PanelLeaf.tsx:14-18,24-41`
- Modify: `src/renderer/src/App.tsx:22-30,32-40`
- Create: `src/renderer/src/views/TaskWorkbenchView.tsx`

- [ ] **Step 1: Add `'task-workbench'` to the `View` type**

In `src/renderer/src/stores/panelLayout.ts` line 7, change:

```typescript
export type View = 'agents' | 'terminal' | 'sprint' | 'pr-station' | 'memory' | 'cost' | 'settings'
```

to:

```typescript
export type View =
  | 'agents'
  | 'terminal'
  | 'sprint'
  | 'pr-station'
  | 'memory'
  | 'cost'
  | 'settings'
  | 'task-workbench'
```

Add to `VIEW_LABELS` (line 35-43):

```typescript
'task-workbench': 'Task Workbench',
```

- [ ] **Step 2: Create the view wrapper**

```typescript
// src/renderer/src/views/TaskWorkbenchView.tsx
import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { TaskWorkbench } from '../components/task-workbench/TaskWorkbench'

export default function TaskWorkbenchView() {
  const reduced = useReducedMotion()
  return (
    <motion.div
      style={{ height: '100%' }}
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      <TaskWorkbench />
    </motion.div>
  )
}
```

Note: `TaskWorkbench` component doesn't exist yet — create a placeholder:

```typescript
// src/renderer/src/components/task-workbench/TaskWorkbench.tsx
export function TaskWorkbench() {
  return <div style={{ padding: 24 }}>Task Workbench — coming soon</div>
}
```

- [ ] **Step 3: Add lazy import and case in `PanelLeaf.tsx`**

Add after line 18 (`const PRStationView = ...`):

```typescript
const TaskWorkbenchView = React.lazy(() => import('../../views/TaskWorkbenchView'))
```

Add case inside `resolveView()` switch, after `case 'pr-station':`:

```typescript
    case 'task-workbench':
      return <TaskWorkbenchView />
```

- [ ] **Step 4: Add to `App.tsx` VIEW_ORDER and VIEW_TITLES**

In `VIEW_ORDER` array (line 22-30), add `'task-workbench'` (this gives it `Cmd+8`):

```typescript
const VIEW_ORDER: View[] = [
  'agents',
  'terminal',
  'sprint',
  'pr-station',
  'memory',
  'cost',
  'settings',
  'task-workbench'
]
```

In `VIEW_TITLES` (line 32-40), add:

```typescript
  'task-workbench': 'Task Workbench'
```

Update the keyboard shortcut hint in `SHORTCUTS_LEFT` from `'⌘1–7'` to `'⌘1–8'` if present.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/panelLayout.ts src/renderer/src/views/TaskWorkbenchView.tsx src/renderer/src/components/task-workbench/TaskWorkbench.tsx src/renderer/src/components/panels/PanelLeaf.tsx src/renderer/src/App.tsx
git commit -m "feat(workbench): register task-workbench as panel view with placeholder"
```

---

## Task 4: Wire Entry Points — Replace Modal with Panel Open

**Files:**

- Modify: `src/renderer/src/components/sprint/SprintToolbar.tsx`
- Modify: `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts`
- Reference: `src/renderer/src/stores/panelLayout.ts` (for `usePanelLayoutStore`)
- Reference: `src/renderer/src/stores/ui.ts` (for `useUIStore`)

- [ ] **Step 1: Update SprintToolbar to open workbench panel**

In `src/renderer/src/components/sprint/SprintToolbar.tsx`:

Replace the modal state and `NewTicketModal` rendering. The `+ New Ticket` button should open the workbench view in a new panel (or focus it if already open). Use `useUIStore`'s `setView('task-workbench')`.

Remove:

```typescript
import { NewTicketModal } from './NewTicketModal'
```

```typescript
const createTask = useSprintTasks((s) => s.createTask)
const [modalOpen, setModalOpen] = useState(false)
```

```typescript
<NewTicketModal open={modalOpen} onClose={() => setModalOpen(false)} onCreate={createTask} />
```

Add:

```typescript
import { useUIStore } from '../../stores/ui'
```

```typescript
const setView = useUIStore((s) => s.setView)
const openWorkbench = useCallback(() => setView('task-workbench'), [setView])
```

Change the button:

```typescript
<Button variant="primary" size="sm" onClick={openWorkbench}>
  + New Task
</Button>
```

Remove `useState` import if no longer used (keep `type Dispatch, type SetStateAction` if `useSprintKeyboardShortcuts` still needs `setModalOpen` signature). Update the keyboard shortcuts hook call — instead of passing `setModalOpen`, pass a function that opens the workbench.

- [ ] **Step 2: Update keyboard shortcuts hook**

In `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts`, change the interface to accept an `openWorkbench` callback instead of `setModalOpen`:

```typescript
interface UseSprintKeyboardShortcutsArgs {
  openWorkbench: () => void
  setConflictDrawerOpen: Dispatch<SetStateAction<boolean>>
}

export function useSprintKeyboardShortcuts({
  openWorkbench,
  setConflictDrawerOpen
}: UseSprintKeyboardShortcutsArgs): void {
  const selectedTaskId = useSprintUI((s) => s.selectedTaskId)
  const setLogDrawerTaskId = useSprintUI((s) => s.setLogDrawerTaskId)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedTaskId) return
        setLogDrawerTaskId(null)
        setConflictDrawerOpen(false)
        return
      }

      if (
        e.key === 'n' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT' &&
        !(document.activeElement as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault()
        openWorkbench()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskId, setLogDrawerTaskId, openWorkbench, setConflictDrawerOpen])
}
```

Update the call site in `SprintToolbar.tsx`:

```typescript
useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen })
```

- [ ] **Step 3: Clean up SprintCenter.tsx**

`SprintCenter.tsx` also renders `<NewTicketModal>` with its own `modalOpen` state. Remove this dead code since the modal is no longer the entry point.

In `src/renderer/src/components/sprint/SprintCenter.tsx`:

- Remove the `NewTicketModal` import
- Remove any `modalOpen` state and the `<NewTicketModal>` JSX
- Keep the rest of SprintCenter intact (KanbanBoard, SpecDrawer, etc.)

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/sprint/SprintToolbar.tsx src/renderer/src/components/sprint/SprintCenter.tsx src/renderer/src/hooks/useSprintKeyboardShortcuts.ts
git commit -m "feat(workbench): wire N key and + New Task button to open workbench panel"
```

---

## Task 5: WorkbenchForm + SpecEditor + ReadinessChecks + WorkbenchActions UI

This is the main form panel. Build all four components together since they're tightly coupled.

**Files:**

- Create: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`
- Create: `src/renderer/src/components/task-workbench/SpecEditor.tsx`
- Create: `src/renderer/src/components/task-workbench/ReadinessChecks.tsx`
- Create: `src/renderer/src/components/task-workbench/WorkbenchActions.tsx`
- Reference: `src/renderer/src/stores/taskWorkbench.ts`
- Reference: `src/renderer/src/hooks/useReadinessChecks.ts`
- Reference: `src/renderer/src/lib/constants.ts` (for `REPO_OPTIONS`)
- Reference: `src/renderer/src/design-system/tokens.ts`
- Reference: `src/renderer/src/components/sprint/NewTicketModal.tsx` (for `PRIORITY_OPTIONS`, `TEMPLATES`)

- [ ] **Step 1: Create ReadinessChecks component**

```typescript
// src/renderer/src/components/task-workbench/ReadinessChecks.tsx
import { useTaskWorkbenchStore, type CheckResult } from '../../stores/taskWorkbench'
import { tokens } from '../../design-system/tokens'

const STATUS_ICONS: Record<CheckResult['status'], string> = {
  pass: '\u2705',
  warn: '\u26a0\ufe0f',
  fail: '\u274c',
  pending: '\u23f3',
}

export function ReadinessChecks() {
  const structural = useTaskWorkbenchStore((s) => s.structuralChecks)
  const semantic = useTaskWorkbenchStore((s) => s.semanticChecks)
  const operational = useTaskWorkbenchStore((s) => s.operationalChecks)
  const expanded = useTaskWorkbenchStore((s) => s.checksExpanded)
  const toggleExpanded = useTaskWorkbenchStore((s) => s.toggleChecksExpanded)

  const allChecks = [...structural, ...semantic, ...operational]
  const passing = allChecks.filter((c) => c.status === 'pass').length
  const total = allChecks.length
  const hasFailures = allChecks.some((c) => c.status === 'fail')

  if (total === 0) return null

  return (
    <div style={{
      border: `1px solid ${hasFailures ? tokens.color.danger : tokens.color.border}`,
      borderRadius: tokens.radius.lg,
      padding: tokens.space[3],
      background: tokens.color.surface,
    }}>
      <button
        onClick={toggleExpanded}
        style={{
          background: 'none',
          border: 'none',
          color: tokens.color.text,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          width: '100%',
          fontSize: tokens.size.sm,
          padding: 0,
        }}
      >
        <span>{expanded ? '\u25be' : '\u25b8'}</span>
        <span style={{ display: 'flex', gap: tokens.space[1] }}>
          {allChecks.map((c) => (
            <span key={c.id} title={c.label}>{STATUS_ICONS[c.status]}</span>
          ))}
        </span>
        <span style={{ color: tokens.color.textMuted, marginLeft: 'auto' }}>
          {passing}/{total} passing
        </span>
      </button>
      {expanded && (
        <div style={{ marginTop: tokens.space[2], display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
          {allChecks.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: tokens.space[2], fontSize: tokens.size.sm }}>
              <span>{STATUS_ICONS[c.status]}</span>
              <span style={{ color: tokens.color.text, fontWeight: 500, minWidth: 80 }}>{c.label}</span>
              <span style={{ color: tokens.color.textMuted }}>{c.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create SpecEditor component**

```typescript
// src/renderer/src/components/task-workbench/SpecEditor.tsx
import { useCallback } from 'react'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { tokens } from '../../design-system/tokens'

const SPEC_TEMPLATES: Record<string, { label: string; spec: string }> = {
  feature: {
    label: 'Feature',
    spec: '## Problem\n\n## Solution\n\n## Files to Change\n\n## Out of Scope\n',
  },
  bugfix: {
    label: 'Bug Fix',
    spec: '## Bug Description\n\n## Root Cause\n\n## Fix\n\n## Files to Change\n\n## How to Test\n',
  },
  refactor: {
    label: 'Refactor',
    spec: "## What's Being Refactored\n\n## Target State\n\n## Files to Change\n\n## Out of Scope\n",
  },
  test: {
    label: 'Test',
    spec: '## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n',
  },
}

interface SpecEditorProps {
  onRequestGenerate: () => void
  onRequestResearch: () => void
  generating: boolean
}

export function SpecEditor({ onRequestGenerate, onRequestResearch, generating }: SpecEditorProps) {
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const setField = useTaskWorkbenchStore((s) => s.setField)

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const target = e.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      const newValue = spec.substring(0, start) + '  ' + spec.substring(end)
      setField('spec', newValue)
      // Restore cursor position after React re-renders
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2
      })
    }
  }, [spec, setField])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[2] }}>
      <div style={{ display: 'flex', gap: tokens.space[2], flexWrap: 'wrap' }}>
        <button
          onClick={onRequestGenerate}
          disabled={generating}
          style={{
            background: tokens.color.accentDim,
            border: `1px solid ${tokens.color.accent}`,
            borderRadius: tokens.radius.md,
            color: tokens.color.accent,
            padding: `${tokens.space[1]} ${tokens.space[3]}`,
            fontSize: tokens.size.sm,
            cursor: generating ? 'wait' : 'pointer',
          }}
        >
          {generating ? 'Generating...' : 'Generate Spec'}
        </button>
        {Object.entries(SPEC_TEMPLATES).map(([key, tmpl]) => (
          <button
            key={key}
            onClick={() => setField('spec', tmpl.spec)}
            style={{
              background: 'none',
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.md,
              color: tokens.color.textMuted,
              padding: `${tokens.space[1]} ${tokens.space[3]}`,
              fontSize: tokens.size.sm,
              cursor: 'pointer',
            }}
          >
            {tmpl.label}
          </button>
        ))}
        <button
          onClick={onRequestResearch}
          style={{
            background: 'none',
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.md,
            color: tokens.color.textMuted,
            padding: `${tokens.space[1]} ${tokens.space[3]}`,
            fontSize: tokens.size.sm,
            cursor: 'pointer',
            marginLeft: 'auto',
          }}
        >
          Research Codebase
        </button>
      </div>
      <textarea
        value={spec}
        onChange={(e) => setField('spec', e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what the agent should do. The more specific, the better the results."
        style={{
          minHeight: 200,
          maxHeight: '60vh',
          resize: 'vertical',
          padding: tokens.space[3],
          background: tokens.color.surface,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.lg,
          color: tokens.color.text,
          fontSize: tokens.size.md,
          fontFamily: tokens.font.code,
          lineHeight: 1.6,
          outline: 'none',
        }}
      />
    </div>
  )
}
```

- [ ] **Step 3: Create WorkbenchActions component**

```typescript
// src/renderer/src/components/task-workbench/WorkbenchActions.tsx
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { tokens } from '../../design-system/tokens'

interface WorkbenchActionsProps {
  onSaveBacklog: () => void
  onQueueNow: () => void
  submitting: boolean
}

export function WorkbenchActions({ onSaveBacklog, onQueueNow, submitting }: WorkbenchActionsProps) {
  const structural = useTaskWorkbenchStore((s) => s.structuralChecks)
  const operational = useTaskWorkbenchStore((s) => s.operationalChecks)

  const titlePasses = structural.some((c) => c.id === 'title-present' && c.status === 'pass')
  const allTier1Pass = structural.every((c) => c.status === 'pass')
  const tier3HasFails = operational.some((c) => c.status === 'fail')

  const canSave = titlePasses
  const canQueue = allTier1Pass && !tier3HasFails

  return (
    <div style={{ display: 'flex', gap: tokens.space[2], justifyContent: 'flex-end' }}>
      <button
        onClick={onSaveBacklog}
        disabled={!canSave || submitting}
        style={{
          background: 'none',
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md,
          color: canSave ? tokens.color.text : tokens.color.textDim,
          padding: `${tokens.space[2]} ${tokens.space[4]}`,
          fontSize: tokens.size.md,
          cursor: canSave && !submitting ? 'pointer' : 'not-allowed',
        }}
      >
        Save to Backlog
      </button>
      <button
        onClick={onQueueNow}
        disabled={!canQueue || submitting}
        style={{
          background: canQueue ? tokens.color.accent : tokens.color.surfaceHigh,
          border: 'none',
          borderRadius: tokens.radius.md,
          color: canQueue ? '#000' : tokens.color.textDim,
          padding: `${tokens.space[2]} ${tokens.space[4]}`,
          fontSize: tokens.size.md,
          fontWeight: 600,
          cursor: canQueue && !submitting ? 'pointer' : 'not-allowed',
        }}
      >
        {submitting ? 'Creating...' : 'Queue Now'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Create WorkbenchForm component**

```typescript
// src/renderer/src/components/task-workbench/WorkbenchForm.tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { useSprintTasks, type CreateTicketInput } from '../../stores/sprintTasks'
import { useReadinessChecks } from '../../hooks/useReadinessChecks'
import { SpecEditor } from './SpecEditor'
import { ReadinessChecks } from './ReadinessChecks'
import { WorkbenchActions } from './WorkbenchActions'
import { REPO_OPTIONS } from '../../lib/constants'
import { tokens } from '../../design-system/tokens'

const PRIORITY_OPTIONS = [
  { label: 'P1 Critical', value: 1 },
  { label: 'P2 High', value: 2 },
  { label: 'P3 Medium', value: 3 },
  { label: 'P4 Low', value: 4 },
  { label: 'P5 Backlog', value: 5 },
] as const

interface WorkbenchFormProps {
  onSendCopilotMessage: (message: string) => void
}

export function WorkbenchForm({ onSendCopilotMessage }: WorkbenchFormProps) {
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const priority = useTaskWorkbenchStore((s) => s.priority)
  const advancedOpen = useTaskWorkbenchStore((s) => s.advancedOpen)
  const mode = useTaskWorkbenchStore((s) => s.mode)
  const taskId = useTaskWorkbenchStore((s) => s.taskId)
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const setField = useTaskWorkbenchStore((s) => s.setField)
  const resetForm = useTaskWorkbenchStore((s) => s.resetForm)

  const createTask = useSprintTasks((s) => s.createTask)
  const updateTask = useSprintTasks((s) => s.updateTask)

  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  // Run structural checks on every form change
  useReadinessChecks()

  // Auto-focus title on mount
  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = useCallback(async (action: 'backlog' | 'queue') => {
    setSubmitting(true)
    try {
      if (mode === 'edit' && taskId) {
        await updateTask(taskId, {
          title,
          repo,
          priority,
          spec,
          status: action === 'queue' ? 'queued' : 'backlog',
        })
      } else {
        const input: CreateTicketInput = {
          title,
          repo,
          prompt: title,
          spec,
          priority,
        }
        await createTask(input)
        // createTask hardcodes status=backlog. If queuing, find the task and update status.
        if (action === 'queue') {
          const tasks = useSprintTasks.getState().tasks
          const created = tasks.find((t) => t.title === title && t.status === 'backlog')
          if (created) await updateTask(created.id, { status: 'queued' })
        }
      }
      resetForm()
    } finally {
      setSubmitting(false)
    }
  }, [mode, taskId, title, repo, priority, spec, createTask, updateTask, resetForm])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    try {
      const result = await window.api.workbench.generateSpec({
        title,
        repo,
        templateHint: 'feature',
      })
      if (result.spec) {
        setField('spec', result.spec)
      }
    } finally {
      setGenerating(false)
    }
  }, [title, repo, setField])

  const handleResearch = useCallback(() => {
    if (!title.trim()) return
    onSendCopilotMessage(`Research the ${repo} codebase for: ${title}`)
  }, [title, repo, onSendCopilotMessage])

  const inputStyle = {
    padding: tokens.space[2],
    background: tokens.color.surface,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.md,
    color: tokens.color.text,
    fontSize: tokens.size.md,
    outline: 'none',
    width: '100%',
  }

  const labelStyle = {
    fontSize: tokens.size.sm,
    fontWeight: 600 as const,
    color: tokens.color.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: tokens.space[4],
      padding: tokens.space[4],
      overflowY: 'auto',
      height: '100%',
    }}>
      {/* Header */}
      <div style={{ fontSize: tokens.size.xl, fontWeight: 600, color: tokens.color.text }}>
        {mode === 'edit' ? `Edit: ${title || 'Untitled'}` : 'New Task'}
      </div>

      {/* Core Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[3] }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
          <label style={labelStyle}>Title *</label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder='e.g. "Add recipe search to Feast onboarding"'
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
          <label style={labelStyle}>Repo</label>
          <select
            value={repo}
            onChange={(e) => setField('repo', e.target.value)}
            style={inputStyle}
          >
            {REPO_OPTIONS.map((r) => (
              <option key={r.label} value={r.label}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Advanced Fields */}
      <div>
        <button
          onClick={() => setField('advancedOpen', !advancedOpen)}
          style={{
            background: 'none',
            border: 'none',
            color: tokens.color.textMuted,
            fontSize: tokens.size.sm,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {advancedOpen ? '\u25be' : '\u25b8'} More options
        </button>
        {advancedOpen && (
          <div style={{ marginTop: tokens.space[2], display: 'flex', gap: tokens.space[3] }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1], flex: 1 }}>
              <label style={labelStyle}>Priority</label>
              <select
                value={priority}
                onChange={(e) => setField('priority', Number(e.target.value))}
                style={inputStyle}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Spec Editor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
        <label style={labelStyle}>Spec</label>
        <SpecEditor
          onRequestGenerate={handleGenerate}
          onRequestResearch={handleResearch}
          generating={generating}
        />
      </div>

      {/* Readiness Checks */}
      <ReadinessChecks />

      {/* Actions */}
      <WorkbenchActions
        onSaveBacklog={() => handleSubmit('backlog')}
        onQueueNow={() => handleSubmit('queue')}
        submitting={submitting}
      />
    </div>
  )
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/task-workbench/WorkbenchForm.tsx src/renderer/src/components/task-workbench/SpecEditor.tsx src/renderer/src/components/task-workbench/ReadinessChecks.tsx src/renderer/src/components/task-workbench/WorkbenchActions.tsx
git commit -m "feat(workbench): add WorkbenchForm, SpecEditor, ReadinessChecks, and WorkbenchActions components"
```

---

## Task 6: WorkbenchCopilot UI

**Files:**

- Create: `src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx`
- Reference: `src/renderer/src/stores/taskWorkbench.ts`
- Reference: `src/renderer/src/design-system/tokens.ts`

- [ ] **Step 1: Create the Copilot sidebar component**

```typescript
// src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { useTaskWorkbenchStore, type CopilotMessage } from '../../stores/taskWorkbench'
import { tokens } from '../../design-system/tokens'

interface WorkbenchCopilotProps {
  onClose: () => void
}

export function WorkbenchCopilot({ onClose }: WorkbenchCopilotProps) {
  const messages = useTaskWorkbenchStore((s) => s.copilotMessages)
  const loading = useTaskWorkbenchStore((s) => s.copilotLoading)
  const addMessage = useTaskWorkbenchStore((s) => s.addCopilotMessage)
  const setCopilotLoading = useTaskWorkbenchStore((s) => s.setCopilotLoading)
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const setField = useTaskWorkbenchStore((s) => s.setField)

  const [input, setInput] = useState('')
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return

    const userMsg: CopilotMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    if (!overrideText) setInput('')
    setCopilotLoading(true)

    try {
      const result = await window.api.workbench.chat({
        messages: [...messages.filter((m) => m.role !== 'system'), userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        })),
        formContext: { title, repo, spec },
      })

      addMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        insertable: true,
      })
    } catch {
      addMessage({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Failed to reach Claude. Check your connection and try again.',
        timestamp: Date.now(),
      })
    } finally {
      setCopilotLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, messages, title, repo, spec, addMessage, setCopilotLoading])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }, [sendMessage])

  const insertIntoSpec = useCallback((content: string) => {
    const current = spec
    const appended = current ? `${current}\n\n${content}` : content
    setField('spec', appended)
  }, [spec, setField])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      borderLeft: `1px solid ${tokens.color.border}`,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${tokens.space[3]} ${tokens.space[4]}`,
        borderBottom: `1px solid ${tokens.color.border}`,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: tokens.size.sm,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: tokens.color.textMuted,
        }}>
          AI Copilot
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: tokens.color.textMuted,
            cursor: 'pointer',
            fontSize: tokens.size.lg,
          }}
        >
          \u00d7
        </button>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: tokens.space[4],
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[3],
      }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space[1],
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            {msg.role !== 'user' && (
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: tokens.color.textDim,
              }}>
                {msg.role === 'system' ? 'System' : 'Claude'}
              </span>
            )}
            <div style={{
              padding: `${tokens.space[2]} ${tokens.space[3]}`,
              borderRadius: tokens.radius.xl,
              fontSize: tokens.size.md,
              lineHeight: 1.5,
              maxWidth: '90%',
              whiteSpace: 'pre-wrap',
              background: msg.role === 'user'
                ? tokens.color.accentDim
                : `rgba(255, 255, 255, 0.04)`,
              border: `1px solid ${msg.role === 'user' ? tokens.color.accent : tokens.color.border}`,
              color: tokens.color.text,
            }}>
              {msg.content}
            </div>
            {msg.insertable && (
              <button
                onClick={() => insertIntoSpec(msg.content)}
                style={{
                  background: 'none',
                  border: `1px solid ${tokens.color.border}`,
                  borderRadius: tokens.radius.sm,
                  color: tokens.color.accent,
                  fontSize: tokens.size.xs,
                  padding: `${tokens.space[1]} ${tokens.space[2]}`,
                  cursor: 'pointer',
                }}
              >
                Insert into spec \u2192
              </button>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ color: tokens.color.textDim, fontSize: tokens.size.sm }}>
            Thinking...
          </div>
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* Input */}
      <div style={{
        display: 'flex',
        gap: tokens.space[2],
        padding: tokens.space[3],
        borderTop: `1px solid ${tokens.color.border}`,
        alignItems: 'flex-end',
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything... (Enter to send)"
          rows={2}
          disabled={loading}
          style={{
            flex: 1,
            padding: tokens.space[2],
            background: tokens.color.surface,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.lg,
            color: tokens.color.text,
            fontSize: tokens.size.md,
            lineHeight: 1.4,
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          style={{
            padding: `${tokens.space[2]} ${tokens.space[3]}`,
            background: tokens.color.accent,
            border: 'none',
            borderRadius: tokens.radius.lg,
            color: '#000',
            fontSize: tokens.size.lg,
            cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
            flexShrink: 0,
            opacity: input.trim() && !loading ? 1 : 0.4,
          }}
        >
          \u2191
        </button>
      </div>
    </div>
  )
}

// Export sendMessage trigger for external use (e.g. Research button in form)
// This is handled by the parent TaskWorkbench passing a callback.
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx
git commit -m "feat(workbench): add AI Copilot sidebar component"
```

---

## Task 7: TaskWorkbench Main Layout — Wire It All Together

**Files:**

- Modify: `src/renderer/src/components/task-workbench/TaskWorkbench.tsx` (replace placeholder)
- Reference: All task-workbench components created in Tasks 5-6

- [ ] **Step 1: Replace the placeholder with the real layout**

```typescript
// src/renderer/src/components/task-workbench/TaskWorkbench.tsx
import { useCallback, useRef } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { WorkbenchForm } from './WorkbenchForm'
import { WorkbenchCopilot } from './WorkbenchCopilot'
import { tokens } from '../../design-system/tokens'

export function TaskWorkbench() {
  const copilotVisible = useTaskWorkbenchStore((s) => s.copilotVisible)
  const toggleCopilot = useTaskWorkbenchStore((s) => s.toggleCopilot)
  const addMessage = useTaskWorkbenchStore((s) => s.addCopilotMessage)
  const setCopilotLoading = useTaskWorkbenchStore((s) => s.setCopilotLoading)
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const spec = useTaskWorkbenchStore((s) => s.spec)

  // Ref to imperatively trigger a copilot message from the form
  const sendCopilotMessageRef = useRef<(text: string) => void>()

  const handleSendFromForm = useCallback(async (text: string) => {
    // If copilot is hidden, show it
    if (!useTaskWorkbenchStore.getState().copilotVisible) {
      toggleCopilot()
    }

    // Add user message
    const userMsg = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content: text,
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setCopilotLoading(true)

    try {
      const result = await window.api.workbench.chat({
        messages: [{ role: 'user', content: text }],
        formContext: { title, repo, spec },
      })
      addMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        insertable: true,
      })
    } catch {
      addMessage({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Failed to reach Claude. Check your connection and try again.',
        timestamp: Date.now(),
      })
    } finally {
      setCopilotLoading(false)
    }
  }, [title, repo, spec, toggleCopilot, addMessage, setCopilotLoading])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toggle copilot button when hidden */}
      {!copilotVisible && (
        <div style={{
          position: 'absolute',
          top: tokens.space[3],
          right: tokens.space[3],
          zIndex: 10,
        }}>
          <button
            onClick={toggleCopilot}
            style={{
              background: tokens.color.accentDim,
              border: `1px solid ${tokens.color.accent}`,
              borderRadius: tokens.radius.md,
              color: tokens.color.accent,
              padding: `${tokens.space[1]} ${tokens.space[3]}`,
              fontSize: tokens.size.sm,
              cursor: 'pointer',
            }}
          >
            AI Copilot
          </button>
        </div>
      )}

      <Group direction="horizontal" style={{ flex: 1, position: 'relative' }}>
        <Panel defaultSize={copilotVisible ? 65 : 100} minSize={40}>
          <WorkbenchForm onSendCopilotMessage={handleSendFromForm} />
        </Panel>

        {copilotVisible && (
          <>
            <Separator
              style={{
                width: 1,
                background: tokens.color.border,
                cursor: 'col-resize',
              }}
            />
            <Panel defaultSize={35} minSize={20}>
              <WorkbenchCopilot onClose={toggleCopilot} />
            </Panel>
          </>
        )}
      </Group>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/task-workbench/TaskWorkbench.tsx
git commit -m "feat(workbench): wire TaskWorkbench layout with resizable form + copilot split"
```

---

## Task 8: Implement AI Handlers — Replace Stubs with Claude CLI

**Files:**

- Modify: `src/main/handlers/workbench.ts:178-205` (replace stubs)
- Reference: `src/main/handlers/sprint-spec.ts` (for `buildQuickSpecPrompt`, `getTemplateScaffold`)
- Reference: `src/main/agent-manager/sdk-adapter.ts` (for PATH augmentation pattern)

- [ ] **Step 1: Write tests for the AI handlers**

```typescript
// src/main/__tests__/workbench-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process before any imports
const mockExecFile = vi.fn()
vi.mock('child_process', () => ({
  execFile: mockExecFile
}))
vi.mock('util', () => ({
  promisify: () => mockExecFile
}))

// Mock dependencies
vi.mock('../auth-guard', () => ({
  checkAuthStatus: vi.fn().mockResolvedValue({ tokenFound: true, tokenExpired: false })
}))
vi.mock('../git', () => ({
  getRepoPaths: vi.fn().mockReturnValue({ BDE: '/Users/test/BDE' })
}))
vi.mock('../data/supabase-client', () => ({
  getSupabaseClient: vi.fn().mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) })
    })
  })
}))

// Prevent actual IPC registration
vi.mock('../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

import { buildChatPrompt, buildSpecGenerationPrompt } from '../handlers/workbench'

describe('workbench AI helpers', () => {
  it('buildChatPrompt includes form context', () => {
    const prompt = buildChatPrompt([{ role: 'user', content: 'What files handle auth?' }], {
      title: 'Fix auth',
      repo: 'BDE',
      spec: ''
    })
    expect(prompt).toContain('Fix auth')
    expect(prompt).toContain('BDE')
    expect(prompt).toContain('What files handle auth?')
  })

  it('buildSpecGenerationPrompt uses title and repo', () => {
    const args = buildSpecGenerationPrompt({
      title: 'Add caching',
      repo: 'BDE',
      templateHint: 'feature'
    })
    expect(args).toContain('Add caching')
    expect(args).toContain('BDE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/__tests__/workbench-handlers.test.ts`
Expected: FAIL — `buildChatPrompt` and `buildSpecGenerationPrompt` not exported

- [ ] **Step 3: Replace stubs in workbench.ts with real implementations**

In `src/main/handlers/workbench.ts`, replace the three stubs (lines 178-205) with:

```typescript
import { buildQuickSpecPrompt, getTemplateScaffold } from './sprint-spec'

// --- Exported helpers (testable) ---

export function buildChatPrompt(
  messages: Array<{ role: string; content: string }>,
  formContext: { title: string; repo: string; spec: string }
): string {
  const contextBlock = [
    `[Task Context] Title: "${formContext.title}", Repo: ${formContext.repo}`,
    formContext.spec ? `Spec draft:\n${formContext.spec}` : '(no spec yet)'
  ].join('\n')

  const history = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  return `You are an AI assistant helping craft a coding agent task. You have context about the task being created.

${contextBlock}

---

${history}

Respond helpfully and concisely. If asked to research, reference specific file paths. If asked to draft spec sections, use markdown with ## headings.`
}

export function buildSpecGenerationPrompt(input: {
  title: string
  repo: string
  templateHint: string
}): string {
  const scaffold = getTemplateScaffold(input.templateHint)
  return buildQuickSpecPrompt(input.title, input.repo, input.templateHint, scaffold)
}

// --- Inside registerWorkbenchHandlers(), replace the three stubs: ---

// AI-powered chat via claude CLI
safeHandle(
  'workbench:chat',
  async (
    _e,
    input: {
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
      formContext: { title: string; repo: string; spec: string }
    }
  ) => {
    const prompt = buildChatPrompt(input.messages, input.formContext)
    try {
      const { stdout } = await execFileAsync('claude', ['-p', prompt, '--output-format', 'text'], {
        encoding: 'utf-8',
        timeout: 60_000,
        env: augmentedEnv()
      })
      return { content: stdout.trim() || 'No response received.' }
    } catch (err) {
      return { content: `Error: ${(err as Error).message}` }
    }
  }
)

// AI-powered spec generation via claude CLI
safeHandle(
  'workbench:generateSpec',
  async (_e, input: { title: string; repo: string; templateHint: string }) => {
    const prompt = buildSpecGenerationPrompt(input)
    try {
      const { stdout } = await execFileAsync('claude', ['-p', prompt, '--output-format', 'text'], {
        encoding: 'utf-8',
        timeout: 60_000,
        env: augmentedEnv()
      })
      return { spec: stdout.trim() || `# ${input.title}\n\n(No spec generated)` }
    } catch (err) {
      return { spec: `# ${input.title}\n\nError generating spec: ${(err as Error).message}` }
    }
  }
)

// AI-powered spec quality check via claude CLI
safeHandle(
  'workbench:checkSpec',
  async (_e, input: { title: string; repo: string; spec: string }) => {
    const prompt = `You are reviewing a coding agent spec for quality. Return ONLY valid JSON (no markdown fencing).

Title: "${input.title}"
Repo: ${input.repo}
Spec:
${input.spec}

Assess the spec on three dimensions. For each, return status ("pass", "warn", or "fail") and a brief message.

1. clarity: Is the spec clear and actionable? Can an AI agent execute it without ambiguity?
2. scope: Is this achievable by one agent in one session? Or too broad?
3. filesExist: Are file paths specific and plausible? (You cannot verify they exist, so check if they look like real paths.)

Return JSON: {"clarity":{"status":"...","message":"..."},"scope":{"status":"...","message":"..."},"filesExist":{"status":"...","message":"..."}}`

    try {
      const { stdout } = await execFileAsync('claude', ['-p', prompt, '--output-format', 'text'], {
        encoding: 'utf-8',
        timeout: 45_000,
        env: augmentedEnv()
      })
      const parsed = JSON.parse(stdout.trim())
      return {
        clarity: parsed.clarity ?? { status: 'warn', message: 'Unable to assess clarity' },
        scope: parsed.scope ?? { status: 'warn', message: 'Unable to assess scope' },
        filesExist: parsed.filesExist ?? { status: 'warn', message: 'Unable to check files' }
      }
    } catch {
      return {
        clarity: { status: 'warn' as const, message: 'AI check unavailable' },
        scope: { status: 'warn' as const, message: 'AI check unavailable' },
        filesExist: { status: 'warn' as const, message: 'AI check unavailable' }
      }
    }
  }
)
```

Also add the helper to augment PATH (same pattern as `sdk-adapter.ts`):

```typescript
function augmentedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const extraPaths = ['/usr/local/bin', '/opt/homebrew/bin', `${process.env.HOME}/.local/bin`]
  env.PATH = [...extraPaths, ...(env.PATH ?? '').split(':')].filter(Boolean).join(':')
  return env
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/__tests__/workbench-handlers.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/main/handlers/workbench.ts src/main/__tests__/workbench-handlers.test.ts
git commit -m "feat(workbench): implement AI handlers — chat, generateSpec, checkSpec via claude CLI"
```

---

## Task 9: Integration — Semantic + Operational Checks in UI

**Files:**

- Modify: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` (add debounced semantic check, on-demand operational check)
- Reference: `src/renderer/src/stores/taskWorkbench.ts`

- [ ] **Step 1: Add debounced semantic checks to WorkbenchForm**

In `WorkbenchForm.tsx`, add a `useEffect` that runs semantic checks 2 seconds after the spec changes:

```typescript
// Inside WorkbenchForm component, after useReadinessChecks():

const setSemanticChecks = useTaskWorkbenchStore((s) => s.setSemanticChecks)
const setOperationalChecks = useTaskWorkbenchStore((s) => s.setOperationalChecks)

// Debounced semantic checks (Tier 2) — runs 2s after spec edit stops
useEffect(() => {
  if (!spec.trim() || spec.length < 50) return

  useTaskWorkbenchStore.setState({ semanticLoading: true })

  const timer = setTimeout(async () => {
    try {
      const result = await window.api.workbench.checkSpec({ title, repo, spec })
      setSemanticChecks([
        {
          id: 'clarity',
          label: 'Clarity',
          tier: 2,
          status: result.clarity.status,
          message: result.clarity.message
        },
        {
          id: 'scope',
          label: 'Scope',
          tier: 2,
          status: result.scope.status,
          message: result.scope.message
        },
        {
          id: 'files-exist',
          label: 'Files',
          tier: 2,
          status: result.filesExist.status,
          message: result.filesExist.message
        }
      ])
    } catch {
      setSemanticChecks([
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'warn', message: 'Unable to check' },
        { id: 'scope', label: 'Scope', tier: 2, status: 'warn', message: 'Unable to check' },
        { id: 'files-exist', label: 'Files', tier: 2, status: 'warn', message: 'Unable to check' }
      ])
    }
  }, 2000)

  return () => clearTimeout(timer)
}, [spec, title, repo, setSemanticChecks])
```

- [ ] **Step 2: Add operational checks triggered by Queue/Launch**

Modify the `handleSubmit` callback in `WorkbenchForm.tsx` to run operational checks before queuing:

```typescript
const handleSubmit = useCallback(
  async (action: 'backlog' | 'queue') => {
    setSubmitting(true)
    try {
      // Run operational checks for queue/launch
      if (action === 'queue') {
        useTaskWorkbenchStore.setState({ operationalLoading: true })
        const opResult = await window.api.workbench.checkOperational({ repo })
        const opChecks = [
          {
            id: 'auth',
            label: 'Auth',
            tier: 3 as const,
            status: opResult.auth.status,
            message: opResult.auth.message
          },
          {
            id: 'repo-path',
            label: 'Repo Path',
            tier: 3 as const,
            status: opResult.repoPath.status,
            message: opResult.repoPath.message
          },
          {
            id: 'git-clean',
            label: 'Git Clean',
            tier: 3 as const,
            status: opResult.gitClean.status,
            message: opResult.gitClean.message
          },
          {
            id: 'no-conflict',
            label: 'No Conflict',
            tier: 3 as const,
            status: opResult.noConflict.status,
            message: opResult.noConflict.message
          },
          {
            id: 'slots',
            label: 'Agent Slots',
            tier: 3 as const,
            status: opResult.slotsAvailable.status,
            message: opResult.slotsAvailable.message
          }
        ]
        setOperationalChecks(opChecks)

        // Block if any operational check fails
        if (opChecks.some((c) => c.status === 'fail')) {
          useTaskWorkbenchStore.setState({ checksExpanded: true })
          setSubmitting(false)
          return
        }
      }

      if (mode === 'edit' && taskId) {
        await updateTask(taskId, {
          title,
          repo,
          priority,
          spec,
          status: action === 'queue' ? 'queued' : 'backlog'
        })
      } else {
        const input: CreateTicketInput = {
          title,
          repo,
          prompt: title,
          spec,
          priority
        }
        await createTask(input)
        // createTask hardcodes status=backlog. If queuing, find the task and update status.
        if (action === 'queue') {
          const tasks = useSprintTasks.getState().tasks
          const created = tasks.find((t) => t.title === title && t.status === 'backlog')
          if (created) await updateTask(created.id, { status: 'queued' })
        }
      }
      resetForm()
    } finally {
      setSubmitting(false)
    }
  },
  [
    mode,
    taskId,
    title,
    repo,
    priority,
    spec,
    createTask,
    updateTask,
    resetForm,
    setOperationalChecks
  ]
)
```

- [ ] **Step 3: Verify it compiles and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: No type errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/task-workbench/WorkbenchForm.tsx
git commit -m "feat(workbench): add debounced semantic checks and on-demand operational checks"
```

---

## Task 10: Final Polish and Full Verification

**Files:**

- All task-workbench files (review pass)

- [ ] **Step 1: Run full type-check**

Run: `npm run typecheck`
Expected: Clean — no errors

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Run linter**

Run: `npm run lint`
Expected: No errors (warnings OK)

- [ ] **Step 4: Test build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit any polish fixes**

```bash
git add -A
git commit -m "chore(workbench): polish and lint fixes"
```
