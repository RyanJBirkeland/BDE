# Phase 6: Git Tree View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code-style Source Control view showing the working tree (staged/unstaged changes), branch info, and inline diff previews — so developers can stage, unstage, commit, and push without leaving BDE.

**Architecture:** The backend already has full git IPC support: `gitStatus`, `gitDiff`, `gitStage`, `gitUnstage`, `gitCommit`, `gitPush`, `gitBranches`, `gitCheckout` — all wired through the preload bridge. This plan builds a new "Source Control" view in the renderer that consumes these existing channels. A new Zustand store tracks git state with periodic polling. The view uses a tree layout with collapsible sections for Staged/Unstaged changes, a commit message input, and an inline diff drawer.

**Tech Stack:** React, TypeScript, Zustand, existing Git IPC channels, existing design tokens, lucide-react icons

**Prerequisites:** PRs #348-350 are merged. ActivityBar uses `<nav>` with ARIA attributes (preserve when adding nav items). PanelLeaf/PanelTabBar have tab role semantics (preserve when registering new view). If Phase 4 (Dashboard) is implemented first, coordinate keyboard shortcuts per the shared table in that plan.

---

## File Structure

| Action | File                                                                 | Responsibility                                                    |
| ------ | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Create | `src/renderer/src/stores/gitTree.ts`                                 | Zustand store for git status, staging, branches                   |
| Create | `src/renderer/src/stores/__tests__/gitTree.test.ts`                  | Store tests                                                       |
| Create | `src/renderer/src/views/GitTreeView.tsx`                             | Main Source Control view                                          |
| Create | `src/renderer/src/views/__tests__/GitTreeView.test.tsx`              | View tests                                                        |
| Create | `src/renderer/src/components/git-tree/FileTreeSection.tsx`           | Collapsible file list (staged or unstaged)                        |
| Create | `src/renderer/src/components/git-tree/GitFileRow.tsx`                | Single file row with status icon and actions                      |
| Create | `src/renderer/src/components/git-tree/CommitBox.tsx`                 | Commit message input + commit/push buttons                        |
| Create | `src/renderer/src/components/git-tree/BranchSelector.tsx`            | Current branch display + branch switcher                          |
| Create | `src/renderer/src/components/git-tree/InlineDiffDrawer.tsx`          | Inline diff preview for selected file                             |
| Create | `src/renderer/src/components/git-tree/__tests__/GitFileRow.test.tsx` | File row tests                                                    |
| Create | `src/renderer/src/components/git-tree/__tests__/CommitBox.test.tsx`  | Commit box tests                                                  |
| Modify | `src/renderer/src/stores/panelLayout.ts`                             | Add 'git' to View type                                            |
| Modify | `src/renderer/src/components/layout/ActivityBar.tsx`                 | Add Source Control nav item                                       |
| Modify | `src/renderer/src/components/panels/PanelLeaf.tsx`                   | Register git view in lazy switch                                  |
| Modify | `src/renderer/src/lib/constants.ts`                                  | Verify `POLL_GIT_STATUS_INTERVAL` exists (no new constant needed) |

---

### Task 1: Create Git Tree Zustand Store

**Files:**

- Create: `src/renderer/src/stores/gitTree.ts`
- Create: `src/renderer/src/stores/__tests__/gitTree.test.ts`

**Context:** The store polls `window.api.gitStatus(cwd)` and maintains lists of staged/unstaged files, current branch, and diff content for a selected file. The IPC channel `git:status` returns `{ branch, staged, unstaged, untracked }` — each file entry has `{ path, status }` where status is one of `M` (modified), `A` (added), `D` (deleted), `?` (untracked), `R` (renamed).

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/stores/__tests__/gitTree.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.stubGlobal('window', {
  ...window,
  api: {
    gitStatus: vi.fn().mockResolvedValue({
      branch: 'feat/git-tree',
      staged: [{ path: 'src/index.ts', status: 'M' }],
      unstaged: [{ path: 'src/app.ts', status: 'M' }],
      untracked: [{ path: 'src/new-file.ts', status: '?' }]
    }),
    gitDiff: vi.fn().mockResolvedValue('diff --git a/src/app.ts\n+added line'),
    gitStage: vi.fn().mockResolvedValue(undefined),
    gitUnstage: vi.fn().mockResolvedValue(undefined),
    gitBranches: vi.fn().mockResolvedValue(['main', 'feat/git-tree']),
    getRepoPaths: vi.fn().mockResolvedValue(['/Users/ryan/projects/BDE'])
  }
})

import { useGitTreeStore } from '../gitTree'

