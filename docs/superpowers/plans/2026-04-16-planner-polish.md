# Planner Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the Source Control view from navigation, polish the Planner's epic/task hierarchy, and add a Planning Assistant drawer for AI-assisted task/epic creation.

**Architecture:** All changes are renderer-only (no backend changes, no schema changes). Source Control is hidden by flagging it in the view registry and removing it from five consumer files. The Planner gains a thin progress stripe and an ambient Ask AI button in the epic header; clicking it opens a new `PlannerAssistant` component that follows the existing `WorkbenchPanel` conditional-mount pattern and reuses the `workbench:chatStream` IPC channel.

**Tech Stack:** React + TypeScript, Zustand, Vitest + React Testing Library, existing IPC (`workbench:chatStream` / `workbench:chatChunk`), `window.api.sprint.create`, `window.api.groups.create`, `window.api.sprint.update`, `useRepoOptions` hook.

---

## File Map

| File | Change |
|------|--------|
| `src/renderer/src/lib/view-registry.ts` | Add `hidden?: true` to `ViewMetadata`; set on `git`; renumber settings→`⌘6`, planner→`⌘7` |
| `src/renderer/src/stores/keybindings.ts` | Remove `view.git` from `ActionId`, `DEFAULT_KEYBINDINGS`, `ACTION_LABELS`; renumber settings/planner |
| `src/renderer/src/stores/sidebar.ts` | Remove `'git'` from `ALL_VIEWS` |
| `src/renderer/src/components/layout/CommandPalette.tsx` | Remove `view.git` nav command |
| `src/renderer/src/components/settings/KeybindingsSettings.tsx` | Remove `'view.git'` from `ACTION_ORDER` |
| `src/renderer/src/components/planner/EpicList.css` | Pill shape on `.planner-epic-item__status` |
| `src/renderer/src/components/planner/EpicHeader.tsx` | Add `doneCount`, `totalCount`, `onOpenAssistant` props; render stripe and Ask AI button |
| `src/renderer/src/components/planner/EpicDetail.css` | Stripe styles |
| `src/renderer/src/components/planner/EpicDetail.tsx` | Compute `doneCount`/`totalCount`; wire `onOpenAssistant` |
| `src/renderer/src/views/PlannerView.tsx` | Add `assistantOpen` state + guard effect; mount `PlannerAssistant` |
| `src/renderer/src/components/planner/PlannerAssistant.tsx` | **New** — drawer + chat + action cards |
| `src/renderer/src/components/planner/PlannerAssistant.css` | **New** |
| `docs/modules/components/index.md` | Add `PlannerAssistant` row; update modified rows |

---

## Task 1: Hide Source Control

Removes Source Control from sidebar, keyboard shortcuts, keybindings settings, and the command palette. All code stays intact. Source Control can be restored by reverting these five files.

