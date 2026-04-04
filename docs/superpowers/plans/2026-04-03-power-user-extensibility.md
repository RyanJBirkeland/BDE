# Power User & Extensibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add power-user features that increase velocity for keyboard-heavy users and enable customization: enhanced command palette, task tags, morning briefing, floating agent monitor, structured task search, and settings profiles.

**Architecture:** Features span renderer (stores, components, CSS) and main process (DB migrations, IPC handlers, queries). Each feature is independent and produces its own shippable PR. TDD throughout — tests written before or alongside implementation.

**Tech Stack:** React, Zustand, TypeScript, SQLite, vitest + @testing-library/react

**Spec:** Based on Developer Persona Audit (`docs/superpowers/specs/2026-04-03-developer-persona-audit.md`), features #11, #12, #17, #19, #30, #31.

---

## Feature 1: Command Palette Enhancement

_Estimated scope: 3-4 days. Expand from ~19 commands to 50+. Add command registry pattern, context-sensitive ranking, recent commands._

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/src/stores/commandRegistry.ts` | Create | Command registry store — dynamic registration, recent tracking |
| `src/renderer/src/stores/__tests__/commandRegistry.test.ts` | Create | Unit tests for registry |
| `src/renderer/src/components/layout/CommandPalette.tsx` | Modify | Consume registry instead of hardcoded commands |
| `src/renderer/src/components/layout/__tests__/CommandPalette.test.tsx` | Modify | Update tests for new commands |
| `src/renderer/src/views/DashboardView.tsx` | Modify | Register dashboard-specific commands |
| `src/renderer/src/components/sprint/SprintPipeline.tsx` | Modify | Register pipeline commands |
| `src/renderer/src/views/CodeReviewView.tsx` | Modify | Register review commands |
| `src/renderer/src/assets/neon-shell.css` | Modify | Style recent commands section |

---

### Task 1.1: Create command registry store

**Files:**
- Create: `src/renderer/src/stores/commandRegistry.ts`
- Create: `src/renderer/src/stores/__tests__/commandRegistry.test.ts`

- [ ] **Step 1: Write tests for the registry store**

Create `src/renderer/src/stores/__tests__/commandRegistry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useCommandRegistry, type RegisteredCommand } from '../commandRegistry'

beforeEach(() => {
  useCommandRegistry.getState().clear()
})

describe('commandRegistry', () => {
  it('registers and retrieves commands', () => {
    const cmd: RegisteredCommand = {
      id: 'test:hello',
      label: 'Say Hello',
      category: 'action',
      action: () => {},
    }
    useCommandRegistry.getState().register([cmd])
    expect(useCommandRegistry.getState().commands).toHaveLength(1)
    expect(useCommandRegistry.getState().commands[0].id).toBe('test:hello')
  })

  it('unregisters commands by source', () => {
    useCommandRegistry.getState().register([
      { id: 'a:1', label: 'A1', category: 'action', action: () => {}, source: 'viewA' },
      { id: 'b:1', label: 'B1', category: 'action', action: () => {}, source: 'viewB' },
    ])
    useCommandRegistry.getState().unregisterBySource('viewA')
    expect(useCommandRegistry.getState().commands).toHaveLength(1)
    expect(useCommandRegistry.getState().commands[0].id).toBe('b:1')
  })

  it('deduplicates commands by id', () => {
    const cmd = { id: 'dup:1', label: 'Dup', category: 'action' as const, action: () => {} }
    useCommandRegistry.getState().register([cmd])
    useCommandRegistry.getState().register([cmd])
    expect(useCommandRegistry.getState().commands).toHaveLength(1)
  })

  it('tracks recent command IDs', () => {
    useCommandRegistry.getState().recordRecent('test:hello')
    useCommandRegistry.getState().recordRecent('test:world')
    expect(useCommandRegistry.getState().recentIds).toEqual(['test:world', 'test:hello'])
  })

  it('caps recent commands at 10', () => {
    for (let i = 0; i < 15; i++) {
      useCommandRegistry.getState().recordRecent(`cmd:${i}`)
    }
    expect(useCommandRegistry.getState().recentIds).toHaveLength(10)
  })

  it('fuzzy filters commands', () => {
    useCommandRegistry.getState().register([
      { id: 'a', label: 'Go to Dashboard', category: 'navigation', action: () => {} },
      { id: 'b', label: 'Launch Agent', category: 'action', action: () => {} },
    ])
    const result = useCommandRegistry.getState().search('dash')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })

  it('ranks recent commands higher', () => {
    useCommandRegistry.getState().register([
      { id: 'a', label: 'Alpha', category: 'action', action: () => {} },
      { id: 'b', label: 'Beta', category: 'action', action: () => {} },
    ])
    useCommandRegistry.getState().recordRecent('b')
    const result = useCommandRegistry.getState().search('')
    // 'b' should come before 'a' since it's recent
    const bIdx = result.findIndex(c => c.id === 'b')
    const aIdx = result.findIndex(c => c.id === 'a')
    expect(bIdx).toBeLessThan(aIdx)
  })
})
```

- [ ] **Step 2: Implement the registry store**

Create `src/renderer/src/stores/commandRegistry.ts`:

```typescript
import { create } from 'zustand'

export type CommandCategory = 'navigation' | 'action' | 'panel' | 'session' | 'task' | 'review' | 'filter' | 'settings'

export interface RegisteredCommand {
  id: string
  label: string
  category: CommandCategory
  hint?: string
  action: () => void
  source?: string // view that registered it, for cleanup
  keywords?: string[] // extra search terms
  contextMatch?: () => boolean // context-sensitive visibility
}

const CATEGORY_ORDER: CommandCategory[] = [
  'task', 'review', 'action', 'navigation', 'filter', 'panel', 'settings', 'session'
]

const MAX_RECENT = 10

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

interface CommandRegistryState {
  commands: RegisteredCommand[]
  recentIds: string[]
  register: (cmds: RegisteredCommand[]) => void
  unregisterBySource: (source: string) => void
  clear: () => void
  recordRecent: (id: string) => void
  search: (query: string) => RegisteredCommand[]
}