describe('gitTree store', () => {
  beforeEach(() => {
    useGitTreeStore.setState({
      branch: '',
      staged: [],
      unstaged: [],
      untracked: [],
      loading: false,
      selectedFile: null,
      diffContent: '',
      commitMessage: '',
      repoPaths: [],
      activeRepo: ''
    })
  })

  it('fetchStatus populates branch and file lists', async () => {
    await useGitTreeStore.getState().fetchStatus('/Users/ryan/projects/BDE')
    const state = useGitTreeStore.getState()
    expect(state.branch).toBe('feat/git-tree')
    expect(state.staged).toHaveLength(1)
    expect(state.unstaged).toHaveLength(1)
    expect(state.untracked).toHaveLength(1)
  })

  it('staged files have correct structure', async () => {
    await useGitTreeStore.getState().fetchStatus('/Users/ryan/projects/BDE')
    const { staged } = useGitTreeStore.getState()
    expect(staged[0]).toEqual({ path: 'src/index.ts', status: 'M' })
  })

  it('selectFile fetches diff content', async () => {
    await useGitTreeStore.getState().selectFile('/Users/ryan/projects/BDE', 'src/app.ts', false)
    const { selectedFile, diffContent } = useGitTreeStore.getState()
    expect(selectedFile).toBe('src/app.ts')
    expect(diffContent).toContain('+added line')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/stores/__tests__/gitTree.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Build the gitTree store**

```typescript
// src/renderer/src/stores/gitTree.ts
import { create } from 'zustand'

export interface GitFileEntry {
  path: string
  status: string // M, A, D, ?, R
}

interface GitTreeState {
  branch: string
  staged: GitFileEntry[]
  unstaged: GitFileEntry[]
  untracked: GitFileEntry[]
  loading: boolean
  selectedFile: string | null
  diffContent: string
  commitMessage: string
  repoPaths: string[]
  activeRepo: string
  branches: string[]

  fetchStatus: (cwd: string) => Promise<void>
  selectFile: (cwd: string, path: string, staged: boolean) => Promise<void>
  clearSelection: () => void
  stageFile: (cwd: string, path: string) => Promise<void>
  unstageFile: (cwd: string, path: string) => Promise<void>
  stageAll: (cwd: string) => Promise<void>
  unstageAll: (cwd: string) => Promise<void>
  setCommitMessage: (msg: string) => void
  commit: (cwd: string) => Promise<void>
  push: (cwd: string) => Promise<void>
  fetchBranches: (cwd: string) => Promise<void>
  setActiveRepo: (path: string) => void
  loadRepoPaths: () => Promise<void>
}

export const useGitTreeStore = create<GitTreeState>((set, get) => ({
  branch: '',
  staged: [],
  unstaged: [],
  untracked: [],
  loading: false,
  selectedFile: null,
  diffContent: '',
  commitMessage: '',
  repoPaths: [],
  activeRepo: '',
  branches: [],

  fetchStatus: async (cwd) => {
    set({ loading: true })
    try {
      const result = await window.api.gitStatus(cwd)
      set({
        branch: result.branch ?? '',
        staged: result.staged ?? [],
        unstaged: result.unstaged ?? [],
        untracked: result.untracked ?? [],
        loading: false
      })
    } catch {
      set({ loading: false })
    }
  },

  selectFile: async (cwd, path, staged) => {
    set({ selectedFile: path })
    try {
      const diff = await window.api.gitDiff(cwd, path)
      set({ diffContent: typeof diff === 'string' ? diff : '' })
    } catch {
      set({ diffContent: '' })
    }
  },

  clearSelection: () => set({ selectedFile: null, diffContent: '' }),

  stageFile: async (cwd, path) => {
    await window.api.gitStage(cwd, [path])
    await get().fetchStatus(cwd)
  },

  unstageFile: async (cwd, path) => {
    await window.api.gitUnstage(cwd, [path])
    await get().fetchStatus(cwd)
  },

  stageAll: async (cwd) => {
    const { unstaged, untracked } = get()
    const paths = [...unstaged, ...untracked].map((f) => f.path)
    if (paths.length > 0) {
      await window.api.gitStage(cwd, paths)
      await get().fetchStatus(cwd)
    }
  },

  unstageAll: async (cwd) => {
    const { staged } = get()
    const paths = staged.map((f) => f.path)
    if (paths.length > 0) {
      await window.api.gitUnstage(cwd, paths)
      await get().fetchStatus(cwd)
    }
  },

  setCommitMessage: (msg) => set({ commitMessage: msg }),

  commit: async (cwd) => {
    const { commitMessage } = get()
    if (!commitMessage.trim()) return
    await window.api.gitCommit(cwd, commitMessage)
    set({ commitMessage: '' })
    await get().fetchStatus(cwd)
  },

  push: async (cwd) => {
    await window.api.gitPush(cwd)
  },

  fetchBranches: async (cwd) => {
    try {
      const branches = await window.api.gitBranches(cwd)
      set({ branches: Array.isArray(branches) ? branches : [] })
    } catch {
      set({ branches: [] })
    }
  },

  setActiveRepo: (path) => set({ activeRepo: path }),

  loadRepoPaths: async () => {
    try {
      const paths = await window.api.getRepoPaths()
      set({
        repoPaths: Array.isArray(paths) ? paths : [],
        activeRepo: Array.isArray(paths) && paths.length > 0 ? paths[0] : ''
      })
    } catch {
      set({ repoPaths: [] })
    }
  }
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/stores/__tests__/gitTree.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/gitTree.ts src/renderer/src/stores/__tests__/gitTree.test.ts
git commit -m "feat: add gitTree Zustand store for source control"
```

---

### Task 2: Build GitFileRow Component

**Files:**

- Create: `src/renderer/src/components/git-tree/GitFileRow.tsx`
- Create: `src/renderer/src/components/git-tree/__tests__/GitFileRow.test.tsx`

**Context:** Each file row shows: status icon (color-coded M/A/D/?), file path (with directory dimmed), and action buttons (stage/unstage, discard for unstaged). Similar to VS Code's Source Control file rows.

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/components/git-tree/__tests__/GitFileRow.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GitFileRow } from '../GitFileRow'

describe('GitFileRow', () => {
  it('renders file path with status indicator', () => {
    render(
      <GitFileRow
        path="src/components/App.tsx"
        status="M"
        isStaged={false}
        onStage={() => {}}
        onUnstage={() => {}}
        onClick={() => {}}
      />
    )
    expect(screen.getByText('App.tsx')).toBeDefined()
    expect(screen.getByText('M')).toBeDefined()
  })

  it('shows directory portion dimmed', () => {
    render(
      <GitFileRow
        path="src/components/App.tsx"
        status="A"
        isStaged={false}
        onStage={() => {}}
        onUnstage={() => {}}
        onClick={() => {}}
      />
    )
    expect(screen.getByText('src/components/')).toBeDefined()
  })

  it('calls onStage when stage button clicked', () => {
    const onStage = vi.fn()
    render(
      <GitFileRow
        path="src/index.ts"
        status="M"
        isStaged={false}
        onStage={onStage}
        onUnstage={() => {}}
        onClick={() => {}}
      />
    )
    fireEvent.click(screen.getByLabelText('Stage file'))
    expect(onStage).toHaveBeenCalled()
  })

  it('calls onUnstage when unstage button clicked for staged files', () => {
    const onUnstage = vi.fn()
    render(
      <GitFileRow
        path="src/index.ts"
        status="M"
        isStaged={true}
        onStage={() => {}}
        onUnstage={onUnstage}
        onClick={() => {}}
      />
    )
    fireEvent.click(screen.getByLabelText('Unstage file'))
    expect(onUnstage).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/git-tree/__tests__/GitFileRow.test.tsx`
Expected: FAIL

- [ ] **Step 3: Build GitFileRow component**

```typescript
// src/renderer/src/components/git-tree/GitFileRow.tsx
import { Plus, Minus } from 'lucide-react'
import { tokens } from '../../design-system/tokens'

interface GitFileRowProps {
  path: string
  status: string
  isStaged: boolean
  selected?: boolean
  onStage: () => void
  onUnstage: () => void
  onClick: () => void
}

const STATUS_COLORS: Record<string, string> = {
  M: tokens.color.warning,   // Modified
  A: tokens.color.success,   // Added
  D: tokens.color.danger,    // Deleted
  '?': '#888888',             // Untracked
  R: tokens.color.info,      // Renamed
}

export function GitFileRow({ path, status, isStaged, selected, onStage, onUnstage, onClick }: GitFileRowProps) {
  const lastSlash = path.lastIndexOf('/')
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : ''
  const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        padding: `3px ${tokens.space[2]}`,
        cursor: 'pointer',
        borderRadius: tokens.radius.sm,
        background: selected ? `var(--bde-selected)` : 'transparent',
        fontSize: tokens.fontSize.sm,
        fontFamily: tokens.font.code,
      }}
      className="git-file-row"
    >
      {/* Status badge */}
      <span style={{
        color: STATUS_COLORS[status] ?? tokens.color.textMuted,
        fontWeight: 600,
        fontSize: tokens.fontSize.xs,
        width: 14,
        textAlign: 'center',
        flexShrink: 0,
      }}>
        {status}
      </span>

      {/* File path */}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {dir && <span style={{ color: tokens.color.textDim }}>{dir}</span>}
        <span>{filename}</span>
      </span>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {isStaged ? (
          <button
            className="bde-btn bde-btn--icon bde-btn--sm"
            onClick={onUnstage}
            aria-label="Unstage file"
            title="Unstage"
            style={{ width: 20, height: 20, padding: 0 }}
          >
            <Minus size={12} />
          </button>
        ) : (
          <button
            className="bde-btn bde-btn--icon bde-btn--sm"
            onClick={onStage}
            aria-label="Stage file"
            title="Stage"
            style={{ width: 20, height: 20, padding: 0 }}
          >
            <Plus size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/git-tree/__tests__/GitFileRow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/git-tree/GitFileRow.tsx src/renderer/src/components/git-tree/__tests__/GitFileRow.test.tsx
git commit -m "feat: add GitFileRow component with status indicators and stage/unstage"
```

---

### Task 3: Build FileTreeSection Component

**Files:**

- Create: `src/renderer/src/components/git-tree/FileTreeSection.tsx`
- Create: `src/renderer/src/components/git-tree/__tests__/FileTreeSection.test.tsx`

**Context:** Collapsible section for "Staged Changes" and "Changes" (unstaged + untracked). Shows count badge and "Stage All" / "Unstage All" button in the header.

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/components/git-tree/__tests__/FileTreeSection.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileTreeSection } from '../FileTreeSection'

describe('FileTreeSection', () => {
  const files = [
    { path: 'src/index.ts', status: 'M' },
    { path: 'src/app.ts', status: 'A' },
  ]

  it('renders section title and file count', () => {
    render(
      <FileTreeSection
        title="Staged Changes"
        files={files}
        isStaged={true}
        selectedFile={null}
        onSelectFile={() => {}}
        onStageFile={() => {}}
        onUnstageFile={() => {}}
      />
    )
    expect(screen.getByText('Staged Changes')).toBeDefined()
    expect(screen.getByText('2')).toBeDefined()
  })

  it('renders nothing when files array is empty', () => {
    const { container } = render(
      <FileTreeSection
        title="Staged Changes"
        files={[]}
        isStaged={true}
        selectedFile={null}
        onSelectFile={() => {}}
        onStageFile={() => {}}
        onUnstageFile={() => {}}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('calls onStageAll when stage all button is clicked', () => {
    const onStageAll = vi.fn()
    render(
      <FileTreeSection
        title="Changes"
        files={files}
        isStaged={false}
        selectedFile={null}
        onSelectFile={() => {}}
        onStageFile={() => {}}
        onUnstageFile={() => {}}
        onStageAll={onStageAll}
      />
    )
    fireEvent.click(screen.getByLabelText('Stage all files'))
    expect(onStageAll).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/git-tree/__tests__/FileTreeSection.test.tsx`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Build FileTreeSection**

```typescript
// src/renderer/src/components/git-tree/FileTreeSection.tsx
import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Minus } from 'lucide-react'
import { GitFileRow } from './GitFileRow'
import { Badge } from '../ui/Badge'
import { tokens } from '../../design-system/tokens'
import type { GitFileEntry } from '../../stores/gitTree'

interface FileTreeSectionProps {
  title: string
  files: GitFileEntry[]
  isStaged: boolean
  selectedFile: string | null
  onSelectFile: (path: string) => void
  onStageFile: (path: string) => void
  onUnstageFile: (path: string) => void
  onStageAll?: () => void
  onUnstageAll?: () => void
}

export function FileTreeSection({
  title, files, isStaged, selectedFile,
  onSelectFile, onStageFile, onUnstageFile, onStageAll, onUnstageAll,
}: FileTreeSectionProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (files.length === 0) return null

  return (
    <div style={{ marginBottom: tokens.space[2] }}>
      {/* Section header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[1],
          padding: `${tokens.space[1]} ${tokens.space[2]}`,
          cursor: 'pointer',
          userSelect: 'none',
          fontSize: tokens.fontSize.xs,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: tokens.color.textMuted,
        }}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span style={{ flex: 1 }}>{title}</span>
        <Badge variant="muted" size="sm">{files.length}</Badge>

        {/* Bulk action */}
        <div onClick={(e) => e.stopPropagation()}>
          {isStaged && onUnstageAll && (
            <button
              className="bde-btn bde-btn--icon bde-btn--sm"
              onClick={onUnstageAll}
              aria-label="Unstage all files"
              title="Unstage All"
              style={{ width: 20, height: 20, padding: 0 }}
            >
              <Minus size={12} />
            </button>
          )}
          {!isStaged && onStageAll && (
            <button
              className="bde-btn bde-btn--icon bde-btn--sm"
              onClick={onStageAll}
              aria-label="Stage all files"
              title="Stage All"
              style={{ width: 20, height: 20, padding: 0 }}
            >
              <Plus size={12} />
            </button>
          )}
        </div>
      </div>

      {/* File list */}
      {!collapsed && (
        <div style={{ paddingLeft: tokens.space[2] }}>
          {files.map((file) => (
            <GitFileRow
              key={file.path}
              path={file.path}
              status={file.status}
              isStaged={isStaged}
              selected={selectedFile === file.path}
              onClick={() => onSelectFile(file.path)}
              onStage={() => onStageFile(file.path)}
              onUnstage={() => onUnstageFile(file.path)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/git-tree/__tests__/FileTreeSection.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/git-tree/FileTreeSection.tsx src/renderer/src/components/git-tree/__tests__/FileTreeSection.test.tsx
git commit -m "feat: add FileTreeSection with collapsible file list and bulk actions"
```

---

### Task 4: Build CommitBox Component

**Files:**

- Create: `src/renderer/src/components/git-tree/CommitBox.tsx`
- Create: `src/renderer/src/components/git-tree/__tests__/CommitBox.test.tsx`

**Context:** Text input for commit message + Commit button + Push button. Commit is disabled when no staged files or empty message. Push shows current ahead/behind count if available.

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/components/git-tree/__tests__/CommitBox.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommitBox } from '../CommitBox'

describe('CommitBox', () => {
  it('disables commit button when message is empty', () => {
    render(
      <CommitBox
        message=""
        stagedCount={1}
        onMessageChange={() => {}}
        onCommit={() => {}}
        onPush={() => {}}
      />
    )
    const btn = screen.getByRole('button', { name: /commit/i })
    expect(btn.getAttribute('disabled')).not.toBeNull()
  })

  it('disables commit button when no staged files', () => {
    render(
      <CommitBox
        message="fix: something"
        stagedCount={0}
        onMessageChange={() => {}}
        onCommit={() => {}}
        onPush={() => {}}
      />
    )
    const btn = screen.getByRole('button', { name: /commit/i })
    expect(btn.getAttribute('disabled')).not.toBeNull()
  })

  it('enables commit button when message and staged files exist', () => {
    render(
      <CommitBox
        message="fix: something"
        stagedCount={2}
        onMessageChange={() => {}}
        onCommit={() => {}}
        onPush={() => {}}
      />
    )
    const btn = screen.getByRole('button', { name: /commit/i })
    expect(btn.getAttribute('disabled')).toBeNull()
  })

  it('calls onCommit when commit button clicked', () => {
    const onCommit = vi.fn()
    render(
      <CommitBox
        message="fix: auth"
        stagedCount={1}
        onMessageChange={() => {}}
        onCommit={onCommit}
        onPush={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /commit/i }))
    expect(onCommit).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/git-tree/__tests__/CommitBox.test.tsx`
Expected: FAIL

- [ ] **Step 3: Build CommitBox**

```typescript
// src/renderer/src/components/git-tree/CommitBox.tsx
import { ArrowUp } from 'lucide-react'
import { tokens } from '../../design-system/tokens'

interface CommitBoxProps {
  message: string
  stagedCount: number
  onMessageChange: (msg: string) => void
  onCommit: () => void
  onPush: () => void
  committing?: boolean
  pushing?: boolean
}

export function CommitBox({
  message, stagedCount, onMessageChange, onCommit, onPush,
  committing, pushing,
}: CommitBoxProps) {
  const canCommit = message.trim().length > 0 && stagedCount > 0 && !committing

  return (
    <div style={{
      padding: tokens.space[3],
      borderBottom: `1px solid ${tokens.color.border}`,
      display: 'flex',
      flexDirection: 'column',
      gap: tokens.space[2],
    }}>
      <textarea
        value={message}
        onChange={(e) => onMessageChange(e.target.value)}
        placeholder="Commit message"
        className="bde-textarea"
        style={{
          minHeight: 60,
          maxHeight: 120,
          resize: 'vertical',
          fontSize: tokens.fontSize.sm,
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) {
            e.preventDefault()
            onCommit()
          }
        }}
        aria-label="Commit message"
      />
      <div style={{ display: 'flex', gap: tokens.space[2] }}>
        <button
          className="bde-btn bde-btn--primary bde-btn--sm"
          onClick={onCommit}
          disabled={!canCommit}
          aria-label={`Commit ${stagedCount} staged file${stagedCount !== 1 ? 's' : ''}`}
          style={{ flex: 1 }}
        >
          {committing ? 'Committing...' : `Commit (${stagedCount})`}
        </button>
        <button
          className="bde-btn bde-btn--ghost bde-btn--sm"
          onClick={onPush}
          disabled={pushing}
          aria-label="Push to remote"
          title="Push"
        >
          <ArrowUp size={14} />
          {pushing ? '...' : 'Push'}
        </button>
      </div>
      <div style={{ fontSize: tokens.fontSize.xs, color: tokens.color.textDim }}>
        {canCommit ? '⌘Enter to commit' : stagedCount === 0 ? 'Stage files to commit' : 'Enter a commit message'}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/git-tree/__tests__/CommitBox.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/git-tree/CommitBox.tsx src/renderer/src/components/git-tree/__tests__/CommitBox.test.tsx
git commit -m "feat: add CommitBox component with commit/push actions"
```

---

### Task 5: Build BranchSelector Component

**Files:**

- Create: `src/renderer/src/components/git-tree/BranchSelector.tsx`
- Create: `src/renderer/src/components/git-tree/__tests__/BranchSelector.test.tsx`

**Context:** Shows current branch name with a git-branch icon. Clicking opens a dropdown of available branches. Selecting a branch calls `window.api.gitCheckout()`. In read-only mode (when there are uncommitted changes), show a warning.

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/components/git-tree/__tests__/BranchSelector.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BranchSelector } from '../BranchSelector'

describe('BranchSelector', () => {
  it('renders current branch name', () => {
    render(
      <BranchSelector
        currentBranch="feat/git-tree"
        branches={['main', 'feat/git-tree']}
        hasChanges={false}
        onCheckout={() => {}}
      />
    )
    expect(screen.getByText('feat/git-tree')).toBeDefined()
  })

  it('opens dropdown on click and shows all branches', () => {
    render(
      <BranchSelector
        currentBranch="main"
        branches={['main', 'feat/git-tree', 'fix/auth']}
        hasChanges={false}
        onCheckout={() => {}}
      />
    )
    fireEvent.click(screen.getByLabelText('Current branch: main'))
    expect(screen.getByText('feat/git-tree')).toBeDefined()
    expect(screen.getByText('fix/auth')).toBeDefined()
  })

  it('disables other branches when hasChanges is true', () => {
    render(
      <BranchSelector
        currentBranch="main"
        branches={['main', 'feat/other']}
        hasChanges={true}
        onCheckout={() => {}}
      />
    )
    fireEvent.click(screen.getByLabelText('Current branch: main'))
    const otherBtn = screen.getByText('feat/other').closest('button')
    expect(otherBtn?.getAttribute('disabled')).not.toBeNull()
  })

  it('calls onCheckout when a different branch is selected', () => {
    const onCheckout = vi.fn()
    render(
      <BranchSelector
        currentBranch="main"
        branches={['main', 'feat/git-tree']}
        hasChanges={false}
        onCheckout={onCheckout}
      />
    )
    fireEvent.click(screen.getByLabelText('Current branch: main'))
    fireEvent.click(screen.getByText('feat/git-tree'))
    expect(onCheckout).toHaveBeenCalledWith('feat/git-tree')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/git-tree/__tests__/BranchSelector.test.tsx`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Build BranchSelector**

```typescript
// src/renderer/src/components/git-tree/BranchSelector.tsx
import { useState } from 'react'
import { GitBranch, ChevronDown } from 'lucide-react'
import { tokens } from '../../design-system/tokens'

interface BranchSelectorProps {
  currentBranch: string
  branches: string[]
  hasChanges: boolean
  onCheckout: (branch: string) => void
}

export function BranchSelector({ currentBranch, branches, hasChanges, onCheckout }: BranchSelectorProps) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="bde-btn bde-btn--ghost bde-btn--sm"
        onClick={() => setOpen(!open)}
        aria-label={`Current branch: ${currentBranch}`}
        style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1] }}
      >
        <GitBranch size={12} aria-hidden="true" />
        <span style={{ fontFamily: tokens.font.code, fontSize: tokens.fontSize.sm }}>{currentBranch}</span>
        <ChevronDown size={10} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: tokens.space[1],
          background: tokens.color.surfaceHigh,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md,
          overflow: 'auto',
          maxHeight: 200,
          minWidth: 180,
          zIndex: 50,
        }}>
          {branches.map((branch) => (
            <button
              key={branch}
              className="bde-btn bde-btn--ghost"
              onClick={() => {
                if (branch !== currentBranch) onCheckout(branch)
                setOpen(false)
              }}
              disabled={hasChanges && branch !== currentBranch}
              title={hasChanges && branch !== currentBranch ? 'Commit or stash changes before switching' : undefined}
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                borderRadius: 0,
                fontSize: tokens.fontSize.sm,
                fontFamily: tokens.font.code,
                fontWeight: branch === currentBranch ? 600 : 400,
              }}
            >
              {branch === currentBranch && '• '}{branch}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/git-tree/__tests__/BranchSelector.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/git-tree/BranchSelector.tsx src/renderer/src/components/git-tree/__tests__/BranchSelector.test.tsx
git commit -m "feat: add BranchSelector dropdown for branch switching"
```

---

### Task 6: Build InlineDiffDrawer Component

**Files:**

- Create: `src/renderer/src/components/git-tree/InlineDiffDrawer.tsx`
- Create: `src/renderer/src/components/git-tree/__tests__/InlineDiffDrawer.test.tsx`

**Context:** When a file is selected in the tree, show its diff in a bottom drawer. Reuses diff parsing from the existing diff viewer if possible, otherwise renders raw diff text with basic color coding.

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/components/git-tree/__tests__/InlineDiffDrawer.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InlineDiffDrawer } from '../InlineDiffDrawer'

describe('InlineDiffDrawer', () => {
  const sampleDiff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo'
+import { bar } from './bar'
-const old = true
 const app = foo()`

  it('renders file path in header', () => {
    render(<InlineDiffDrawer filePath="src/app.ts" diffContent={sampleDiff} onClose={() => {}} />)
    expect(screen.getByText('src/app.ts')).toBeDefined()
  })

  it('renders diff lines', () => {
    render(<InlineDiffDrawer filePath="src/app.ts" diffContent={sampleDiff} onClose={() => {}} />)
    expect(screen.getByText(/import \{ bar \}/)).toBeDefined()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<InlineDiffDrawer filePath="src/app.ts" diffContent={sampleDiff} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close diff'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/git-tree/__tests__/InlineDiffDrawer.test.tsx`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Build InlineDiffDrawer**

```typescript
// src/renderer/src/components/git-tree/InlineDiffDrawer.tsx
import { X } from 'lucide-react'
import { tokens } from '../../design-system/tokens'

interface InlineDiffDrawerProps {
  filePath: string
  diffContent: string
  onClose: () => void
}

export function InlineDiffDrawer({ filePath, diffContent, onClose }: InlineDiffDrawerProps) {
  const lines = diffContent.split('\n')

  return (
    <div style={{
      borderTop: `1px solid ${tokens.color.border}`,
      display: 'flex',
      flexDirection: 'column',
      maxHeight: '50%',
      minHeight: 120,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: `${tokens.space[1]} ${tokens.space[3]}`,
        borderBottom: `1px solid ${tokens.color.border}`,
        fontSize: tokens.fontSize.xs,
        fontFamily: tokens.font.code,
        color: tokens.color.textMuted,
      }}>
        <span style={{ flex: 1 }}>{filePath}</span>
        <button
          className="bde-btn bde-btn--icon bde-btn--sm"
          onClick={onClose}
          aria-label="Close diff"
          style={{ width: 20, height: 20, padding: 0 }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Diff content */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: tokens.space[2],
        fontFamily: tokens.font.code,
        fontSize: tokens.fontSize.xs,
        lineHeight: 1.6,
        whiteSpace: 'pre',
      }}>
        {lines.map((line, i) => {
          let color = tokens.color.text
          let bg = 'transparent'

          if (line.startsWith('+') && !line.startsWith('+++')) {
            color = 'var(--bde-diff-add-fg, #4ade80)'
            bg = 'var(--bde-diff-add, rgba(34, 197, 94, 0.1))'
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            color = 'var(--bde-diff-del-fg, #f87171)'
            bg = 'var(--bde-diff-del, rgba(239, 68, 68, 0.1))'
          } else if (line.startsWith('@@')) {
            color = tokens.color.info
          } else if (line.startsWith('diff ') || line.startsWith('index ')) {
            color = tokens.color.textDim
          }

          return (
            <div key={i} style={{ color, background: bg, paddingLeft: tokens.space[1] }}>
              {line}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/git-tree/__tests__/InlineDiffDrawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/git-tree/InlineDiffDrawer.tsx src/renderer/src/components/git-tree/__tests__/InlineDiffDrawer.test.tsx
git commit -m "feat: add InlineDiffDrawer for file diff preview"
```

---

### Task 7: Build GitTreeView and Register in App

**Files:**

- Create: `src/renderer/src/views/GitTreeView.tsx`
- Create: `src/renderer/src/views/__tests__/GitTreeView.test.tsx`
- Modify: `src/renderer/src/stores/panelLayout.ts`
- Modify: `src/renderer/src/components/layout/ActivityBar.tsx`
- Modify: `src/renderer/src/components/panels/PanelLeaf.tsx`
- Modify: `src/renderer/src/lib/constants.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/views/__tests__/GitTreeView.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.stubGlobal('window', {
  ...window,
  api: {
    gitStatus: vi.fn().mockResolvedValue({ branch: 'main', staged: [], unstaged: [], untracked: [] }),
    gitBranches: vi.fn().mockResolvedValue(['main']),
    getRepoPaths: vi.fn().mockResolvedValue(['/Users/ryan/projects/BDE']),
    settings: { getJson: vi.fn().mockResolvedValue([{ localPath: '/Users/ryan/projects/BDE', name: 'BDE' }]) },
  },
})

import GitTreeView from '../GitTreeView'

describe('GitTreeView', () => {
  it('renders source control heading', () => {
    render(<GitTreeView />)
    expect(screen.getByText(/source control/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/views/__tests__/GitTreeView.test.tsx`
Expected: FAIL

- [ ] **Step 3: Build GitTreeView**

```typescript
// src/renderer/src/views/GitTreeView.tsx
import { useEffect, useCallback, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useGitTreeStore } from '../stores/gitTree'
import { FileTreeSection } from '../components/git-tree/FileTreeSection'
import { CommitBox } from '../components/git-tree/CommitBox'
import { BranchSelector } from '../components/git-tree/BranchSelector'
import { InlineDiffDrawer } from '../components/git-tree/InlineDiffDrawer'
import { EmptyState } from '../components/ui/EmptyState'
import { Spinner } from '../components/ui/Spinner'
import { toast } from '../stores/toasts'
import { tokens } from '../design-system/tokens'
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval'
import { POLL_GIT_STATUS_INTERVAL } from '../lib/constants'

export default function GitTreeView() {
  const {
    branch, staged, unstaged, untracked, loading,
    selectedFile, diffContent, commitMessage, branches,
    activeRepo, repoPaths,
    fetchStatus, selectFile, clearSelection,
    stageFile, unstageFile, stageAll, unstageAll,
    setCommitMessage, commit, push,
    fetchBranches, setActiveRepo, loadRepoPaths,
  } = useGitTreeStore()

  const [committing, setCommitting] = useState(false)
  const [pushing, setPushing] = useState(false)

  // Load repo paths on mount
  useEffect(() => { loadRepoPaths() }, [loadRepoPaths])

  // Fetch status when active repo changes
  useEffect(() => {
    if (activeRepo) {
      fetchStatus(activeRepo)
      fetchBranches(activeRepo)
    }
  }, [activeRepo, fetchStatus, fetchBranches])

  // Poll git status
  const refresh = useCallback(() => {
    if (activeRepo) fetchStatus(activeRepo)
  }, [activeRepo, fetchStatus])
  useVisibilityAwareInterval(refresh, POLL_GIT_STATUS_INTERVAL)

  const handleCommit = async () => {
    setCommitting(true)
    try {
      await commit(activeRepo)
      toast.success('Changes committed')
    } catch (err) {
      toast.error(`Commit failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setCommitting(false)
    }
  }

  const handlePush = async () => {
    setPushing(true)
    try {
      await push(activeRepo)
      toast.success('Pushed to remote')
    } catch (err) {
      toast.error(`Push failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setPushing(false)
    }
  }

  const handleCheckout = async (branchName: string) => {
    try {
      await window.api.gitCheckout(activeRepo, branchName)
      await fetchStatus(activeRepo)
      await fetchBranches(activeRepo)
      toast.success(`Switched to ${branchName}`)
    } catch (err) {
      toast.error(`Checkout failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const hasChanges = staged.length + unstaged.length + untracked.length > 0
  const changesFiles = [...unstaged, ...untracked]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        padding: `${tokens.space[2]} ${tokens.space[3]}`,
        borderBottom: `1px solid ${tokens.color.border}`,
        minHeight: 40,
      }}>
        <h2 style={{ fontSize: tokens.fontSize.lg, fontWeight: 600, flex: 1, margin: 0 }}>
          Source Control
        </h2>

        {/* Repo selector (if multiple repos) */}
        {repoPaths.length > 1 && (
          <select
            value={activeRepo}
            onChange={(e) => setActiveRepo(e.target.value)}
            style={{
              background: tokens.color.surface,
              color: tokens.color.text,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.sm,
              padding: `2px ${tokens.space[2]}`,
              fontSize: tokens.fontSize.xs,
              fontFamily: tokens.font.code,
            }}
            aria-label="Select repository"
          >
            {repoPaths.map((p) => (
              <option key={p} value={p}>{p.split('/').pop()}</option>
            ))}
          </select>
        )}

        <BranchSelector
          currentBranch={branch}
          branches={branches}
          hasChanges={hasChanges}
          onCheckout={handleCheckout}
        />

        <button
          className="bde-btn bde-btn--icon bde-btn--sm"
          onClick={refresh}
          aria-label="Refresh git status"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'bde-spin' : ''} />
        </button>
      </div>

      {/* Commit box */}
      <CommitBox
        message={commitMessage}
        stagedCount={staged.length}
        onMessageChange={setCommitMessage}
        onCommit={handleCommit}
        onPush={handlePush}
        committing={committing}
        pushing={pushing}
      />

      {/* File tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: `${tokens.space[2]} 0` }}>
        {loading && !hasChanges ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: tokens.space[6] }}>
            <Spinner />
          </div>
        ) : !hasChanges ? (
          <EmptyState
            title="No changes"
            description="Working tree is clean. Make some changes and they'll appear here."
          />
        ) : (
          <>
            <FileTreeSection
              title="Staged Changes"
              files={staged}
              isStaged={true}
              selectedFile={selectedFile}
              onSelectFile={(path) => selectFile(activeRepo, path, true)}
              onStageFile={() => {}}
              onUnstageFile={(path) => unstageFile(activeRepo, path)}
              onUnstageAll={() => unstageAll(activeRepo)}
            />
            <FileTreeSection
              title="Changes"
              files={changesFiles}
              isStaged={false}
              selectedFile={selectedFile}
              onSelectFile={(path) => selectFile(activeRepo, path, false)}
              onStageFile={(path) => stageFile(activeRepo, path)}
              onUnstageFile={() => {}}
              onStageAll={() => stageAll(activeRepo)}
            />
          </>
        )}
      </div>

      {/* Inline diff drawer */}
      {selectedFile && diffContent && (
        <InlineDiffDrawer
          filePath={selectedFile}
          diffContent={diffContent}
          onClose={clearSelection}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Register 'git' view type in panelLayout.ts**

In `src/renderer/src/stores/panelLayout.ts`, add `'git'` to the `View` type union and add `git: 'Source Control'` to the `VIEW_LABELS` map.

- [ ] **Step 5: Add Source Control to ActivityBar**

In `src/renderer/src/components/layout/ActivityBar.tsx`:

```typescript
import { GitBranch } from 'lucide-react'

// Add after Sprint in nav items:
{ view: 'git', label: 'Source Control', icon: GitBranch },
```

**Note:** Coordinate shortcut assignment with the Phase 4 Dashboard plan. If Dashboard is implemented first, the git view becomes `⌘6`. Update `App.tsx` keyboard handlers accordingly at that time. Do not hardcode a shortcut number here until the final ordering is confirmed.

- [ ] **Step 6: Register in PanelLeaf lazy switch**

```typescript
const GitTreeView = lazy(() => import('../../views/GitTreeView'))

case 'git':
  return <Suspense fallback={<ViewSkeleton />}><GitTreeView /></Suspense>
```

- [ ] **Step 7: Verify polling constant exists**

The view already imports `POLL_GIT_STATUS_INTERVAL` (30s) from `src/renderer/src/lib/constants.ts`. Verify this constant exists — do NOT add a new `POLL_GIT_TREE_MS` constant. The 30s interval is appropriate for the git tree view; more aggressive polling would create unnecessary git subprocess overhead.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/views/__tests__/GitTreeView.test.tsx`
Expected: PASS

- [ ] **Step 9: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/views/GitTreeView.tsx src/renderer/src/views/__tests__/GitTreeView.test.tsx src/renderer/src/stores/panelLayout.ts src/renderer/src/components/layout/ActivityBar.tsx src/renderer/src/components/panels/PanelLeaf.tsx
git commit -m "feat: add Source Control view with git tree, commit, push, and branch switching"
```