**Files:**
- Modify: `src/renderer/src/lib/view-registry.ts`
- Modify: `src/renderer/src/stores/keybindings.ts`
- Modify: `src/renderer/src/stores/sidebar.ts`
- Modify: `src/renderer/src/components/layout/CommandPalette.tsx`
- Modify: `src/renderer/src/components/settings/KeybindingsSettings.tsx`
- Test: `src/renderer/src/stores/__tests__/sidebar.test.ts` (already exists — run, don't modify)

- [ ] **Step 1: Run existing sidebar tests to confirm baseline**

```bash
cd ~/projects/FLEET && npm test -- src/renderer/src/stores/__tests__/sidebar.test.ts --reporter=verbose
```

Expected: all pass.

- [ ] **Step 2: Add `hidden` field to `ViewMetadata` and flag the `git` entry**

In `src/renderer/src/lib/view-registry.ts`, make two changes:

```ts
// 1. Add hidden to the interface
export interface ViewMetadata {
  label: string
  description: string
  icon: LucideIcon
  shortcut: string
  shortcutKey: string
  hidden?: true  // add this line
}

// 2. Flag git entry and renumber settings + planner
git: {
  label: 'Source Control',
  description: 'Stage, commit, and push changes across repositories',
  icon: GitCommitHorizontal,
  shortcut: '⌘6',
  shortcutKey: '6',
  hidden: true   // add this line
},
settings: {
  ...
  shortcut: '⌘6',    // was ⌘7
  shortcutKey: '6',  // was '7'
},
planner: {
  ...
  shortcut: '⌘7',    // was ⌘8
  shortcutKey: '7',  // was '8'
},
```

- [ ] **Step 3: Remove `view.git` from `keybindings.ts`**

In `src/renderer/src/stores/keybindings.ts`:

```ts
// Remove 'view.git' from the ActionId union:
export type ActionId =
  | 'view.dashboard'
  | 'view.agents'
  | 'view.ide'
  | 'view.sprint'
  | 'view.codeReview'
  // 'view.git' — removed
  | 'view.settings'
  | 'view.taskWorkbench'
  | 'view.planner'
  | 'palette.toggle'
  // ... rest unchanged

// Update DEFAULT_KEYBINDINGS — remove view.git line, update settings + planner:
'view.settings': '⌘6',    // was ⌘7
'view.planner': '⌘7',     // was ⌘8
// remove: 'view.git': '⌘6',

// Update ACTION_LABELS — remove view.git line:
// remove: 'view.git': 'Go to Source Control',
```

- [ ] **Step 4: Remove `'git'` from `sidebar.ts` `ALL_VIEWS`**

In `src/renderer/src/stores/sidebar.ts`, remove `'git'` from the array:

```ts
const ALL_VIEWS: View[] = [
  'dashboard',
  'agents',
  'ide',
  'sprint',
  'code-review',
  // 'git' removed
  'settings',
  'planner'
]
```

- [ ] **Step 5: Remove `view.git` from `CommandPalette.tsx`**

In `src/renderer/src/components/layout/CommandPalette.tsx`, remove the entry:

```ts
// Remove this object from the navigation commands array:
{ view: 'git', label: 'Go to Source Control', actionId: 'view.git' },

// Note: the planner entry uses actionId: 'view.taskWorkbench' — this is intentional, do not change it.
```

- [ ] **Step 6: Remove `'view.git'` from `KeybindingsSettings.tsx` `ACTION_ORDER`**

In `src/renderer/src/components/settings/KeybindingsSettings.tsx`, remove `'view.git'` from `ACTION_ORDER`:

```ts
const ACTION_ORDER: ActionId[] = [
  'view.dashboard',
  'view.agents',
  'view.ide',
  'view.sprint',
  'view.codeReview',
  // 'view.git' removed
  'view.settings',
  'view.taskWorkbench',
  'view.planner',
  // ... rest unchanged
]
```

- [ ] **Step 7: Type-check to confirm no type errors**

```bash
cd ~/projects/FLEET && npm run typecheck
```

Expected: zero errors. If `'view.git'` is referenced anywhere else the compiler will tell you.

- [ ] **Step 8: Run tests**

```bash
cd ~/projects/FLEET && npm test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/lib/view-registry.ts \
        src/renderer/src/stores/keybindings.ts \
        src/renderer/src/stores/sidebar.ts \
        src/renderer/src/components/layout/CommandPalette.tsx \
        src/renderer/src/components/settings/KeybindingsSettings.tsx
git commit -m "feat: hide source control from nav and shortcuts"
```

---

## Task 2: Epic List Status Pill + Epic Header Stripe and Ask AI Button

Adds a pill shape to the existing status label in the epic list, a 3px progress stripe to the epic detail header, and an ambient "Ask AI ✦" button. The stripe requires two new props on `EpicHeader`; `EpicDetail` computes and passes them.

**Files:**
- Modify: `src/renderer/src/components/planner/EpicList.css`
- Modify: `src/renderer/src/components/planner/EpicHeader.tsx`
- Modify: `src/renderer/src/components/planner/EpicDetail.css`
- Modify: `src/renderer/src/components/planner/EpicDetail.tsx`
- Test: `src/renderer/src/components/planner/__tests__/EpicHeader.test.tsx` (create if absent)

- [ ] **Step 1: Write a failing test for the new `EpicHeader` props**

Create `src/renderer/src/components/planner/__tests__/EpicHeader.test.tsx` if it doesn't exist, otherwise add to the existing file:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EpicHeader } from '../EpicHeader'

const baseGroup = {
  id: 'g1', name: 'Test Epic', goal: 'Ship it', icon: '🚀',
  accent_color: '#4a88c7', status: 'draft' as const,
  created_at: '', updated_at: '', sort_order: 0,
  dependencies: []
}

describe('EpicHeader — progress stripe', () => {
  it('renders a stripe at the correct fill width', () => {
    const { container } = render(
      <EpicHeader
        group={baseGroup}
        isReady={false}
        isCompleted={false}
        doneCount={3}
        totalCount={6}
        onEdit={vi.fn()}
        onToggleReady={vi.fn()}
        onMarkCompleted={vi.fn()}
        onDelete={vi.fn()}
        onOpenAssistant={vi.fn()}
      />
    )
    const fill = container.querySelector('.epic-detail__header-stripe-fill') as HTMLElement
    expect(fill).toBeTruthy()
    expect(fill.style.width).toBe('50%')
  })

  it('hides the stripe when totalCount is 0', () => {
    const { container } = render(
      <EpicHeader
        group={baseGroup}
        isReady={false}
        isCompleted={false}
        doneCount={0}
        totalCount={0}
        onEdit={vi.fn()}
        onToggleReady={vi.fn()}
        onMarkCompleted={vi.fn()}
        onDelete={vi.fn()}
        onOpenAssistant={vi.fn()}
      />
    )
    const stripe = container.querySelector('.epic-detail__header-stripe')
    expect(stripe).toBeFalsy()
  })

  it('calls onOpenAssistant when Ask AI button is clicked', async () => {
    const onOpenAssistant = vi.fn()
    render(
      <EpicHeader
        group={baseGroup}
        isReady={false}
        isCompleted={false}
        doneCount={2}
        totalCount={4}
        onEdit={vi.fn()}
        onToggleReady={vi.fn()}
        onMarkCompleted={vi.fn()}
        onDelete={vi.fn()}
        onOpenAssistant={onOpenAssistant}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /ask ai/i }))
    expect(onOpenAssistant).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd ~/projects/FLEET && npm test -- src/renderer/src/components/planner/__tests__/EpicHeader.test.tsx --reporter=verbose
```

Expected: FAIL — `doneCount`, `totalCount`, `onOpenAssistant` props don't exist yet.

- [ ] **Step 3: Update `EpicHeaderProps` and render stripe + button**

In `src/renderer/src/components/planner/EpicHeader.tsx`:

```tsx
// Add to EpicHeaderProps interface:
export interface EpicHeaderProps {
  group: TaskGroup
  isReady: boolean
  isCompleted: boolean
  doneCount: number          // new
  totalCount: number         // new
  onEdit: () => Promise<void>
  onToggleReady: () => void
  onMarkCompleted: () => void
  onDelete: () => Promise<void>
  onOpenAssistant: () => void  // new
}

// Add doneCount, totalCount, onOpenAssistant to the destructured params.

// In the return JSX, add the Ask AI button before the overflow button:
<button
  type="button"
  className="epic-detail__header-btn epic-detail__header-btn--ai"
  onClick={onOpenAssistant}
  aria-label="Ask AI"
>
  ✦ Ask AI
</button>

// After the closing </div> of epic-detail__header (as a sibling, not child),
// add the stripe when totalCount > 0:
{totalCount > 0 && (
  <div className="epic-detail__header-stripe">
    <div
      className="epic-detail__header-stripe-fill"
      style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
    />
  </div>
)}
```

Note: the stripe is a sibling of `epic-detail__header`, rendered just after it inside `EpicDetail`'s JSX — not inside `EpicHeader` itself, since `EpicDetail.css` controls the layout. Pass `doneCount` and `totalCount` into `EpicHeader` and let `EpicHeader` render the stripe element so it stays self-contained.

- [ ] **Step 4: Add stripe styles to `EpicDetail.css`**

```css
/* Progress stripe — thin accent bar below the header */
.epic-detail__header-stripe {
  height: 3px;
  background: var(--fleet-accent-dim);
  overflow: hidden;
  flex-shrink: 0;
}

.epic-detail__header-stripe-fill {
  height: 100%;
  background: var(--fleet-accent);
  transition: width 200ms ease;
}

/* Ask AI button variant */
.epic-detail__header-btn--ai {
  background: var(--fleet-accent-dim);
  border: 1px solid var(--fleet-accent-border);
  color: var(--fleet-accent-text);
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: var(--fleet-radius-sm);
  gap: 4px;
}

.epic-detail__header-btn--ai:hover:not(:disabled) {
  background: var(--fleet-accent-hover);
}
```

- [ ] **Step 5: Update `EpicDetail.tsx` to compute counts and pass to `EpicHeader`**

In `src/renderer/src/components/planner/EpicDetail.tsx`, add two derived values and wire the new props. Also accept the `onOpenAssistant` callback via props:

```tsx
// Add onOpenAssistant to EpicDetailProps:
export interface EpicDetailProps {
  // ... existing props
  onOpenAssistant: () => void  // new
}

// Inside the component body, compute counts from the tasks prop:
const doneCount = tasks.filter((t) => t.status === 'done').length
const totalCount = tasks.length

// Pass to EpicHeader:
<EpicHeader
  group={group}
  isReady={isReady}
  isCompleted={isCompleted}
  doneCount={doneCount}
  totalCount={totalCount}
  onEdit={handleEdit}
  onToggleReady={handleToggleReady}
  onMarkCompleted={handleMarkCompleted}
  onDelete={handleDelete}
  onOpenAssistant={onOpenAssistant}
/>
```

- [ ] **Step 6: Wire `onOpenAssistant` through `PlannerView`**

In `src/renderer/src/views/PlannerView.tsx`:

```tsx
// Add assistantOpen state alongside workbenchOpen:
const [assistantOpen, setAssistantOpen] = useState(false)

// Guard: close drawer if the selected epic disappears
useEffect(() => {
  if (!selectedGroup) setAssistantOpen(false)
}, [selectedGroup])

// Pass to EpicDetail:
<EpicDetail
  // ... existing props
  onOpenAssistant={() => setAssistantOpen(true)}
/>
```

- [ ] **Step 7: Add `position: relative` to `.planner-body` in `PlannerView.css`**

The `PlannerAssistant` drawer is `position: absolute` — it needs a positioned ancestor to scope it. `.planner-body` currently has `flex: 1; display: flex; overflow: hidden` but no `position`. Add:

```css
.planner-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative; /* scopes the PlannerAssistant absolute drawer */
}
```

Add `src/renderer/src/views/PlannerView.css` to the commit in Step 10.

- [ ] **Step 8: Add pill shape to `.planner-epic-item__status` in `EpicList.css`**

The `.planner-epic-item__status` element already exists and renders the status text. Add pill styling:

```css
.planner-epic-item__status {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  /* New pill styles: */
  padding: 1px 6px;
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 12%, transparent);
}
```

`currentColor` picks up the colour already set inline on this element via `getStatusColor()` in `EpicList.tsx` — no JSX changes needed.

- [ ] **Step 9: Run the tests**

```bash
cd ~/projects/FLEET && npm test -- src/renderer/src/components/planner/__tests__/EpicHeader.test.tsx --reporter=verbose
```

Expected: all three tests pass.

- [ ] **Step 10: Run full test suite and typecheck**

```bash
cd ~/projects/FLEET && npm run typecheck && npm test
```

Expected: zero type errors, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/components/planner/EpicList.css \
        src/renderer/src/components/planner/EpicHeader.tsx \
        src/renderer/src/components/planner/EpicDetail.css \
        src/renderer/src/components/planner/EpicDetail.tsx \
        src/renderer/src/views/PlannerView.tsx \
        src/renderer/src/views/PlannerView.css \
        src/renderer/src/components/planner/__tests__/EpicHeader.test.tsx
git commit -m "feat: add epic header progress stripe, Ask AI button, and status pill"
```

---

## Task 3: Planning Assistant Drawer

A new component that provides AI-assisted planning for the selected epic. Reuses `workbench:chatStream` IPC. Parses structured `[ACTION:...]` markers from the stream and renders inline confirmation cards.

**Files:**
- Create: `src/renderer/src/components/planner/PlannerAssistant.tsx`
- Create: `src/renderer/src/components/planner/PlannerAssistant.css`
- Create: `src/renderer/src/components/planner/__tests__/PlannerAssistant.test.tsx`
- Modify: `src/renderer/src/views/PlannerView.tsx`
- Modify: `docs/modules/components/index.md`

### 3a: Action marker parser (pure function, easy to test)

- [ ] **Step 1: Write failing tests for `parseActionMarkers`**

In `src/renderer/src/components/planner/__tests__/PlannerAssistant.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { parseActionMarkers } from '../PlannerAssistant'

describe('parseActionMarkers', () => {
  it('returns clean text with no markers untouched', () => {
    const result = parseActionMarkers('Hello world')
    expect(result.clean).toBe('Hello world')
    expect(result.actions).toHaveLength(0)
  })

  it('extracts a create-task marker and removes it from clean text', () => {
    const input = 'Here is a task:\n[ACTION:create-task]{"title":"Fix auth","spec":"Update middleware"}[/ACTION]\nDone.'
    const result = parseActionMarkers(input)
    expect(result.clean).toBe('Here is a task:\nDone.')
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({
      type: 'create-task',
      payload: { title: 'Fix auth', spec: 'Update middleware' }
    })
  })

  it('extracts an update-spec marker with taskId', () => {
    const input = '[ACTION:update-spec]{"taskId":"abc123","spec":"New spec"}[/ACTION]'
    const result = parseActionMarkers(input)
    expect(result.actions[0]).toEqual({
      type: 'update-spec',
      payload: { taskId: 'abc123', spec: 'New spec' }
    })
  })

  it('extracts a create-epic marker', () => {
    const input = '[ACTION:create-epic]{"name":"New Epic","goal":"Ship fast"}[/ACTION]'
    const result = parseActionMarkers(input)
    expect(result.actions[0]).toEqual({
      type: 'create-epic',
      payload: { name: 'New Epic', goal: 'Ship fast' }
    })
  })

  it('handles multiple markers in one message', () => {
    const input = '[ACTION:create-task]{"title":"A","spec":"s"}[/ACTION] and [ACTION:create-task]{"title":"B","spec":"t"}[/ACTION]'
    const result = parseActionMarkers(input)
    expect(result.actions).toHaveLength(2)
    expect(result.clean.trim()).toBe('and')
  })

  it('ignores malformed JSON inside a marker', () => {
    const input = '[ACTION:create-task]{bad json}[/ACTION]'
    const result = parseActionMarkers(input)
    expect(result.clean).toBe('')
    expect(result.actions).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd ~/projects/FLEET && npm test -- src/renderer/src/components/planner/__tests__/PlannerAssistant.test.tsx --reporter=verbose
```

Expected: FAIL — `parseActionMarkers` is not exported yet.

- [ ] **Step 3: Create `PlannerAssistant.tsx` with the parser**

Create `src/renderer/src/components/planner/PlannerAssistant.tsx`:

```tsx
import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { TaskGroup, SprintTask } from '../../../../shared/types'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import './PlannerAssistant.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionType = 'create-task' | 'create-epic' | 'update-spec'

interface PlannerAction {
  type: ActionType
  payload: Record<string, string>
}

interface ParseResult {
  clean: string
  actions: PlannerAction[]
}

interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions: PlannerAction[]
}

export interface PlannerAssistantProps {
  open: boolean
  onClose: () => void
  epic: TaskGroup | null
  tasks: SprintTask[]
  onOpenWorkbench: () => void
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const ACTION_REGEX = /\[ACTION:(\w[\w-]*)\]([\s\S]*?)\[\/ACTION\]/g

export function parseActionMarkers(text: string): ParseResult {
  const actions: PlannerAction[] = []
  const clean = text.replace(ACTION_REGEX, (_match, type, json) => {
    try {
      const payload = JSON.parse(json.trim()) as Record<string, string>
      actions.push({ type: type as ActionType, payload })
    } catch {
      // Malformed JSON — discard silently
    }
    return ''
  })
  return { clean: clean.replace(/\n{3,}/g, '\n\n').trim(), actions }
}

function buildEpicContext(epic: TaskGroup, tasks: SprintTask[]): string {
  const taskLines = tasks
    .map((t) => `- ${t.title} [${t.status}]${!t.spec ? ' (no spec)' : ''}`)
    .join('\n')
  return [
    `Epic: ${epic.name}`,
    epic.goal ? `Goal: ${epic.goal}` : null,
    tasks.length > 0 ? `\nExisting tasks:\n${taskLines}` : '\nNo tasks yet.'
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// ActionCard — inline confirmation UI
// ---------------------------------------------------------------------------

interface ActionCardProps {
  action: PlannerAction
  epicId: string
  onConfirmed: (summary: string) => void
  onOpenWorkbench: (action: PlannerAction) => void
}

function ActionCard({ action, epicId, onConfirmed, onOpenWorkbench }: ActionCardProps): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false)
  const [working, setWorking] = useState(false)

  const label =
    action.type === 'create-task'
      ? action.payload.title
      : action.type === 'create-epic'
        ? action.payload.name
        : action.payload.title ?? 'Update spec'

  const typeLabel =
    action.type === 'create-task'
      ? 'New task'
      : action.type === 'create-epic'
        ? 'New epic'
        : 'Update spec'

  const handleConfirm = async (): Promise<void> => {
    setWorking(true)
    try {
      if (action.type === 'create-task') {
        await window.api.sprint.create({
          title: action.payload.title,
          spec: action.payload.spec ?? '',
          repo: '',
          priority: 0,
          playground_enabled: false,
          group_id: epicId   // associates the task with the epic
        })
        onConfirmed(`Created task: ${action.payload.title}`)
      } else if (action.type === 'create-epic') {
        await window.api.groups.create({
          name: action.payload.name,
          goal: action.payload.goal ?? ''
        })
        onConfirmed(`Created epic: ${action.payload.name}`)
      } else if (action.type === 'update-spec') {
        await window.api.sprint.update(action.payload.taskId, { spec: action.payload.spec })
        onConfirmed('Spec updated')
      }
      setConfirmed(true)
    } catch {
      setWorking(false)
    }
  }

  if (confirmed) {
    return (
      <div className="planner-assistant__action-card planner-assistant__action-card--confirmed">
        <span className="planner-assistant__action-type">{typeLabel}</span>
        <span className="planner-assistant__action-title">{label}</span>
        <span className="planner-assistant__action-confirmed">✓ Done</span>
      </div>
    )
  }

  return (
    <div className="planner-assistant__action-card">
      <div className="planner-assistant__action-header">
        <span className="planner-assistant__action-type">{typeLabel}</span>
        <span className="planner-assistant__action-title">{label}</span>
      </div>
      {action.payload.spec && (
        <p className="planner-assistant__action-spec">{action.payload.spec.slice(0, 180)}{action.payload.spec.length > 180 ? '…' : ''}</p>
      )}
      <div className="planner-assistant__action-buttons">
        <button
          type="button"
          className="planner-assistant__btn planner-assistant__btn--confirm"
          onClick={() => void handleConfirm()}
          disabled={working}
        >
          {working ? '…' : action.type === 'update-spec' ? 'Apply' : 'Create'}
        </button>
        <button
          type="button"
          className="planner-assistant__btn planner-assistant__btn--edit"
          onClick={() => onOpenWorkbench(action)}
          disabled={working}
        >
          Edit first
        </button>
        <button
          type="button"
          className="planner-assistant__btn planner-assistant__btn--skip"
          onClick={() => setConfirmed(true)}
        >
          Skip
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PlannerAssistant
// ---------------------------------------------------------------------------

export function PlannerAssistant({
  open,
  onClose,
  epic,
  tasks,
  onOpenWorkbench
}: PlannerAssistantProps): React.JSX.Element | null {
  if (!open || !epic) return null

  return <PlannerAssistantInner epic={epic} tasks={tasks} onClose={onClose} onOpenWorkbench={onOpenWorkbench} />
}

interface InnerProps {
  epic: TaskGroup
  tasks: SprintTask[]
  onClose: () => void
  onOpenWorkbench: () => void
}

function PlannerAssistantInner({ epic, tasks, onClose, onOpenWorkbench }: InnerProps): React.JSX.Element {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const streamingIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const repos = useRepoOptions()
  const firstRepo = repos[0]?.label ?? ''

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Subscribe to streaming chunks
  useEffect(() => {
    const unsub = window.api.workbench.onChatChunk((data) => {
      if (streamingIdRef.current && data.streamId !== streamingIdRef.current) return

      if (!data.done) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === 'streaming' ? { ...m, content: m.content + data.chunk } : m
          )
        )
      } else {
        setStreaming(false)
        streamingIdRef.current = null
        // Finalise: parse action markers out of the completed message
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== 'streaming') return m
            const { clean, actions } = parseActionMarkers(m.content)
            return { ...m, id: `assistant-${Date.now()}`, content: clean, actions }
          })
        )
      }
    })
    return unsub
  }, [])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: AssistantMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      actions: []
    }
    const assistantPlaceholder: AssistantMessage = {
      id: 'streaming',
      role: 'assistant',
      content: '',
      actions: []
    }
    setMessages((prev) => [...prev, userMsg, assistantPlaceholder])
    setInput('')
    setStreaming(true)

    const epicContext = buildEpicContext(epic, tasks)

    try {
      await window.api.workbench.chatStream({
        messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
        formContext: {
          title: epic.name,
          repo: firstRepo,
          spec: epicContext
        }
      })
    } catch {
      setStreaming(false)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === 'streaming'
            ? { ...m, id: `assistant-${Date.now()}`, content: 'Failed to reach Claude. Check your connection and try again.' }
            : m
        )
      )
    }
  }, [input, streaming, messages, epic, tasks, firstRepo])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleConfirmed = (summary: string): void => {
    setMessages((prev) => [
      ...prev,
      { id: `system-${Date.now()}`, role: 'assistant', content: `✓ ${summary}`, actions: [] }
    ])
  }

  const handleOpenWorkbenchForAction = (action: PlannerAction): void => {
    const store = useTaskWorkbenchStore.getState()
    store.resetForm()
    if (action.type === 'create-task') {
      store.setField('title', action.payload.title ?? '')
      store.setField('spec', action.payload.spec ?? '')
      store.setField('pendingGroupId', epic.id)
    }
    onOpenWorkbench()
    onClose()
  }

  const noRepos = repos.length === 0

  return (
    <div className="planner-assistant" role="complementary" aria-label="Planning assistant">
      <div className="planner-assistant__header">
        <span className="planner-assistant__live-dot" aria-hidden />
        <span className="planner-assistant__title">Planning Assistant</span>
        <span className="planner-assistant__context">{epic.name} · {tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
        <button
          type="button"
          className="planner-assistant__close"
          onClick={onClose}
          aria-label="Close planning assistant"
        >
          ✕
        </button>
      </div>

      <div className="planner-assistant__messages" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="planner-assistant__empty">
            Ask me to brainstorm tasks, fill in specs, or suggest what's missing from this epic.
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`planner-assistant__msg planner-assistant__msg--${msg.role}`}>
            <p className="planner-assistant__msg-text">{msg.content}</p>
            {msg.actions.map((action, i) => (
              <ActionCard
                key={i}
                action={action}
                epicId={epic.id}
                onConfirmed={handleConfirmed}
                onOpenWorkbench={handleOpenWorkbenchForAction}
              />
            ))}
          </div>
        ))}
        {streaming && messages.at(-1)?.content === '' && (
          <div className="planner-assistant__msg planner-assistant__msg--assistant">
            <span className="planner-assistant__thinking">●●●</span>
          </div>
        )}
      </div>

      <div className="planner-assistant__input-bar">
        {noRepos ? (
          <p className="planner-assistant__no-repo">Configure a repository in Settings → Repositories to use the assistant.</p>
        ) : (
          <>
            <textarea
              className="planner-assistant__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this epic…"
              rows={2}
              disabled={streaming}
              aria-label="Message to planning assistant"
            />
            <button
              type="button"
              className="planner-assistant__send"
              onClick={() => void handleSend()}
              disabled={!input.trim() || streaming}
              aria-label="Send message"
            >
              ↑
            </button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `PlannerAssistant.css`**

Create `src/renderer/src/components/planner/PlannerAssistant.css`:

```css
/* PlannerAssistant — slide-over planning drawer */

.planner-assistant {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(560px, 60%);
  background: var(--fleet-bg);
  border-left: 1px solid var(--fleet-border);
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  z-index: 10;
  font-family: var(--fleet-font-code);
}

/* Header */
.planner-assistant__header {
  display: flex;
  align-items: center;
  gap: var(--fleet-space-2);
  padding: var(--fleet-space-3) var(--fleet-space-4);
  background: var(--fleet-surface);
  border-bottom: 1px solid var(--fleet-border);
  flex-shrink: 0;
}

.planner-assistant__live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fleet-status-active);
  flex-shrink: 0;
}