export const useCommandRegistry = create<CommandRegistryState>((set, get) => ({
  commands: [],
  recentIds: [],

  register: (cmds) => {
    set((s) => {
      const existingIds = new Set(s.commands.map(c => c.id))
      const newCmds = cmds.filter(c => !existingIds.has(c.id))
      return { commands: [...s.commands, ...newCmds] }
    })
  },

  unregisterBySource: (source) => {
    set((s) => ({ commands: s.commands.filter(c => c.source !== source) }))
  },

  clear: () => set({ commands: [], recentIds: [] }),

  recordRecent: (id) => {
    set((s) => {
      const filtered = s.recentIds.filter(r => r !== id)
      return { recentIds: [id, ...filtered].slice(0, MAX_RECENT) }
    })
  },

  search: (query) => {
    const { commands, recentIds } = get()
    const visible = commands.filter(c => !c.contextMatch || c.contextMatch())

    let filtered: RegisteredCommand[]
    if (!query) {
      filtered = visible
    } else {
      filtered = visible.filter(c =>
        fuzzyMatch(query, c.label) ||
        (c.keywords?.some(k => fuzzyMatch(query, k)) ?? false)
      )
    }

    // Sort: recent first, then by category order
    const recentSet = new Set(recentIds)
    const catIdx = (cat: CommandCategory) => {
      const i = CATEGORY_ORDER.indexOf(cat)
      return i === -1 ? 999 : i
    }

    return filtered.sort((a, b) => {
      const aRecent = recentSet.has(a.id) ? 0 : 1
      const bRecent = recentSet.has(b.id) ? 0 : 1
      if (aRecent !== bRecent) return aRecent - bRecent
      return catIdx(a.category) - catIdx(b.category)
    })
  },
}))
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/renderer/src/stores/__tests__/commandRegistry.test.ts
```

---

### Task 1.2: Register core commands in CommandPalette

**Files:**
- Modify: `src/renderer/src/components/layout/CommandPalette.tsx`

- [ ] **Step 1: Refactor CommandPalette to use the registry**

Replace the hardcoded `commands` useMemo in `CommandPalette.tsx` with registry consumption. On mount, register the core navigation, action, and panel commands. Use `useCommandRegistry.getState().search(query)` for filtering.

Key changes:
1. Import `useCommandRegistry` from `../../stores/commandRegistry`
2. In the `useEffect` that fires on `open`, call `register()` for core commands (navigation, panel, agent actions) if not already registered
3. Replace the `filtered` useMemo with `useMemo(() => useCommandRegistry.getState().search(query), [query, open])`
4. When a command is executed, call `recordRecent(cmd.id)` before `cmd.action()`
5. Add `CATEGORY_LABELS` entries for new categories: `'task': 'Task Actions'`, `'review': 'Review Actions'`, `'filter': 'Filters'`, `'settings': 'Settings'`
6. Keep the `recentAgents` session commands logic, registering them dynamically on open

- [ ] **Step 2: Update existing CommandPalette tests**

Ensure existing test assertions still pass. The component's rendered output should be identical for existing commands.

```bash
npx vitest run src/renderer/src/components/layout/__tests__/CommandPalette.test.tsx
```

---

### Task 1.3: Register view-specific commands

**Files:**
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/views/CodeReviewView.tsx`

- [ ] **Step 1: Register pipeline commands**

In `SprintPipeline.tsx`, add a `useEffect` that registers pipeline-specific commands on mount and unregisters on unmount:

```typescript
useEffect(() => {
  const { register, unregisterBySource } = useCommandRegistry.getState()
  register([
    {
      id: 'task:create',
      label: 'New Task',
      category: 'task',
      hint: 'Cmd+N',
      source: 'sprint',
      action: () => setView('task-workbench'),
    },
    {
      id: 'task:retry-selected',
      label: 'Retry Selected Task',
      category: 'task',
      source: 'sprint',
      contextMatch: () => !!useSprintUI.getState().selectedTaskId,
      action: () => {
        const id = useSprintUI.getState().selectedTaskId
        if (id) {
          const task = useSprintTasks.getState().tasks.find(t => t.id === id)
          if (task) handleRetry(task)
        }
      },
    },
    {
      id: 'task:launch-selected',
      label: 'Launch Selected Task',
      category: 'task',
      source: 'sprint',
      contextMatch: () => !!useSprintUI.getState().selectedTaskId,
      action: () => {
        const id = useSprintUI.getState().selectedTaskId
        if (id) {
          const task = useSprintTasks.getState().tasks.find(t => t.id === id)
          if (task) launchTask(task)
        }
      },
    },
    {
      id: 'task:search',
      label: 'Search Tasks',
      category: 'filter',
      source: 'sprint',
      action: () => {
        const input = document.querySelector('.pipeline-filter-bar__input') as HTMLInputElement
        input?.focus()
      },
    },
    {
      id: 'filter:status-failed',
      label: 'Show Failed Tasks',
      category: 'filter',
      source: 'sprint',
      action: () => setStatusFilter('failed'),
    },
    {
      id: 'filter:status-active',
      label: 'Show Active Tasks',
      category: 'filter',
      source: 'sprint',
      action: () => setStatusFilter('in-progress'),
    },
    {
      id: 'filter:status-all',
      label: 'Show All Tasks',
      category: 'filter',
      source: 'sprint',
      action: () => setStatusFilter('all'),
    },
  ])
  return () => unregisterBySource('sprint')
}, [setView, setStatusFilter, handleRetry, launchTask])
```

- [ ] **Step 2: Register code review commands**

In `CodeReviewView.tsx`, register review-specific commands:
- `review:merge` — Merge locally (selected task)
- `review:create-pr` — Create PR (selected task)
- `review:revise` — Request revision (selected task)
- `review:discard` — Discard (selected task)
- `review:next` — Select next review item
- `review:prev` — Select previous review item

Use `source: 'code-review'` and clean up on unmount.

- [ ] **Step 3: Register settings navigation commands**

In the core CommandPalette registration (Task 1.2), add settings tab commands:
- `settings:connections`, `settings:repos`, `settings:templates`, `settings:agent`, `settings:agent-manager`, `settings:cost`, `settings:memory`, `settings:appearance`, `settings:about`

Each navigates to Settings view and dispatches a custom event `bde:settings-tab` with the tab index.

- [ ] **Step 4: Full test pass**

```bash
npm test
npm run typecheck
```

---

## Feature 2: Task Tags / Labels

_Estimated scope: 2 days. DB migration, IPC, store changes, UI components._

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/db.ts` | Modify | Migration v24: add `tags TEXT` column |
| `src/main/data/sprint-queries.ts` | Modify | Serialize/deserialize tags, add to allowlist |
| `src/shared/types.ts` | Modify | Add `tags?: string[] \| null` to `SprintTask` |
| `src/renderer/src/components/sprint/TagBadge.tsx` | Create | Color-coded tag badge component |
| `src/renderer/src/components/sprint/__tests__/TagBadge.test.tsx` | Create | Tests for TagBadge |
| `src/renderer/src/components/sprint/TaskPill.tsx` | Modify | Render tag badges |
| `src/renderer/src/components/sprint/PipelineFilterBar.tsx` | Modify | Add tag filter chips |
| `src/renderer/src/components/task-workbench/TagInput.tsx` | Create | Tag input component for WorkbenchForm |
| `src/renderer/src/components/task-workbench/__tests__/TagInput.test.tsx` | Create | Tests for TagInput |
| `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` | Modify | Add TagInput field |
| `src/renderer/src/stores/sprintUI.ts` | Modify | Add `tagFilter: string \| null` state |
| `src/renderer/src/stores/sprintTasks.ts` | Modify | Include tags in CreateTicketInput |
| `src/renderer/src/assets/sprint-pipeline-neon.css` | Modify | Tag badge and filter chip styles |
| `src/renderer/src/assets/task-workbench-neon.css` | Modify | Tag input styles |

---

### Task 2.1: DB migration and query layer

**Files:**
- Modify: `src/main/db.ts`
- Modify: `src/main/data/sprint-queries.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `tags` to SprintTask type**

In `src/shared/types.ts`, add to the `SprintTask` interface after `session_id`:

```typescript
tags?: string[] | null
```

Add `'tags'` to the `GENERAL_PATCH_FIELDS` Set (also in `src/shared/types.ts`).

- [ ] **Step 2: Add migration v24**

In `src/main/db.ts`, add after the v23 migration:

```typescript
{
  version: 24,
  description: 'Add tags column to sprint_tasks',
  up: (db) => {
    const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
    if (!cols.includes('tags')) {
      db.exec('ALTER TABLE sprint_tasks ADD COLUMN tags TEXT')
    }
  }
}
```

- [ ] **Step 3: Update sprint-queries.ts**

Add `'tags'` to the `UPDATE_ALLOWLIST` Set.

In `serializeField()`, add handling for `tags`:

```typescript
if (key === 'tags') {
  return Array.isArray(value) ? JSON.stringify(value) : null
}
```

In `sanitizeTask()`, add tags deserialization:

```typescript
tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags as string[] | null),
```

- [ ] **Step 4: Update CreateTaskInput**

In `src/main/data/sprint-queries.ts`, add `tags?: string[]` to `CreateTaskInput`.

