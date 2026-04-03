# Phase 5: PR Station Enhancements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add filtering, sorting, and a merge button to PR Station so users can triage PRs without leaving the app.

**Architecture:** All enhancements are renderer-side. Filtering/sorting is client-side over the existing PR list. The merge button calls `mergePR()` from `github-api.ts` (already implemented). No new IPC channels needed.

**Tech Stack:** React, TypeScript, Zustand, existing `github-api.ts` functions

---

## File Structure

| Action | File                                                                         | Responsibility                           |
| ------ | ---------------------------------------------------------------------------- | ---------------------------------------- |
| Create | `src/renderer/src/components/pr-station/PRStationFilters.tsx`                | Filter bar (repo, status, checks)        |
| Create | `src/renderer/src/components/pr-station/__tests__/PRStationFilters.test.tsx` | Filter tests                             |
| Modify | `src/renderer/src/components/pr-station/PRStationList.tsx`                   | Accept filters, sort options             |
| Modify | `src/renderer/src/views/PRStationView.tsx`                                   | Wire filters, add merge button to detail |
| Modify | `src/renderer/src/components/pr-station/PRStationDetail.tsx`                 | Add merge button and strategy picker     |
| Create | `src/renderer/src/components/pr-station/MergeButton.tsx`                     | Merge button with strategy dropdown      |
| Create | `src/renderer/src/components/pr-station/__tests__/MergeButton.test.tsx`      | Merge button tests                       |

---

### Task 1: Build PR Filter Bar

**Files:**

- Create: `src/renderer/src/components/pr-station/PRStationFilters.tsx`
- Create: `src/renderer/src/components/pr-station/__tests__/PRStationFilters.test.tsx`

**Context:** PR Station shows all open PRs from all repos with no way to filter. Users with 20+ PRs need to filter by repo, review status, and CI check status.

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/components/pr-station/__tests__/PRStationFilters.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PRStationFilters } from '../PRStationFilters'
import type { PRFilters } from '../PRStationFilters'