.planner-assistant__title {
  font-size: 12px;
  font-weight: 700;
  color: var(--fleet-text);
}

.planner-assistant__context {
  font-size: 11px;
  color: var(--fleet-text-muted);
  flex: 1;
}

.planner-assistant__close {
  background: none;
  border: none;
  color: var(--fleet-text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: var(--fleet-space-1);
  border-radius: var(--fleet-radius-sm);
  line-height: 1;
  transition: color 100ms ease;
}

.planner-assistant__close:hover { color: var(--fleet-text); }

/* Messages */
.planner-assistant__messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--fleet-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--fleet-space-3);
}

.planner-assistant__empty {
  font-size: 12px;
  color: var(--fleet-text-dim);
  line-height: 1.6;
}

.planner-assistant__msg { display: flex; flex-direction: column; gap: var(--fleet-space-2); }

.planner-assistant__msg-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--fleet-text);
  white-space: pre-wrap;
}

.planner-assistant__msg--user .planner-assistant__msg-text {
  color: var(--fleet-accent-text);
  padding: var(--fleet-space-2) var(--fleet-space-3);
  background: var(--fleet-accent-surface);
  border: 1px solid var(--fleet-accent-border);
  border-radius: var(--fleet-radius-md);
  align-self: flex-end;
}