In the `createTask()` function, include `tags` in the INSERT:
- Add `tags` to the column list
- Add `JSON.stringify(input.tags ?? null)` to the values

- [ ] **Step 5: Run main process tests**

```bash
npm run test:main
```

---

### Task 2.2: TagBadge component

**Files:**
- Create: `src/renderer/src/components/sprint/TagBadge.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/TagBadge.test.tsx`

- [ ] **Step 1: Write TagBadge tests**

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TagBadge } from '../TagBadge'

describe('TagBadge', () => {
  it('renders the tag label', () => {
    render(<TagBadge tag="frontend" />)
    expect(screen.getByText('frontend')).toBeInTheDocument()
  })

  it('applies consistent color based on tag string', () => {
    const { container: c1 } = render(<TagBadge tag="frontend" />)
    const { container: c2 } = render(<TagBadge tag="frontend" />)
    const bg1 = (c1.firstChild as HTMLElement).style.getPropertyValue('--tag-hue')
    const bg2 = (c2.firstChild as HTMLElement).style.getPropertyValue('--tag-hue')
    expect(bg1).toBe(bg2)
  })

  it('renders as a button when onClick is provided', () => {
    render(<TagBadge tag="bug" onClick={() => {}} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement TagBadge**

Create `src/renderer/src/components/sprint/TagBadge.tsx`:

```typescript
interface TagBadgeProps {
  tag: string
  onClick?: (tag: string) => void
  active?: boolean
}

/**
 * Deterministic hue from a string -- same tag always gets the same color.
 */
function tagHue(tag: string): number {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 360
}

export function TagBadge({ tag, onClick, active }: TagBadgeProps): React.JSX.Element {
  const hue = tagHue(tag)
  const style = { '--tag-hue': hue } as React.CSSProperties
  const cls = `tag-badge${active ? ' tag-badge--active' : ''}`

  if (onClick) {
    return (
      <button className={cls} style={style} onClick={() => onClick(tag)}>
        {tag}
      </button>
    )
  }
  return <span className={cls} style={style}>{tag}</span>
}
```

- [ ] **Step 3: Add CSS**

In `src/renderer/src/assets/sprint-pipeline-neon.css`, add:

```css
/* -- Tag Badges -- */
.tag-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
  text-transform: lowercase;
  letter-spacing: 0.3px;
  background: hsla(var(--tag-hue), 60%, 50%, 0.15);
  color: hsla(var(--tag-hue), 70%, 70%, 1);
  border: 1px solid hsla(var(--tag-hue), 60%, 50%, 0.25);
  white-space: nowrap;
  cursor: default;
}

button.tag-badge {
  cursor: pointer;
}

.tag-badge--active {
  background: hsla(var(--tag-hue), 60%, 50%, 0.3);
  border-color: hsla(var(--tag-hue), 60%, 50%, 0.5);
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/TagBadge.test.tsx
```

---

### Task 2.3: Add tags to TaskPill

**Files:**
- Modify: `src/renderer/src/components/sprint/TaskPill.tsx`

- [ ] **Step 1: Import and render TagBadge**

After the repo badge in `TaskPill.tsx`, render tags:

```tsx
{task.tags && task.tags.length > 0 && (
  <span className="task-pill__tags">
    {task.tags.slice(0, 2).map(tag => (
      <TagBadge key={tag} tag={tag} />
    ))}
    {task.tags.length > 2 && (
      <span className="task-pill__tags-overflow">+{task.tags.length - 2}</span>
    )}
  </span>
)}
```

- [ ] **Step 2: Add CSS for task-pill__tags**

In `sprint-pipeline-neon.css`:

```css
.task-pill__tags {
  display: flex;
  gap: 3px;
  margin-left: 4px;
  overflow: hidden;
}

.task-pill__tags-overflow {
  font-size: 9px;
  color: var(--neon-text-dim);
}
```

---

### Task 2.4: Tag filter in PipelineFilterBar

**Files:**
- Modify: `src/renderer/src/stores/sprintUI.ts`
- Modify: `src/renderer/src/components/sprint/PipelineFilterBar.tsx`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`

- [ ] **Step 1: Add tagFilter to sprintUI store**

In `src/renderer/src/stores/sprintUI.ts`, add:

```typescript
// In interface SprintUIState:
tagFilter: string | null
setTagFilter: (tag: string | null) => void

// In create():
tagFilter: null,
setTagFilter: (tag): void => set({ tagFilter: tag }),
```

- [ ] **Step 2: Add tag chips to PipelineFilterBar**

In `PipelineFilterBar.tsx`:

1. Import `TagBadge` from `./TagBadge`
2. Compute unique tags from all tasks: `const allTags = useMemo(() => { const s = new Set<string>(); tasks.forEach(t => t.tags?.forEach(tag => s.add(tag))); return Array.from(s).sort() }, [tasks])`
3. Read `tagFilter` and `setTagFilter` from `useSprintUI`
4. Render tag chips section after repo chips (only when `allTags.length > 0`):

```tsx
{allTags.length > 0 && (
  <div className="pipeline-filter-bar__chips">
    {allTags.map(tag => (
      <TagBadge
        key={tag}
        tag={tag}
        active={tagFilter === tag}
        onClick={(t) => setTagFilter(tagFilter === t ? null : t)}
      />
    ))}
  </div>
)}
```

5. Update the `if (repos.length <= 1 && !searchQuery) return null` guard to also show when tags exist:
   `if (repos.length <= 1 && !searchQuery && allTags.length === 0) return null`

- [ ] **Step 3: Apply tag filter in SprintPipeline**

In `SprintPipeline.tsx`, in the `filteredTasks` useMemo, add after the search filter:

```typescript
const tagFilter = useSprintUI((s) => s.tagFilter)

// Inside filteredTasks useMemo:
if (tagFilter) result = result.filter(t => t.tags?.includes(tagFilter))
```

---

### Task 2.5: Tag input in WorkbenchForm

**Files:**
- Create: `src/renderer/src/components/task-workbench/TagInput.tsx`
- Create: `src/renderer/src/components/task-workbench/__tests__/TagInput.test.tsx`
- Modify: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`
- Modify: `src/renderer/src/stores/taskWorkbench.ts` (add `tags` field)
- Modify: `src/renderer/src/stores/sprintTasks.ts` (add `tags` to CreateTicketInput)

- [ ] **Step 1: Write TagInput tests**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TagInput } from '../TagInput'

describe('TagInput', () => {
  it('renders existing tags', () => {
    render(<TagInput tags={['bug', 'frontend']} onChange={() => {}} />)
    expect(screen.getByText('bug')).toBeInTheDocument()
    expect(screen.getByText('frontend')).toBeInTheDocument()
  })

  it('adds a tag on Enter', () => {
    const onChange = vi.fn()
    render(<TagInput tags={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Add tag...')
    fireEvent.change(input, { target: { value: 'newTag' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['newtag'])
  })

  it('removes a tag on click', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['bug', 'frontend']} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Remove bug'))
    expect(onChange).toHaveBeenCalledWith(['frontend'])
  })

  it('prevents duplicate tags', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['bug']} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Add tag...')
    fireEvent.change(input, { target: { value: 'bug' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Implement TagInput**

Create `src/renderer/src/components/task-workbench/TagInput.tsx`:

```typescript
import { useState, useCallback } from 'react'
import { X } from 'lucide-react'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
}

export function TagInput({ tags, onChange }: TagInputProps): React.JSX.Element {
  const [input, setInput] = useState('')

  const addTag = useCallback(() => {
    const tag = input.trim().toLowerCase()
    if (!tag || tags.includes(tag)) return
    onChange([...tags, tag])
    setInput('')
  }, [input, tags, onChange])

  const removeTag = useCallback((tag: string) => {
    onChange(tags.filter(t => t !== tag))
  }, [tags, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }, [addTag, input, tags, removeTag])

  return (
    <div className="wb-tag-input">
      {tags.map(tag => (
        <span key={tag} className="wb-tag-input__tag">
          {tag}
          <button
            className="wb-tag-input__remove"
            onClick={() => removeTag(tag)}
            aria-label={`Remove ${tag}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add tag..."
        className="wb-tag-input__input"
      />
    </div>
  )
}
```

- [ ] **Step 3: Wire into WorkbenchForm**

In `WorkbenchForm.tsx`:
1. Import `TagInput` from `./TagInput`
2. Read `tags` from `useTaskWorkbenchStore`
3. Inside the `advancedOpen` section (after the Playground checkbox), add:

```tsx
<div className="wb-form__field">
  <label className="wb-form__label">Tags</label>
  <TagInput
    tags={tags ?? []}
    onChange={(t) => setField('tags', t)}
  />
</div>
```

4. Include `tags` in the `CreateTicketInput` passed to `createTask()`.

- [ ] **Step 4: Add CSS**

In `src/renderer/src/assets/task-workbench-neon.css`:

```css
.wb-tag-input {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  background: var(--neon-surface-deep);
  border: 1px solid var(--neon-border);
  border-radius: 4px;
  min-height: 32px;
  align-items: center;
}

.wb-tag-input__tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  background: var(--neon-cyan-surface);
  color: var(--neon-cyan);
  border: 1px solid var(--neon-cyan-border);
}

.wb-tag-input__remove {
  background: none;
  border: none;
  color: var(--neon-text-dim);
  cursor: pointer;
  padding: 0;
  display: flex;
}

.wb-tag-input__input {
  flex: 1;
  min-width: 80px;
  background: none;
  border: none;
  color: var(--neon-text);
  font-size: 12px;
  outline: none;
}
```

- [ ] **Step 5: Full test pass**

```bash
npm test
npm run typecheck
npm run lint
```

---

## Feature 3: Morning Briefing

_Estimated scope: 1-2 days. Renderer-only feature using existing task data and a localStorage timestamp._

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/src/components/dashboard/MorningBriefing.tsx` | Create | Briefing card component |
| `src/renderer/src/components/dashboard/__tests__/MorningBriefing.test.tsx` | Create | Tests |
| `src/renderer/src/views/DashboardView.tsx` | Modify | Mount MorningBriefing at top |
| `src/renderer/src/assets/dashboard-neon.css` | Modify | Briefing card styles |

---

### Task 3.1: MorningBriefing component

**Files:**
- Create: `src/renderer/src/components/dashboard/MorningBriefing.tsx`
- Create: `src/renderer/src/components/dashboard/__tests__/MorningBriefing.test.tsx`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MorningBriefing } from '../MorningBriefing'

const mockSetView = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('MorningBriefing', () => {
  it('shows nothing when no tasks completed since last session', () => {
    localStorage.setItem('bde:last-window-close', String(Date.now()))
    const { container } = render(
      <MorningBriefing tasks={[]} onNavigate={mockSetView} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows briefing when tasks completed since last close', () => {
    const lastClose = Date.now() - 3600_000
    localStorage.setItem('bde:last-window-close', String(lastClose))
    const tasks = [
      { id: '1', status: 'done', completed_at: new Date().toISOString() },
      { id: '2', status: 'failed', completed_at: new Date().toISOString() },
      { id: '3', status: 'review', completed_at: null },
    ] as any[]
    render(<MorningBriefing tasks={tasks} onNavigate={mockSetView} />)
    expect(screen.getByText(/1 completed/)).toBeInTheDocument()
    expect(screen.getByText(/1 failed/)).toBeInTheDocument()
  })

  it('dismisses on button click', () => {
    localStorage.setItem('bde:last-window-close', String(Date.now() - 3600_000))
    const tasks = [
      { id: '1', status: 'done', completed_at: new Date().toISOString() },
    ] as any[]
    render(<MorningBriefing tasks={tasks} onNavigate={mockSetView} />)
    fireEvent.click(screen.getByText('Dismiss'))
    expect(screen.queryByText(/completed/)).toBeNull()
  })

  it('navigates to review on Review All click', () => {
    localStorage.setItem('bde:last-window-close', String(Date.now() - 3600_000))
    const tasks = [
      { id: '1', status: 'review', completed_at: null },
    ] as any[]
    render(<MorningBriefing tasks={tasks} onNavigate={mockSetView} />)
    fireEvent.click(screen.getByText('Review All'))
    expect(mockSetView).toHaveBeenCalledWith('code-review')
  })
})
```

- [ ] **Step 2: Implement MorningBriefing**

Create `src/renderer/src/components/dashboard/MorningBriefing.tsx`:

```typescript
import { useState, useMemo, useEffect } from 'react'
import { Sun, X } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'
import type { View } from '../../stores/panelLayout'

const LAST_CLOSE_KEY = 'bde:last-window-close'

interface MorningBriefingProps {
  tasks: SprintTask[]
  onNavigate: (view: View) => void
}

export function MorningBriefing({ tasks, onNavigate }: MorningBriefingProps): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false)

  // Record window close time on unmount / beforeunload
  useEffect(() => {
    const handler = () => localStorage.setItem(LAST_CLOSE_KEY, String(Date.now()))
    window.addEventListener('beforeunload', handler)
    return () => {
      handler()
      window.removeEventListener('beforeunload', handler)
    }
  }, [])

  const lastClose = useMemo(() => {
    const stored = localStorage.getItem(LAST_CLOSE_KEY)
    return stored ? parseInt(stored, 10) : null
  }, [])

  const stats = useMemo(() => {
    if (!lastClose) return null
    const since = new Date(lastClose).toISOString()
    const completed = tasks.filter(
      t => t.status === 'done' && t.completed_at && t.completed_at > since
    ).length
    const failed = tasks.filter(
      t => (t.status === 'failed' || t.status === 'error') &&
           t.completed_at && t.completed_at > since
    ).length
    const reviewing = tasks.filter(t => t.status === 'review').length
    if (completed === 0 && failed === 0 && reviewing === 0) return null
    return { completed, failed, reviewing }
  }, [tasks, lastClose])

  if (dismissed || !stats) return null

  const parts: string[] = []
  if (stats.completed > 0) parts.push(`${stats.completed} completed`)
  if (stats.failed > 0) parts.push(`${stats.failed} failed`)
  if (stats.reviewing > 0) parts.push(`${stats.reviewing} awaiting review`)

  return (
    <div className="dashboard-briefing">
      <Sun size={16} className="dashboard-briefing__icon" />
      <span className="dashboard-briefing__text">
        Since last session: {parts.join(', ')}.
      </span>
      <div className="dashboard-briefing__actions">
        {stats.reviewing > 0 && (
          <button
            className="dashboard-briefing__btn dashboard-briefing__btn--primary"
            onClick={() => onNavigate('code-review')}
          >
            Review All
          </button>
        )}
        <button
          className="dashboard-briefing__btn"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount in DashboardView**

In `DashboardView.tsx`, import and render `<MorningBriefing tasks={tasks} onNavigate={setView} />` at the top of the view, before `StatusCounters`.

- [ ] **Step 4: Add CSS**

In `src/renderer/src/assets/dashboard-neon.css`:

```css
/* -- Morning Briefing -- */
.dashboard-briefing {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  margin: 8px 16px 0;
  background: var(--neon-cyan-surface);
  border: 1px solid var(--neon-cyan-border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--neon-text);
}

.dashboard-briefing__icon {
  color: var(--neon-cyan);
  flex-shrink: 0;
}

.dashboard-briefing__text {
  flex: 1;
}

.dashboard-briefing__actions {
  display: flex;
  gap: 6px;
}

.dashboard-briefing__btn {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  border: 1px solid var(--neon-border);
  background: var(--neon-surface-deep);
  color: var(--neon-text);
  cursor: pointer;
}

.dashboard-briefing__btn--primary {
  background: var(--neon-cyan-surface);
  border-color: var(--neon-cyan-border);
  color: var(--neon-cyan);
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/renderer/src/components/dashboard/__tests__/MorningBriefing.test.tsx
npm test
npm run typecheck
```

---

## Feature 4: Floating Agent Monitor

_Estimated scope: 2-3 days. Renderer-only component using existing `agentManager:status` IPC._

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/src/components/layout/AgentMonitor.tsx` | Create | Floating monitor widget |
| `src/renderer/src/components/layout/__tests__/AgentMonitor.test.tsx` | Create | Tests |
| `src/renderer/src/App.tsx` | Modify | Mount AgentMonitor globally |
| `src/renderer/src/assets/neon-shell.css` | Modify | Monitor widget styles |

---

### Task 4.1: AgentMonitor component

**Files:**
- Create: `src/renderer/src/components/layout/AgentMonitor.tsx`
- Create: `src/renderer/src/components/layout/__tests__/AgentMonitor.test.tsx`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { AgentMonitor } from '../AgentMonitor'

const mockStatus = {
  running: true,
  shuttingDown: false,
  concurrency: {
    maxSlots: 5, effectiveSlots: 5, activeCount: 2,
    recoveryDueAt: null, consecutiveRateLimits: 0, atFloor: false
  },
  activeAgents: [
    {
      taskId: 'task-1', agentRunId: 'run-1', model: 'claude-sonnet-4-5',
      startedAt: Date.now() - 120_000, lastOutputAt: Date.now(),
      rateLimitCount: 0, costUsd: 0.12, tokensIn: 5000, tokensOut: 2000
    },
    {
      taskId: 'task-2', agentRunId: 'run-2', model: 'claude-sonnet-4-5',
      startedAt: Date.now() - 60_000, lastOutputAt: Date.now(),
      rateLimitCount: 0, costUsd: 0.05, tokensIn: 2000, tokensOut: 1000
    },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).api = {
    agentManager: { getStatus: vi.fn().mockResolvedValue(mockStatus) }
  }
})

describe('AgentMonitor', () => {
  it('shows agent count when collapsed', async () => {
    await act(async () => {
      render(<AgentMonitor />)
    })
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('expands on click to show details', async () => {
    await act(async () => {
      render(<AgentMonitor />)
    })
    fireEvent.click(screen.getByRole('button', { name: /agent monitor/i }))
    expect(screen.getByText(/\$0\.12/)).toBeInTheDocument()
  })

  it('hides when no agents running', async () => {
    ;(window as any).api.agentManager.getStatus = vi.fn().mockResolvedValue({
      ...mockStatus,
      concurrency: { ...mockStatus.concurrency, activeCount: 0 },
      activeAgents: []
    })
    let container: HTMLElement
    await act(async () => {
      const result = render(<AgentMonitor />)
      container = result.container
    })
    expect(container!.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Implement AgentMonitor**

Create `src/renderer/src/components/layout/AgentMonitor.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { Bot, ChevronUp, ChevronDown } from 'lucide-react'
import type { AgentManagerActiveAgent } from '../../../../shared/types'
import { formatDurationMs } from '../../lib/format'

function AgentRow({ agent }: { agent: AgentManagerActiveAgent }): React.JSX.Element {
  const elapsed = Date.now() - agent.startedAt
  return (
    <div className="agent-monitor__row">
      <span className="agent-monitor__task-id" title={agent.taskId}>
        {agent.taskId.slice(0, 8)}
      </span>
      <span className="agent-monitor__elapsed">{formatDurationMs(elapsed)}</span>
      <span className="agent-monitor__cost">${agent.costUsd.toFixed(2)}</span>
    </div>
  )
}

export function AgentMonitor(): React.JSX.Element | null {
  const [status, setStatus] = useState<{
    concurrency: { activeCount: number }
    activeAgents: AgentManagerActiveAgent[]
  } | null>(null)
  const [expanded, setExpanded] = useState(false)

  const poll = useCallback(async () => {
    try {
      const s = await window.api.agentManager.getStatus()
      setStatus(s)
    } catch {
      // ignore -- agent manager may not be running
    }
  }, [])

  useEffect(() => {
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [poll])

  if (!status || status.concurrency.activeCount === 0) return null

  const totalCost = status.activeAgents.reduce((sum, a) => sum + a.costUsd, 0)

  return (
    <div className={`agent-monitor${expanded ? ' agent-monitor--expanded' : ''}`}>
      <button
        className="agent-monitor__toggle"
        onClick={() => setExpanded(!expanded)}
        aria-label="Agent monitor"
      >
        <Bot size={14} />
        <span className="agent-monitor__count">{status.concurrency.activeCount}</span>
        <span className="agent-monitor__total-cost">${totalCost.toFixed(2)}</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
      {expanded && (
        <div className="agent-monitor__details">
          {status.activeAgents.map(agent => (
            <AgentRow key={agent.agentRunId} agent={agent} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Mount in App.tsx**

In `App.tsx`, after the `<ToastContainer />`, add:

```tsx
<AgentMonitor />
```

Import from `./components/layout/AgentMonitor`.

- [ ] **Step 4: Add CSS**

In `src/renderer/src/assets/neon-shell.css`:

```css
/* -- Floating Agent Monitor -- */
.agent-monitor {
  position: fixed;
  bottom: 32px;
  right: 16px;
  z-index: 50;
  font-family: var(--bde-font-code);
}

.agent-monitor__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 20px;
  background: var(--neon-surface);
  border: 1px solid var(--neon-cyan-border);
  color: var(--neon-cyan);
  cursor: pointer;
  font-size: 11px;
  box-shadow: var(--bde-shadow-md);
}

.agent-monitor__count {
  font-weight: 700;
  min-width: 14px;
  text-align: center;
}

.agent-monitor__total-cost {
  color: var(--neon-text-dim);
  font-size: 10px;
}

.agent-monitor__details {
  margin-top: 4px;
  background: var(--neon-surface);
  border: 1px solid var(--neon-border);
  border-radius: 8px;
  padding: 8px;
  box-shadow: var(--bde-shadow-lg);
  min-width: 200px;
}

.agent-monitor__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 10px;
  color: var(--neon-text);
  border-bottom: 1px solid var(--neon-border);
}

.agent-monitor__row:last-child {
  border-bottom: none;
}

.agent-monitor__task-id {
  font-family: var(--bde-font-code);
  color: var(--neon-cyan);
}

.agent-monitor__elapsed {
  color: var(--neon-text-dim);
}

.agent-monitor__cost {
  color: var(--neon-orange);
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/renderer/src/components/layout/__tests__/AgentMonitor.test.tsx
npm test
npm run typecheck
```

---

## Feature 5: Task Search Query Language

_Estimated scope: 2-3 days. Pure renderer -- parser + predicate system replaces simple text search._

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/src/lib/task-query.ts` | Create | Query parser + predicate builder |
| `src/renderer/src/lib/__tests__/task-query.test.ts` | Create | Parser tests (heavily tested) |
| `src/renderer/src/components/sprint/PipelineFilterBar.tsx` | Modify | Use query parser for search input |
| `src/renderer/src/stores/sprintUI.ts` | Modify | Update searchQuery usage |

---

### Task 5.1: Query parser

**Files:**
- Create: `src/renderer/src/lib/task-query.ts`
- Create: `src/renderer/src/lib/__tests__/task-query.test.ts`

- [ ] **Step 1: Write comprehensive parser tests**

```typescript
import { describe, it, expect } from 'vitest'
import { parseTaskQuery, matchesQuery } from '../task-query'
import type { SprintTask } from '../../../../shared/types'

const baseTask: SprintTask = {
  id: 'test-1', title: 'Fix auth flow', repo: 'bde', prompt: null,
  priority: 2, status: 'failed', notes: null, spec: null, retry_count: 0,
  fast_fail_count: 0, agent_run_id: null, pr_number: null, pr_status: null,
  pr_url: null, claimed_by: null, started_at: null, completed_at: null,
  template_name: null, depends_on: null, tags: ['frontend', 'auth'],
  updated_at: '2026-04-01T00:00:00Z', created_at: '2026-03-30T00:00:00Z',
}

describe('parseTaskQuery', () => {
  it('parses empty string to no predicates', () => {
    const q = parseTaskQuery('')
    expect(q.predicates).toHaveLength(0)
    expect(q.freeText).toBe('')
  })

  it('parses status:failed', () => {
    const q = parseTaskQuery('status:failed')
    expect(q.predicates).toHaveLength(1)
    expect(q.predicates[0]).toEqual({ field: 'status', op: 'eq', value: 'failed' })
  })

  it('parses repo:bde', () => {
    const q = parseTaskQuery('repo:bde')
    expect(q.predicates[0]).toEqual({ field: 'repo', op: 'eq', value: 'bde' })
  })

  it('parses priority:<=2', () => {
    const q = parseTaskQuery('priority:<=2')
    expect(q.predicates[0]).toEqual({ field: 'priority', op: 'lte', value: 2 })
  })

  it('parses priority:>3', () => {
    const q = parseTaskQuery('priority:>3')
    expect(q.predicates[0]).toEqual({ field: 'priority', op: 'gt', value: 3 })
  })

  it('parses tag:frontend', () => {
    const q = parseTaskQuery('tag:frontend')
    expect(q.predicates[0]).toEqual({ field: 'tag', op: 'eq', value: 'frontend' })
  })

  it('parses created:>7d as relative date', () => {
    const q = parseTaskQuery('created:>7d')
    expect(q.predicates[0].field).toBe('created')
    expect(q.predicates[0].op).toBe('gt')
    expect(typeof q.predicates[0].value).toBe('string') // ISO date
  })

  it('parses quoted free text', () => {
    const q = parseTaskQuery('"auth flow"')
    expect(q.freeText).toBe('auth flow')
  })

  it('parses mixed query', () => {
    const q = parseTaskQuery('status:failed repo:bde "auth"')
    expect(q.predicates).toHaveLength(2)
    expect(q.freeText).toBe('auth')
  })
})

describe('matchesQuery', () => {
  it('matches status:failed against failed task', () => {
    const q = parseTaskQuery('status:failed')
    expect(matchesQuery(baseTask, q)).toBe(true)
  })

  it('does not match status:done against failed task', () => {
    const q = parseTaskQuery('status:done')
    expect(matchesQuery(baseTask, q)).toBe(false)
  })

  it('matches tag:frontend', () => {
    const q = parseTaskQuery('tag:frontend')
    expect(matchesQuery(baseTask, q)).toBe(true)
  })

  it('does not match tag:backend', () => {
    const q = parseTaskQuery('tag:backend')
    expect(matchesQuery(baseTask, q)).toBe(false)
  })

  it('matches priority:<=2', () => {
    const q = parseTaskQuery('priority:<=2')
    expect(matchesQuery(baseTask, q)).toBe(true)
  })

  it('matches free text in title', () => {
    const q = parseTaskQuery('"auth"')
    expect(matchesQuery(baseTask, q)).toBe(true)
  })

  it('handles empty query (matches everything)', () => {
    const q = parseTaskQuery('')
    expect(matchesQuery(baseTask, q)).toBe(true)
  })
})
```

- [ ] **Step 2: Implement parser**

Create `src/renderer/src/lib/task-query.ts`:

```typescript
import type { SprintTask } from '../../../shared/types'

type Op = 'eq' | 'lt' | 'lte' | 'gt' | 'gte'

interface Predicate {
  field: string
  op: Op
  value: string | number
}

export interface ParsedQuery {
  predicates: Predicate[]
  freeText: string
}

const FIELD_PATTERN = /^(status|repo|priority|tag|created):(.+)$/
const OP_PATTERN = /^(<=|>=|<|>)?(.+)$/
const RELATIVE_DATE_PATTERN = /^(\d+)([dhwm])$/

function parseRelativeDate(value: string): string | null {
  const match = value.match(RELATIVE_DATE_PATTERN)
  if (!match) return null
  const amount = parseInt(match[1], 10)
  const unit = match[2]
  const ms = { d: 86400000, h: 3600000, w: 604800000, m: 2592000000 }[unit] ?? 86400000
  return new Date(Date.now() - amount * ms).toISOString()
}

function parseOp(raw: string): { op: Op; value: string } {
  const m = raw.match(OP_PATTERN)!
  const opStr = m[1] ?? ''
  const val = m[2]
  const op: Op = opStr === '<='
    ? 'lte' : opStr === '>='
    ? 'gte' : opStr === '<'
    ? 'lt' : opStr === '>'
    ? 'gt' : 'eq'
  return { op, value: val }
}

export function parseTaskQuery(input: string): ParsedQuery {
  const predicates: Predicate[] = []
  let freeText = ''

  // Extract quoted strings
  const quoteMatch = input.match(/"([^"]*)"/)
  if (quoteMatch) {
    freeText = quoteMatch[1]
    input = input.replace(quoteMatch[0], '').trim()
  }

  const tokens = input.split(/\s+/).filter(Boolean)

  for (const token of tokens) {
    const fieldMatch = token.match(FIELD_PATTERN)
    if (fieldMatch) {
      const field = fieldMatch[1]
      const rawValue = fieldMatch[2]

      if (field === 'priority') {
        const { op, value } = parseOp(rawValue)
        predicates.push({ field, op, value: parseInt(value, 10) })
      } else if (field === 'created') {
        const { op } = parseOp(rawValue)
        const dateVal = parseRelativeDate(rawValue.replace(/^(<=|>=|<|>)/, ''))
        if (dateVal) {
          predicates.push({ field, op, value: dateVal })
        }
      } else {
        predicates.push({ field, op: 'eq', value: rawValue })
      }
    } else if (!freeText) {
      freeText = (freeText ? freeText + ' ' : '') + token
    }
  }

  return { predicates, freeText }
}

export function matchesQuery(task: SprintTask, query: ParsedQuery): boolean {
  for (const pred of query.predicates) {
    switch (pred.field) {
      case 'status':
        if (task.status !== pred.value) return false
        break
      case 'repo':
        if (task.repo.toLowerCase() !== String(pred.value).toLowerCase()) return false
        break
      case 'priority': {
        const pv = pred.value as number
        if (pred.op === 'eq' && task.priority !== pv) return false
        if (pred.op === 'lt' && task.priority >= pv) return false
        if (pred.op === 'lte' && task.priority > pv) return false
        if (pred.op === 'gt' && task.priority <= pv) return false
        if (pred.op === 'gte' && task.priority < pv) return false
        break
      }
      case 'tag':
        if (!task.tags?.includes(String(pred.value))) return false
        break
      case 'created': {
        const taskDate = task.created_at
        const threshold = String(pred.value)
        if (pred.op === 'gt' && taskDate <= threshold) return false
        if (pred.op === 'lt' && taskDate >= threshold) return false
        if (pred.op === 'gte' && taskDate < threshold) return false
        if (pred.op === 'lte' && taskDate > threshold) return false
        break
      }
    }
  }

  if (query.freeText) {
    const lower = query.freeText.toLowerCase()
    if (!task.title.toLowerCase().includes(lower)) return false
  }

  return true
}
```

- [ ] **Step 3: Run parser tests**

```bash
npx vitest run src/renderer/src/lib/__tests__/task-query.test.ts
```

---

### Task 5.2: Integrate query parser into pipeline filtering

**Files:**
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/components/sprint/PipelineFilterBar.tsx`

- [ ] **Step 1: Replace simple text search with query parser**

In `SprintPipeline.tsx`, update the `filteredTasks` useMemo:

```typescript
import { parseTaskQuery, matchesQuery } from '../../lib/task-query'

// Inside filteredTasks useMemo, replace the simple searchQuery filter:
if (searchQuery) {
  const parsed = parseTaskQuery(searchQuery)
  result = result.filter(t => matchesQuery(t, parsed))
}
```

Remove the separate `tagFilter` application if Feature 2 is already implemented (the `tag:` prefix in the query language supersedes it), or keep both for convenience.

- [ ] **Step 2: Update PipelineFilterBar placeholder**

Change the search input placeholder from `"Search tasks..."` to `"Search... (status:failed tag:x priority:<=2)"` to hint at the query language.

- [ ] **Step 3: Run full test suite**

```bash
npm test
npm run typecheck
npm run lint
```

---

## Feature 6: Settings Profiles

_Estimated scope: 2-3 days. New SQLite table, IPC handlers, Settings UI tab, command palette integration._

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/db.ts` | Modify | Migration v25: `settings_profiles` table |
| `src/main/data/settings-profiles.ts` | Create | CRUD queries for profiles |
| `src/main/data/__tests__/settings-profiles.test.ts` | Create | Tests for profile queries |
| `src/main/handlers/settings-profiles.ts` | Create | IPC handlers |
| `src/main/index.ts` | Modify | Register profile handlers |
| `src/preload/index.ts` | Modify | Expose profile API |
| `src/preload/index.d.ts` | Modify | Type declarations |
| `src/shared/ipc-channels.ts` | Modify | Add profile channels |
| `src/renderer/src/components/settings/ProfilesSection.tsx` | Create | Profile management UI |
| `src/renderer/src/components/settings/__tests__/ProfilesSection.test.tsx` | Create | Tests |
| `src/renderer/src/assets/neon-shell.css` | Modify | Profile card styles |

---

### Task 6.1: Profile data layer

**Files:**
- Modify: `src/main/db.ts`
- Create: `src/main/data/settings-profiles.ts`
- Create: `src/main/data/__tests__/settings-profiles.test.ts`

- [ ] **Step 1: Add migration v25**

In `src/main/db.ts`, add:

```typescript
{
  version: 25,
  description: 'Add settings_profiles table',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings_profiles (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name        TEXT NOT NULL UNIQUE,
        settings    TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `)
  }
}
```

- [ ] **Step 2: Write profile queries tests**

Create `src/main/data/__tests__/settings-profiles.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import {
  createProfile, listProfiles, getProfile, deleteProfile, applyProfile
} from '../settings-profiles'

let db: Database.Database

beforeAll(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE settings_profiles (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL UNIQUE,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)
  `)
})

afterAll(() => db.close())

describe('settings-profiles', () => {
  it('creates a profile', () => {
    const profile = createProfile(db, 'solo-dev', {
      'agentManager.maxConcurrent': '2',
      'agentManager.defaultModel': 'claude-sonnet-4-5',
    })
    expect(profile.name).toBe('solo-dev')
  })

  it('lists profiles', () => {
    const profiles = listProfiles(db)
    expect(profiles.length).toBeGreaterThanOrEqual(1)
  })

  it('gets a profile by id', () => {
    const profiles = listProfiles(db)
    const profile = getProfile(db, profiles[0].id)
    expect(profile?.name).toBe('solo-dev')
  })

  it('applies a profile to settings', () => {
    const profiles = listProfiles(db)
    applyProfile(db, profiles[0].id)
    const row = db.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).get('agentManager.maxConcurrent') as { value: string } | undefined
    expect(row?.value).toBe('2')
  })

  it('deletes a profile', () => {
    const profiles = listProfiles(db)
    deleteProfile(db, profiles[0].id)
    expect(listProfiles(db)).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Implement profile queries**

Create `src/main/data/settings-profiles.ts`:

```typescript
import type Database from 'better-sqlite3'

export interface SettingsProfile {
  id: string
  name: string
  settings: Record<string, string>
  created_at: string
  updated_at: string
}

function deserialize(row: Record<string, unknown>): SettingsProfile {
  return {
    ...row,
    settings: JSON.parse(row.settings as string),
  } as SettingsProfile
}

export function createProfile(
  db: Database.Database,
  name: string,
  settings: Record<string, string>
): SettingsProfile {
  const row = db.prepare(
    `INSERT INTO settings_profiles (name, settings) VALUES (?, ?) RETURNING *`
  ).get(name, JSON.stringify(settings)) as Record<string, unknown>
  return deserialize(row)
}

export function listProfiles(db: Database.Database): SettingsProfile[] {
  const rows = db.prepare(
    'SELECT * FROM settings_profiles ORDER BY name ASC'
  ).all() as Record<string, unknown>[]
  return rows.map(deserialize)
}

export function getProfile(
  db: Database.Database,
  id: string
): SettingsProfile | null {
  const row = db.prepare(
    'SELECT * FROM settings_profiles WHERE id = ?'
  ).get(id) as Record<string, unknown> | undefined
  return row ? deserialize(row) : null
}

export function deleteProfile(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM settings_profiles WHERE id = ?').run(id)
}

export function applyProfile(db: Database.Database, profileId: string): void {
  const profile = getProfile(db, profileId)
  if (!profile) throw new Error(`Profile not found: ${profileId}`)

  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )

  const apply = db.transaction(() => {
    for (const [key, value] of Object.entries(profile.settings)) {
      upsert.run(key, value)
    }
  })
  apply()
}

export function updateProfile(
  db: Database.Database,
  id: string,
  name: string,
  settings: Record<string, string>
): SettingsProfile | null {
  const row = db.prepare(
    `UPDATE settings_profiles SET name = ?, settings = ?,
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? RETURNING *`
  ).get(name, JSON.stringify(settings), id) as Record<string, unknown> | undefined
  return row ? deserialize(row) : null
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:main
```

---

### Task 6.2: IPC handlers and preload

**Files:**
- Create: `src/main/handlers/settings-profiles.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Add IPC channels**

In `src/shared/ipc-channels.ts`, add:

```typescript
'settings:profiles:list',
'settings:profiles:create',
'settings:profiles:delete',
'settings:profiles:apply',
'settings:profiles:update',
```

- [ ] **Step 2: Create IPC handler module**

Create `src/main/handlers/settings-profiles.ts`:

```typescript
import { safeHandle } from '../safe-handle'
import { getDb } from '../db'
import {
  listProfiles, createProfile, deleteProfile, applyProfile, updateProfile
} from '../data/settings-profiles'

export function registerSettingsProfileHandlers(): void {
  safeHandle('settings:profiles:list', () => listProfiles(getDb()))

  safeHandle('settings:profiles:create', (
    _e, { name, settings }: { name: string; settings: Record<string, string> }
  ) => createProfile(getDb(), name, settings))

  safeHandle('settings:profiles:delete', (_e, id: string) => {
    deleteProfile(getDb(), id)
    return { ok: true }
  })

  safeHandle('settings:profiles:apply', (_e, id: string) => {
    applyProfile(getDb(), id)
    return { ok: true }
  })

  safeHandle('settings:profiles:update', (
    _e,
    { id, name, settings }: { id: string; name: string; settings: Record<string, string> }
  ) => updateProfile(getDb(), id, name, settings))
}
```

- [ ] **Step 3: Register in index.ts**

In `src/main/index.ts`, import and call `registerSettingsProfileHandlers()`.

- [ ] **Step 4: Update preload**

In `src/preload/index.ts`, add under the settings namespace (or create `settingsProfiles`):

```typescript
settingsProfiles: {
  list: () => ipcRenderer.invoke('settings:profiles:list'),
  create: (data: { name: string; settings: Record<string, string> }) =>
    ipcRenderer.invoke('settings:profiles:create', data),
  delete: (id: string) => ipcRenderer.invoke('settings:profiles:delete', id),
  apply: (id: string) => ipcRenderer.invoke('settings:profiles:apply', id),
  update: (data: { id: string; name: string; settings: Record<string, string> }) =>
    ipcRenderer.invoke('settings:profiles:update', data),
},
```

Update `src/preload/index.d.ts` with matching type declarations.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

---

### Task 6.3: Settings Profiles UI

**Files:**
- Create: `src/renderer/src/components/settings/ProfilesSection.tsx`
- Create: `src/renderer/src/components/settings/__tests__/ProfilesSection.test.tsx`

- [ ] **Step 1: Write ProfilesSection tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProfilesSection } from '../ProfilesSection'

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).api = {
    settingsProfiles: {
      list: vi.fn().mockResolvedValue([
        { id: 'p1', name: 'Solo Dev', settings: { 'agentManager.maxConcurrent': '2' } },
        { id: 'p2', name: 'Sweep Mode', settings: { 'agentManager.maxConcurrent': '5' } },
      ]),
      create: vi.fn().mockResolvedValue({ id: 'p3', name: 'New', settings: {} }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
      apply: vi.fn().mockResolvedValue({ ok: true }),
    }
  }
})

describe('ProfilesSection', () => {
  it('renders profile list', async () => {
    render(<ProfilesSection />)
    await waitFor(() => {
      expect(screen.getByText('Solo Dev')).toBeInTheDocument()
      expect(screen.getByText('Sweep Mode')).toBeInTheDocument()
    })
  })

  it('applies a profile on click', async () => {
    render(<ProfilesSection />)
    await waitFor(() => screen.getByText('Solo Dev'))
    fireEvent.click(screen.getAllByText('Apply')[0])
    await waitFor(() => {
      expect(window.api.settingsProfiles.apply).toHaveBeenCalledWith('p1')
    })
  })

  it('deletes a profile', async () => {
    render(<ProfilesSection />)
    await waitFor(() => screen.getByText('Solo Dev'))
    fireEvent.click(screen.getAllByLabelText('Delete profile')[0])
    await waitFor(() => {
      expect(window.api.settingsProfiles.delete).toHaveBeenCalledWith('p1')
    })
  })
})
```

- [ ] **Step 2: Implement ProfilesSection**

Create `src/renderer/src/components/settings/ProfilesSection.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from '../../stores/toasts'

interface Profile {
  id: string
  name: string
  settings: Record<string, string>
}

const PROFILE_KEYS = [
  { key: 'agentManager.maxConcurrent', label: 'Max Agents', type: 'number' },
  { key: 'agentManager.defaultModel', label: 'Model', type: 'text' },
  { key: 'agentManager.maxRuntimeMs', label: 'Max Runtime (ms)', type: 'number' },
] as const

export function ProfilesSection(): React.JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSettings, setNewSettings] = useState<Record<string, string>>({})

  const loadProfiles = useCallback(async () => {
    const list = await window.api.settingsProfiles.list()
    setProfiles(list)
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  const handleApply = useCallback(async (id: string) => {
    try {
      await window.api.settingsProfiles.apply(id)
      toast.success('Profile applied -- restart app for changes to take effect')
    } catch (e) {
      toast.error(`Failed to apply: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    await window.api.settingsProfiles.delete(id)
    await loadProfiles()
    toast.success('Profile deleted')
  }, [loadProfiles])

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    try {
      await window.api.settingsProfiles.create({
        name: newName.trim(), settings: newSettings
      })
      setCreating(false)
      setNewName('')
      setNewSettings({})
      await loadProfiles()
      toast.success('Profile created')
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [newName, newSettings, loadProfiles])

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Settings Profiles</h3>
      <p className="settings-section__desc">
        Named configurations for quick switching. Applied profiles update
        agent manager settings -- restart required.
      </p>

      <div className="settings-profiles__list">
        {profiles.map(p => (
          <div key={p.id} className="settings-profiles__card">
            <div className="settings-profiles__name">{p.name}</div>
            <div className="settings-profiles__settings">
              {Object.entries(p.settings).map(([k, v]) => (
                <span key={k} className="settings-profiles__setting">
                  {PROFILE_KEYS.find(pk => pk.key === k)?.label ?? k}: {v}
                </span>
              ))}
            </div>
            <div className="settings-profiles__actions">
              <button onClick={() => handleApply(p.id)} className="bde-btn bde-btn--sm">
                Apply
              </button>
              <button
                onClick={() => handleDelete(p.id)}
                className="bde-btn bde-btn--sm bde-btn--ghost"
                aria-label="Delete profile"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {!creating ? (
        <button onClick={() => setCreating(true)} className="bde-btn bde-btn--sm">
          <Plus size={12} /> New Profile
        </button>
      ) : (
        <div className="settings-profiles__create">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Profile name"
            className="wb-form__input"
          />
          {PROFILE_KEYS.map(pk => (
            <div key={pk.key} className="settings-profiles__field">
              <label className="wb-form__label">{pk.label}</label>
              <input
                type={pk.type}
                value={newSettings[pk.key] ?? ''}
                onChange={e => setNewSettings(
                  { ...newSettings, [pk.key]: e.target.value }
                )}
                className="wb-form__input"
              />
            </div>
          ))}
          <div className="settings-profiles__create-actions">
            <button
              onClick={handleCreate}
              className="bde-btn bde-btn--sm bde-btn--primary"
            >
              Save
            </button>
            <button
              onClick={() => setCreating(false)}
              className="bde-btn bde-btn--sm bde-btn--ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add ProfilesSection to SettingsView**

Add `ProfilesSection` as a new tab in the Settings view (or add it to the existing Agent Manager tab).

- [ ] **Step 4: Register profile commands in CommandPalette**

In the core command registration (Feature 1), add commands for each profile:
- `profile:apply:<name>` -- "Apply Profile: Solo Dev", etc.
- These are dynamically registered when profiles are loaded.

- [ ] **Step 5: Run full test suite**

```bash
npm test
npm run test:main
npm run typecheck
npm run lint
```

---

## Verification Checklist

Before each feature PR:

```bash
npm run typecheck   # Zero errors
npm test            # All tests pass
npm run lint        # Zero errors
```

## Feature Dependencies

Features are independent and can be implemented in any order. Recommended sequence:

1. **Task Tags** (Feature 2) -- foundation for query language
2. **Command Palette Enhancement** (Feature 1) -- enables quick access to everything
3. **Task Search Query Language** (Feature 5) -- builds on tags
4. **Morning Briefing** (Feature 3) -- quick standalone win
5. **Floating Agent Monitor** (Feature 4) -- quick standalone win
6. **Settings Profiles** (Feature 6) -- lower priority, more plumbing