describe('PRStationFilters', () => {
  const defaultFilters: PRFilters = { repo: null, sort: 'updated' }

  it('renders repo filter with "All" selected by default', () => {
    render(<PRStationFilters filters={defaultFilters} repos={['BDE', 'life-os']} onChange={() => {}} />)
    expect(screen.getByText('All')).toBeDefined()
  })

  it('calls onChange when repo filter is clicked', () => {
    const onChange = vi.fn()
    render(<PRStationFilters filters={defaultFilters} repos={['BDE', 'life-os']} onChange={onChange} />)
    fireEvent.click(screen.getByText('BDE'))
    expect(onChange).toHaveBeenCalledWith({ repo: 'BDE', sort: 'updated' })
  })

  it('renders sort options', () => {
    render(<PRStationFilters filters={defaultFilters} repos={[]} onChange={() => {}} />)
    expect(screen.getByText(/newest/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/pr-station/__tests__/PRStationFilters.test.tsx`
Expected: FAIL

- [ ] **Step 3: Build PRStationFilters component**

```typescript
// src/renderer/src/components/pr-station/PRStationFilters.tsx
import { tokens } from '../../design-system/tokens'

export interface PRFilters {
  repo: string | null
  sort: 'updated' | 'created' | 'title'
}

interface PRStationFiltersProps {
  filters: PRFilters
  repos: string[]
  onChange: (filters: PRFilters) => void
}

export function PRStationFilters({ filters, repos, onChange }: PRStationFiltersProps) {
  return (
    <div style={{
      display: 'flex',
      gap: tokens.space[2],
      padding: `${tokens.space[2]} ${tokens.space[3]}`,
      borderBottom: `1px solid ${tokens.color.border}`,
      alignItems: 'center',
      flexWrap: 'wrap',
    }}>
      {/* Repo filter chips */}
      <div style={{ display: 'flex', gap: tokens.space[1] }}>
        <FilterChip
          label="All"
          active={filters.repo === null}
          onClick={() => onChange({ ...filters, repo: null })}
        />
        {repos.map((repo) => (
          <FilterChip
            key={repo}
            label={repo}
            active={filters.repo === repo}
            onClick={() => onChange({ ...filters, repo })}
          />
        ))}
      </div>

      {/* Sort dropdown */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: tokens.space[1] }}>
        <span style={{ fontSize: tokens.fontSize.xs, color: tokens.color.textMuted }}>Sort:</span>
        <select
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as PRFilters['sort'] })}
          style={{
            background: tokens.color.surface,
            color: tokens.color.text,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.sm,
            padding: `${tokens.space[1]} ${tokens.space[2]}`,
            fontSize: tokens.fontSize.xs,
          }}
          aria-label="Sort PRs by"
        >
          <option value="updated">Newest Updated</option>
          <option value="created">Newest Created</option>
          <option value="title">Title A-Z</option>
        </select>
      </div>
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`bde-btn bde-btn--sm ${active ? 'bde-btn--primary' : 'bde-btn--ghost'}`}
      onClick={onClick}
      style={{ fontSize: tokens.fontSize.xs }}
    >
      {label}
    </button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/pr-station/__tests__/PRStationFilters.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/pr-station/PRStationFilters.tsx src/renderer/src/components/pr-station/__tests__/PRStationFilters.test.tsx
git commit -m "feat: add PR Station filter bar with repo and sort options"
```

---

### Task 2: Wire Filters into PRStationView

**Files:**

- Modify: `src/renderer/src/views/PRStationView.tsx`
- Modify: `src/renderer/src/components/pr-station/PRStationList.tsx`

- [ ] **Step 1: Add filter state to PRStationView**

```typescript
import { PRStationFilters, type PRFilters } from '../components/pr-station/PRStationFilters'

// Add state:
const [filters, setFilters] = useState<PRFilters>({ repo: null, sort: 'updated' })

// Derive unique repos from PR list:
const repos = useMemo(() => {
  const repoNames = prs.map((pr) => pr.base?.repo?.name).filter(Boolean)
  return [...new Set(repoNames)]
}, [prs])
```

- [ ] **Step 2: Apply filters before passing to PRStationList**

```typescript
const filteredPrs = useMemo(() => {
  let result = [...prs]

  // Repo filter
  if (filters.repo) {
    result = result.filter((pr) => pr.base?.repo?.name === filters.repo)
  }

  // Sort
  result.sort((a, b) => {
    switch (filters.sort) {
      case 'created':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case 'title':
        return a.title.localeCompare(b.title)
      case 'updated':
      default:
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    }
  })

  return result
}, [prs, filters])
```

- [ ] **Step 3: Add filter bar to JSX**

```typescript
<PRStationFilters filters={filters} repos={repos} onChange={setFilters} />
<PRStationList prs={filteredPrs} ... />
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/views/PRStationView.tsx src/renderer/src/components/pr-station/PRStationList.tsx
git commit -m "feat: wire PR filters and sorting into PR Station view"
```

---

### Task 3: Add Merge Button to PR Detail

**Files:**

- Create: `src/renderer/src/components/pr-station/MergeButton.tsx`
- Create: `src/renderer/src/components/pr-station/__tests__/MergeButton.test.tsx`
- Modify: `src/renderer/src/components/pr-station/PRStationDetail.tsx`

**Context:** Users currently must open GitHub in a browser to merge PRs. The `mergePR()` function already exists in `github-api.ts` — we just need a UI. The button should show merge strategy options (squash/merge/rebase) and be disabled when the PR isn't mergeable.

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/components/pr-station/__tests__/MergeButton.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MergeButton } from '../MergeButton'

describe('MergeButton', () => {
  it('renders disabled when not mergeable', () => {
    render(
      <MergeButton
        owner="owner"
        repo="repo"
        prNumber={1}
        mergeable={false}
        onMerged={() => {}}
      />
    )
    const btn = screen.getByRole('button', { name: /merge/i })
    expect(btn.getAttribute('disabled')).not.toBeNull()
  })

  it('renders enabled when mergeable', () => {
    render(
      <MergeButton
        owner="owner"
        repo="repo"
        prNumber={1}
        mergeable={true}
        onMerged={() => {}}
      />
    )
    const btn = screen.getByRole('button', { name: /merge/i })
    expect(btn.getAttribute('disabled')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/pr-station/__tests__/MergeButton.test.tsx`
Expected: FAIL

- [ ] **Step 3: Build MergeButton component**

```typescript
// src/renderer/src/components/pr-station/MergeButton.tsx
import { useState } from 'react'
import { GitMerge, ChevronDown } from 'lucide-react'
import { mergePR, type MergeMethod } from '../../lib/github-api'
import { toast } from '../../stores/toasts'
import { tokens } from '../../design-system/tokens'

interface MergeButtonProps {
  owner: string
  repo: string
  prNumber: number
  mergeable: boolean
  onMerged: () => void
}

export function MergeButton({ owner, repo, prNumber, mergeable, onMerged }: MergeButtonProps) {
  const [method, setMethod] = useState<MergeMethod>('squash')
  const [merging, setMerging] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  const handleMerge = async () => {
    setMerging(true)
    try {
      await mergePR(owner, repo, prNumber, method)
      toast.success(`PR #${prNumber} merged successfully`)
      onMerged()
    } catch (err) {
      toast.error(`Merge failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setMerging(false)
    }
  }

  const methods: { value: MergeMethod; label: string }[] = [
    { value: 'squash', label: 'Squash and merge' },
    { value: 'merge', label: 'Create merge commit' },
    { value: 'rebase', label: 'Rebase and merge' },
  ]

  return (
    <div style={{ display: 'flex', gap: 0, position: 'relative' }}>
      <button
        className="bde-btn bde-btn--primary bde-btn--sm"
        onClick={handleMerge}
        disabled={!mergeable || merging}
        aria-label={`Merge PR #${prNumber}`}
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
      >
        <GitMerge size={12} aria-hidden="true" />
        {merging ? 'Merging...' : methods.find((m) => m.value === method)?.label ?? 'Merge'}
      </button>
      <button
        className="bde-btn bde-btn--primary bde-btn--sm"
        onClick={() => setShowMenu(!showMenu)}
        disabled={!mergeable || merging}
        aria-label="Select merge strategy"
        style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, paddingLeft: 4, paddingRight: 4 }}
      >
        <ChevronDown size={12} />
      </button>

      {showMenu && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: tokens.space[1],
          background: tokens.color.surfaceHigh,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md,
          overflow: 'hidden',
          zIndex: 50,
          minWidth: 180,
        }}>
          {methods.map((m) => (
            <button
              key={m.value}
              className="bde-btn bde-btn--ghost"
              onClick={() => { setMethod(m.value); setShowMenu(false) }}
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                borderRadius: 0,
                fontSize: tokens.fontSize.sm,
                fontWeight: method === m.value ? 600 : 400,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/pr-station/__tests__/MergeButton.test.tsx`
Expected: PASS

- [ ] **Step 5: Add MergeButton to PRStationDetail**

In `src/renderer/src/components/pr-station/PRStationDetail.tsx`, find the Actions section and add:

```typescript
import { MergeButton } from './MergeButton'

// In the actions area:
<MergeButton
  owner={pr.base.repo.owner.login}
  repo={pr.base.repo.name}
  prNumber={pr.number}
  mergeable={mergeability?.mergeable ?? false}
  onMerged={() => {
    // Refresh PR list
    window.api.refreshPrList?.()
  }}
/>
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/pr-station/MergeButton.tsx src/renderer/src/components/pr-station/__tests__/MergeButton.test.tsx src/renderer/src/components/pr-station/PRStationDetail.tsx
git commit -m "feat: add merge button with strategy picker to PR Station"
```