.planner-assistant__thinking {
  font-size: 10px;
  color: var(--fleet-text-dim);
  letter-spacing: 3px;
  animation: blink 1.2s ease-in-out infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* Action cards */
.planner-assistant__action-card {
  background: var(--fleet-surface);
  border: 1px solid var(--fleet-border);
  border-radius: var(--fleet-radius-md);
  overflow: hidden;
}

.planner-assistant__action-card--confirmed {
  border-color: var(--fleet-status-done);
  display: flex;
  align-items: center;
  gap: var(--fleet-space-2);
  padding: var(--fleet-space-2) var(--fleet-space-3);
  opacity: 0.7;
}

.planner-assistant__action-header {
  display: flex;
  align-items: center;
  gap: var(--fleet-space-2);
  padding: var(--fleet-space-2) var(--fleet-space-3);
  background: var(--fleet-surface-high);
  border-bottom: 1px solid var(--fleet-border);
}

.planner-assistant__action-type {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fleet-accent-text);
  background: var(--fleet-accent-surface);
  border: 1px solid var(--fleet-accent-border);
  padding: 1px 5px;
  border-radius: var(--fleet-radius-sm);
  flex-shrink: 0;
}

.planner-assistant__action-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fleet-text);
}

.planner-assistant__action-spec {
  font-size: 11px;
  color: var(--fleet-text-muted);
  line-height: 1.5;
  padding: var(--fleet-space-2) var(--fleet-space-3);
  border-bottom: 1px solid var(--fleet-border);
}

.planner-assistant__action-confirmed {
  font-size: 11px;
  font-weight: 700;
  color: var(--fleet-status-done);
  margin-left: auto;
}

.planner-assistant__action-buttons {
  display: flex;
  gap: var(--fleet-space-2);
  padding: var(--fleet-space-2) var(--fleet-space-3);
}

.planner-assistant__btn {
  padding: var(--fleet-space-1) var(--fleet-space-3);
  border-radius: var(--fleet-radius-sm);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: opacity 100ms ease;
}

.planner-assistant__btn:disabled { opacity: 0.5; cursor: not-allowed; }

.planner-assistant__btn--confirm {
  background: var(--fleet-accent);
  color: var(--fleet-bg);
}

.planner-assistant__btn--edit {
  background: var(--fleet-surface-high);
  border: 1px solid var(--fleet-border);
  color: var(--fleet-text-muted);
}

.planner-assistant__btn--skip {
  background: transparent;
  color: var(--fleet-text-dim);
}

/* Input bar */
.planner-assistant__input-bar {
  padding: var(--fleet-space-3) var(--fleet-space-4);
  border-top: 1px solid var(--fleet-border);
  background: var(--fleet-surface);
  display: flex;
  gap: var(--fleet-space-2);
  align-items: flex-end;
  flex-shrink: 0;
}

.planner-assistant__input {
  flex: 1;
  padding: var(--fleet-space-2) var(--fleet-space-3);
  background: var(--fleet-bg);
  border: 1px solid var(--fleet-border);
  border-radius: var(--fleet-radius-md);
  color: var(--fleet-text);
  font-size: 12px;
  font-family: var(--fleet-font-code);
  resize: none;
  outline: none;
  transition: border-color 150ms ease;
  line-height: 1.5;
}

.planner-assistant__input:focus-visible { border-color: var(--fleet-accent); }

.planner-assistant__send {
  width: 30px;
  height: 30px;
  background: var(--fleet-accent);
  border: none;
  border-radius: var(--fleet-radius-sm);
  color: var(--fleet-bg);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 100ms ease;
}

.planner-assistant__send:disabled { opacity: 0.4; cursor: not-allowed; }

.planner-assistant__no-repo {
  font-size: 11px;
  color: var(--fleet-text-dim);
  line-height: 1.5;
}
```

- [ ] **Step 5: Run the parser tests to confirm they pass**

```bash
cd ~/projects/FLEET && npm test -- src/renderer/src/components/planner/__tests__/PlannerAssistant.test.tsx --reporter=verbose
```

Expected: all `parseActionMarkers` tests pass.

- [ ] **Step 6: Write component-level tests**

Add to `src/renderer/src/components/planner/__tests__/PlannerAssistant.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerAssistant } from '../PlannerAssistant'

// Mock IPC

const mockEpic = {
  id: 'epic-1', name: 'Auth Rewrite', goal: 'Ship OAuth2',
  icon: '🔐', accent_color: '#4a88c7', status: 'draft' as const,
  created_at: '', updated_at: '', sort_order: 0, dependencies: []
}

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  epic: mockEpic,
  tasks: [],
  onOpenWorkbench: vi.fn()
}

// Mock useRepoOptions so the component sees a configured repo and enables the input
vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => [{ label: 'fleet', owner: '', color: '' }]
}))

beforeEach(() => {
  vi.stubGlobal('window', {
    api: {
      workbench: {
        chatStream: vi.fn().mockResolvedValue(undefined),
        onChatChunk: vi.fn().mockReturnValue(() => {})
      },
      sprint: { create: vi.fn(), update: vi.fn() },
      groups: { create: vi.fn() }
    }
  })
})

describe('PlannerAssistant', () => {
  it('renders null when open is false', () => {
    const { container } = render(<PlannerAssistant {...defaultProps} open={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null when epic is null', () => {
    const { container } = render(<PlannerAssistant {...defaultProps} epic={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the drawer with epic context in the header', () => {
    render(<PlannerAssistant {...defaultProps} />)
    expect(screen.getByText('Planning Assistant')).toBeTruthy()
    expect(screen.getByText(/Auth Rewrite/)).toBeTruthy()
  })

  it('calls chatStream when a message is sent', async () => {
    render(<PlannerAssistant {...defaultProps} />)
    const input = screen.getByRole('textbox', { name: /message/i })
    await userEvent.type(input, 'suggest tasks')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(window.api.workbench.chatStream).toHaveBeenCalledOnce()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<PlannerAssistant {...defaultProps} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 7: Run component tests**

```bash
cd ~/projects/FLEET && npm test -- src/renderer/src/components/planner/__tests__/PlannerAssistant.test.tsx --reporter=verbose
```

Expected: all tests pass. Fix any `window.api` mock gaps if tests fail.

- [ ] **Step 8: Mount `PlannerAssistant` in `PlannerView`**

In `src/renderer/src/views/PlannerView.tsx`, add the mount alongside `WorkbenchPanel`:

```tsx
import { PlannerAssistant } from '../components/planner/PlannerAssistant'

// In the component body (assistantOpen state and guard effect already added in Task 2):

// In the JSX return, after <WorkbenchPanel ...>:
<PlannerAssistant
  open={assistantOpen}
  onClose={() => setAssistantOpen(false)}
  epic={selectedGroup}
  tasks={groupTasks}
  onOpenWorkbench={() => setWorkbenchOpen(true)}
/>
```

Note: `PlannerView` wraps its body in a `<div className="planner-body view-layout">` — this div needs `position: relative` so the absolute-positioned drawer is scoped correctly. Add it if not already present.

- [ ] **Step 9: Run full test suite and typecheck**

```bash
cd ~/projects/FLEET && npm run typecheck && npm test
```

Expected: zero type errors, all tests pass.

- [ ] **Step 10: Update module docs**

In `docs/modules/components/index.md`, add a row for `PlannerAssistant` in the `planner` group and update rows for `EpicHeader` and `EpicDetail` to reflect new props.

- [ ] **Step 11: Final commit**

```bash
git add src/renderer/src/components/planner/PlannerAssistant.tsx \
        src/renderer/src/components/planner/PlannerAssistant.css \
        src/renderer/src/components/planner/__tests__/PlannerAssistant.test.tsx \
        src/renderer/src/views/PlannerView.tsx \
        docs/modules/components/index.md
git commit -m "feat: add PlannerAssistant drawer with AI task and epic creation"
```

---

## Verification

After all tasks are complete:

```bash
cd ~/projects/FLEET && npm run typecheck && npm test && npm run lint
```

All three must pass cleanly before the branch is ready for review.

**Manual checks (run the app):**
1. Source Control is gone from the sidebar — `⌘6` opens Settings, `⌘7` opens Planner
2. Settings → Keybindings no longer shows a Source Control row
3. Command Palette (⌘P) no longer lists "Go to Source Control"
4. Opening the Planner and selecting an epic shows the progress stripe and Ask AI button
5. Clicking Ask AI opens the drawer; the header shows the epic name and task count
6. Typing a message and pressing Enter sends it; streaming response appears
7. An action card renders when the assistant proposes a task; Create creates it; Skip dismisses it
8. Closing the drawer with ✕ works; deleting the epic closes the drawer automatically
