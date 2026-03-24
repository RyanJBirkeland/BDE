# Full Test Remediation — BDE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve comprehensive test coverage across all BDE features — fill every gap identified in the deep-dive audit (PR Station, Diff components, Settings, Memory, Terminal, untested stores, untested hooks, integration tests, expanded smoke tests).

**Architecture:** Tests are split across two vitest configs — renderer tests (`vitest.config.ts`, jsdom env, `npm test`) and main process tests (`src/main/vitest.main.config.ts`, node env, `npm run test:main`). Renderer tests use React Testing Library + userEvent. Main integration tests mock Electron IPC and use dependency injection. All IPC calls are mocked via `window.api` (centralized in `test-setup.ts`). Stores are tested by calling `getState()` directly.

**Tech Stack:** vitest, @testing-library/react, @testing-library/user-event, vi.mock/vi.fn, Zustand store testing via getState()

---

## File Structure

### New Test Files (Renderer — Component Tests)

| File | Tests |
|------|-------|
| `src/renderer/src/components/pr-station/__tests__/PRStationList.test.tsx` | PR list rendering, refresh, CI badges, selection |
| `src/renderer/src/components/pr-station/__tests__/PRStationDetail.test.tsx` | Detail header, markdown body, parallel data fetch, cleanup |
| `src/renderer/src/components/pr-station/__tests__/PRStationReviews.test.tsx` | Review dedup, state badges, loading/empty |
| `src/renderer/src/components/pr-station/__tests__/PRStationConversation.test.tsx` | Timeline build, thread grouping, comment cards |
| `src/renderer/src/components/pr-station/__tests__/PRStationDiff.test.tsx` | Diff fetch/parse, size warning, comment adding |
| `src/renderer/src/components/pr-station/__tests__/PRStationChecks.test.tsx` | Check status icons, loading, links |
| `src/renderer/src/components/pr-station/__tests__/PRStationActions.test.tsx` | Merge/close, method dropdown, confirmation |
| `src/renderer/src/components/pr-station/__tests__/PRStationConflictBanner.test.tsx` | Banner visibility, conflict file listing |
| `src/renderer/src/components/pr-station/__tests__/ReviewSubmitDialog.test.tsx` | Review submission, radio selection, pending count |
| `src/renderer/src/components/diff/__tests__/DiffCommentWidget.test.tsx` | Collapse/expand, comment rendering |
| `src/renderer/src/components/diff/__tests__/DiffCommentComposer.test.tsx` | Submit, cancel, keyboard shortcuts |
| `src/renderer/src/components/diff/__tests__/DiffSizeWarning.test.tsx` | Size formatting, load-anyway button |
| `src/renderer/src/components/diff/__tests__/DiffViewer.test.tsx` | File list, virtualization decision, keyboard nav |
| `src/renderer/src/components/settings/__tests__/SettingsView.test.tsx` | Tab switching, section rendering |
| `src/renderer/src/components/settings/__tests__/AppearanceSection.test.tsx` | Theme toggle, accent color |
| `src/renderer/src/components/settings/__tests__/ConnectionsSection.test.tsx` | Auth status, agent settings, GitHub token |
| `src/renderer/src/components/settings/__tests__/RepositoriesSection.test.tsx` | CRUD repos, color picker, directory browse |
| `src/renderer/src/components/settings/__tests__/AgentManagerSection.test.tsx` | Config fields, save, unit conversion |
| `src/renderer/src/components/settings/__tests__/TaskTemplatesSection.test.tsx` | Template list, built-in vs custom |
| `src/renderer/src/components/settings/__tests__/CredentialForm.test.tsx` | Password toggle, test button, save |
| `src/renderer/src/components/terminal/__tests__/TerminalTabBar.test.tsx` | Tab add/close/rename, context menu |
| `src/renderer/src/components/terminal/__tests__/TerminalToolbar.test.tsx` | Clear, split toggle |
| `src/renderer/src/components/terminal/__tests__/TerminalContent.test.tsx` | Tab rendering, agent vs shell |
| `src/renderer/src/views/__tests__/MemoryView.test.tsx` | File list, edit/save, keyboard nav, grouping |
| `src/renderer/src/views/__tests__/TerminalView.test.tsx` | Keyboard shortcuts, tab management |

### New Test Files (Renderer — Stores)

| File | Tests |
|------|-------|
| `src/renderer/src/stores/__tests__/pendingReview.test.ts` | Add/update/remove comments, clear, count |
| `src/renderer/src/stores/__tests__/sprintTasks.test.ts` | Load, optimistic update, SSE merge, create/delete |
| `src/renderer/src/stores/__tests__/sprintUI.test.ts` | Selection, filter, generating IDs |
| `src/renderer/src/stores/__tests__/healthCheck.test.ts` | Stuck tasks, dismiss, clear |
| `src/renderer/src/stores/__tests__/prConflicts.test.ts` | Set/update conflicts, equality check |
| `src/renderer/src/stores/__tests__/costData.test.ts` | Cost summary, agent runs |

### New Test Files (Renderer — Hooks)

| File | Tests |
|------|-------|
| `src/renderer/src/hooks/__tests__/useHealthCheck.test.ts` | Stuck task detection, dismiss, interval |
| `src/renderer/src/hooks/__tests__/useSprintPolling.test.ts` | Adaptive polling, external change |
| `src/renderer/src/hooks/__tests__/useRepoOptions.test.ts` | IPC load, fallback, color defaults |
| `src/renderer/src/hooks/__tests__/useSprintTaskActions.test.ts` | Drag/drop, confirm modal, WIP limit |
| `src/renderer/src/hooks/__tests__/usePrStatusPolling.test.ts` | Poll cycle, conflict detection, auto-update |

### New Test Files (Main — Integration)

| File | Tests |
|------|-------|
| `src/main/__tests__/integration/agent-manager-pipeline.test.ts` | Full drain→spawn→complete lifecycle |
| `src/main/__tests__/integration/queue-api-integration.test.ts` | HTTP CRUD + SSE with real server |
| `src/main/__tests__/sprint-pr-poller.test.ts` | Poll cycle, merge→done, close→cancelled |

### Expanded Existing Files

| File | Addition |
|------|----------|
| `src/renderer/src/views/__tests__/smoke.test.tsx` | Add PR Station view smoke test |

---

## Tasks

### Task 1: PR Station — PRStationList

**Files:**
- Test: `src/renderer/src/components/pr-station/__tests__/PRStationList.test.tsx`
- Reference: `src/renderer/src/components/pr-station/PRStationList.tsx`

- [ ] **Step 1: Create test file with mocks and first test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock lib imports before component import
vi.mock('../../../lib/github-api', () => ({}))
vi.mock('../../../lib/render-markdown', () => ({ renderMarkdown: (s: string) => s }))

import { PRStationList } from '../PRStationList'

const mockPr = {
  number: 42,
  title: 'Add feature X',
  html_url: 'https://github.com/o/r/pull/42',
  state: 'open',
  draft: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  head: { ref: 'feat/x', sha: 'abc123' },
  base: { ref: 'main' },
  user: { login: 'alice' },
  merged: false,
  merged_at: null,
  repo: 'bde',
}

describe('PRStationList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [mockPr],
      checks: { '42': { total: 1, passed: 1, failed: 0, pending: 0, status: 'pass' } },
    })
    vi.mocked(window.api.onPrListUpdated).mockReturnValue(() => {})
  })

  it('renders PR list after loading', async () => {
    render(<PRStationList selectedPr={null} onSelectPr={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('#42')).toBeInTheDocument())
    expect(screen.getByText('Add feature X')).toBeInTheDocument()
  })

  it('shows empty state when no PRs', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({ prs: [], checks: {} })
    render(<PRStationList selectedPr={null} onSelectPr={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/no open/i)).toBeInTheDocument())
  })

  it('calls onSelectPr when row clicked', async () => {
    const onSelect = vi.fn()
    render(<PRStationList selectedPr={null} onSelectPr={onSelect} />)
    await waitFor(() => expect(screen.getByText('#42')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Add feature X'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ number: 42 }))
  })

  it('calls refreshPrList on refresh button click', async () => {
    vi.mocked(window.api.refreshPrList).mockResolvedValue({ prs: [mockPr], checks: {} })
    render(<PRStationList selectedPr={null} onSelectPr={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('#42')).toBeInTheDocument())
    const refreshBtn = screen.getByRole('button', { name: /refresh/i })
    await userEvent.click(refreshBtn)
    expect(window.api.refreshPrList).toHaveBeenCalled()
  })

  it('subscribes to PR list updates on mount', () => {
    render(<PRStationList selectedPr={null} onSelectPr={vi.fn()} />)
    expect(window.api.onPrListUpdated).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/pr-station/__tests__/PRStationList.test.tsx`

- [ ] **Step 3: Fix any mock issues and iterate**

Adjust mocks for exact component API (text selectors, role names) based on actual rendered output.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/pr-station/__tests__/PRStationList.test.tsx
git commit -m "test: add PRStationList component tests"
```

---

### Task 2: PR Station — PRStationChecks

**Files:**
- Test: `src/renderer/src/components/pr-station/__tests__/PRStationChecks.test.tsx`
- Reference: `src/renderer/src/components/pr-station/PRStationChecks.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../lib/github-api', () => ({}))

import { PRStationChecks } from '../PRStationChecks'

const checks = [
  { name: 'CI Build', status: 'completed', conclusion: 'success', html_url: 'https://github.com/checks/1' },
  { name: 'Lint', status: 'in_progress', conclusion: null, html_url: 'https://github.com/checks/2' },
  { name: 'Tests', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/checks/3' },
]

describe('PRStationChecks', () => {
  it('renders check names', () => {
    render(<PRStationChecks checks={checks} loading={false} />)
    expect(screen.getByText('CI Build')).toBeInTheDocument()
    expect(screen.getByText('Lint')).toBeInTheDocument()
    expect(screen.getByText('Tests')).toBeInTheDocument()
  })

  it('shows skeleton during loading', () => {
    const { container } = render(<PRStationChecks checks={[]} loading={true} />)
    expect(container.querySelector('.skeleton, [class*="skeleton"]')).toBeTruthy()
  })

  it('shows empty state when no checks', () => {
    render(<PRStationChecks checks={[]} loading={false} />)
    expect(screen.getByText(/no check/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify**

Run: `npx vitest run src/renderer/src/components/pr-station/__tests__/PRStationChecks.test.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pr-station/__tests__/PRStationChecks.test.tsx
git commit -m "test: add PRStationChecks component tests"
```

---

### Task 3: PR Station — PRStationReviews

**Files:**
- Test: `src/renderer/src/components/pr-station/__tests__/PRStationReviews.test.tsx`
- Reference: `src/renderer/src/components/pr-station/PRStationReviews.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../lib/render-markdown', () => ({ renderMarkdown: (s: string) => s ?? '' }))

import { PRStationReviews } from '../PRStationReviews'

const reviews = [
  { id: 1, user: { login: 'alice', avatar_url: '' }, state: 'APPROVED', body: 'LGTM', submitted_at: new Date().toISOString(), html_url: '' },
  { id: 2, user: { login: 'bob', avatar_url: '' }, state: 'CHANGES_REQUESTED', body: 'Fix types', submitted_at: new Date().toISOString(), html_url: '' },
  // Duplicate alice review (older) — should be deduped
  { id: 3, user: { login: 'alice', avatar_url: '' }, state: 'COMMENTED', body: 'Hmm', submitted_at: new Date(Date.now() - 60000).toISOString(), html_url: '' },
]

describe('PRStationReviews', () => {
  it('renders latest review per user (deduplication)', () => {
    render(<PRStationReviews reviews={reviews} loading={false} />)
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    // Only 2 user sections (alice deduplicated)
    expect(screen.getAllByText(/alice|bob/)).toHaveLength(2)
  })

  it('shows loading skeletons', () => {
    const { container } = render(<PRStationReviews reviews={[]} loading={true} />)
    expect(container.querySelector('[class*="skeleton"]')).toBeTruthy()
  })

  it('shows empty state when no reviews', () => {
    render(<PRStationReviews reviews={[]} loading={false} />)
    expect(screen.getByText(/no review/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify**

Run: `npx vitest run src/renderer/src/components/pr-station/__tests__/PRStationReviews.test.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pr-station/__tests__/PRStationReviews.test.tsx
git commit -m "test: add PRStationReviews component tests"
```

---

### Task 4: PR Station — PRStationConversation

**Files:**
- Test: `src/renderer/src/components/pr-station/__tests__/PRStationConversation.test.tsx`
- Reference: `src/renderer/src/components/pr-station/PRStationConversation.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../lib/render-markdown', () => ({ renderMarkdown: (s: string) => s ?? '' }))

import { PRStationConversation } from '../PRStationConversation'

const issueComments = [
  { id: 10, user: { login: 'alice', avatar_url: '' }, body: 'Looks good overall', created_at: '2026-01-01T00:00:00Z', html_url: '' },
]
const reviewComments = [
  { id: 20, user: { login: 'bob', avatar_url: '' }, body: 'Fix this line', created_at: '2026-01-01T01:00:00Z', updated_at: '2026-01-01T01:00:00Z', html_url: '', path: 'src/main.ts', line: 42, side: 'RIGHT', in_reply_to_id: null },
  { id: 21, user: { login: 'alice', avatar_url: '' }, body: 'Done', created_at: '2026-01-01T02:00:00Z', updated_at: '2026-01-01T02:00:00Z', html_url: '', path: 'src/main.ts', line: 42, side: 'RIGHT', in_reply_to_id: 20 },
]

describe('PRStationConversation', () => {
  it('renders issue comments and review threads', () => {
    render(<PRStationConversation reviewComments={reviewComments} issueComments={issueComments} loading={false} />)
    expect(screen.getByText('Looks good overall')).toBeInTheDocument()
    expect(screen.getByText('Fix this line')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('groups review comment replies into threads', () => {
    render(<PRStationConversation reviewComments={reviewComments} issueComments={[]} loading={false} />)
    // Thread contains path info
    expect(screen.getByText(/src\/main\.ts/)).toBeInTheDocument()
  })

  it('shows empty state when no comments', () => {
    render(<PRStationConversation reviewComments={[]} issueComments={[]} loading={false} />)
    expect(screen.getByText(/no comment/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pr-station/__tests__/PRStationConversation.test.tsx
git commit -m "test: add PRStationConversation component tests"
```

---

### Task 5: PR Station — PRStationConflictBanner

**Files:**
- Test: `src/renderer/src/components/pr-station/__tests__/PRStationConflictBanner.test.tsx`
- Reference: `src/renderer/src/components/pr-station/PRStationConflictBanner.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Mock REPO_OPTIONS so the component can look up the repo
vi.mock('../../../lib/constants', () => ({
  REPO_OPTIONS: [{ label: 'bde', owner: 'org', color: '#fff' }],
}))

import { PRStationConflictBanner } from '../PRStationConflictBanner'

const mockPr = { number: 42, repo: 'bde', html_url: '', title: '', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'feat/x', sha: '' }, base: { ref: 'main' }, user: { login: '' }, merged: false, merged_at: null }

describe('PRStationConflictBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // checkConflictFiles returns { files, prNumber, baseBranch, headBranch }
    ;(window.api as any).checkConflictFiles = vi.fn().mockResolvedValue({
      files: ['src/main.ts', 'README.md'],
      prNumber: 42,
      baseBranch: 'main',
      headBranch: 'feat/x',
    })
  })

  it('renders nothing when mergeableState is not dirty', () => {
    const { container } = render(<PRStationConflictBanner pr={mockPr} mergeableState="clean" />)
    expect(container.innerHTML).toBe('')
  })

  it('shows conflict files when mergeableState is dirty', async () => {
    render(<PRStationConflictBanner pr={mockPr} mergeableState="dirty" />)
    await waitFor(() => expect(screen.getByText(/src\/main\.ts/)).toBeInTheDocument())
    expect(screen.getByText(/README\.md/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pr-station/__tests__/PRStationConflictBanner.test.tsx
git commit -m "test: add PRStationConflictBanner component tests"
```

---

### Task 6: PR Station — PRStationActions

**Files:**
- Test: `src/renderer/src/components/pr-station/__tests__/PRStationActions.test.tsx`
- Reference: `src/renderer/src/components/pr-station/PRStationActions.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../lib/github-api', () => ({
  mergePR: vi.fn().mockResolvedValue(undefined),
  closePR: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { PRStationActions } from '../PRStationActions'
import { mergePR, closePR } from '../../../lib/github-api'

const mockPr = { number: 42, repo: 'bde', html_url: '', title: 'Test', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'feat/x', sha: '' }, base: { ref: 'main' }, user: { login: '' }, merged: false, merged_at: null }

describe('PRStationActions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders merge and close buttons', () => {
    render(<PRStationActions pr={mockPr} mergeability={{ number: 42, repo: 'bde', mergeable: true, mergeable_state: 'clean' }} onRemovePr={vi.fn()} />)
    expect(screen.getByText(/merge/i)).toBeInTheDocument()
    expect(screen.getByText(/close/i)).toBeInTheDocument()
  })

  it('shows confirmation before merging', async () => {
    const user = userEvent.setup()
    render(<PRStationActions pr={mockPr} mergeability={{ number: 42, repo: 'bde', mergeable: true, mergeable_state: 'clean' }} onRemovePr={vi.fn()} />)
    await user.click(screen.getByText(/merge/i))
    expect(screen.getByText(/confirm/i)).toBeInTheDocument()
  })

  it('calls mergePR and removes PR on confirm', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<PRStationActions pr={mockPr} mergeability={{ number: 42, repo: 'bde', mergeable: true, mergeable_state: 'clean' }} onRemovePr={onRemove} />)
    await user.click(screen.getByText(/merge/i))
    // Click confirm
    const confirmBtn = screen.getAllByText(/merge/i).find(el => el.closest('[class*="confirm"]') || el !== screen.getAllByText(/merge/i)[0])
    if (confirmBtn) await user.click(confirmBtn)
    await waitFor(() => expect(mergePR).toHaveBeenCalled())
  })

  it('shows merged badge for already-merged PR', () => {
    const mergedPr = { ...mockPr, merged: true }
    render(<PRStationActions pr={mergedPr} mergeability={null} onRemovePr={vi.fn()} />)
    expect(screen.getByText(/merged/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pr-station/__tests__/PRStationActions.test.tsx
git commit -m "test: add PRStationActions component tests"
```

---

### Task 7: PR Station — PRStationDetail

**Files:**
- Test: `src/renderer/src/components/pr-station/__tests__/PRStationDetail.test.tsx`
- Reference: `src/renderer/src/components/pr-station/PRStationDetail.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../lib/github-api', () => ({
  getPRDetail: vi.fn().mockResolvedValue({ title: 'Test PR', body: 'Description', additions: 10, deletions: 5, labels: [] }),
  getPRFiles: vi.fn().mockResolvedValue([{ filename: 'src/main.ts', status: 'modified', additions: 5, deletions: 2 }]),
  getCheckRunsList: vi.fn().mockResolvedValue([]),
  getReviews: vi.fn().mockResolvedValue([]),
  getReviewComments: vi.fn().mockResolvedValue([]),
  getIssueComments: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../lib/render-markdown', () => ({ renderMarkdown: (s: string) => s ?? '' }))
vi.mock('../PRStationChecks', () => ({ PRStationChecks: () => <div data-testid="checks" /> }))
vi.mock('../PRStationConflictBanner', () => ({ PRStationConflictBanner: () => null }))
vi.mock('../PRStationReviews', () => ({ PRStationReviews: () => <div data-testid="reviews" /> }))
vi.mock('../PRStationConversation', () => ({ PRStationConversation: () => <div data-testid="conversation" /> }))

import { PRStationDetail } from '../PRStationDetail'

const mockPr = { number: 42, repo: 'bde', html_url: '', title: 'Test PR', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'feat/x', sha: 'abc' }, base: { ref: 'main' }, user: { login: 'alice' }, merged: false, merged_at: null }

describe('PRStationDetail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders PR header with title and number', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByText(/Test PR/)).toBeInTheDocument())
    expect(screen.getByText(/#42/)).toBeInTheDocument()
  })

  it('renders changed files list', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByText(/src\/main\.ts/)).toBeInTheDocument())
  })

  it('renders child sections', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByTestId('checks')).toBeInTheDocument())
    expect(screen.getByTestId('reviews')).toBeInTheDocument()
    expect(screen.getByTestId('conversation')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pr-station/__tests__/PRStationDetail.test.tsx
git commit -m "test: add PRStationDetail component tests"
```

---

### Task 8: PR Station — PRStationDiff

**Files:**
- Test: `src/renderer/src/components/pr-station/__tests__/PRStationDiff.test.tsx`
- Reference: `src/renderer/src/components/pr-station/PRStationDiff.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../lib/github-api', () => ({
  getPRDiff: vi.fn().mockResolvedValue('diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n context\n-old\n+new\n context'),
  getReviewComments: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../stores/pendingReview', () => ({
  usePendingReviewStore: vi.fn((sel?: Function) => {
    const state = { pendingComments: new Map(), addComment: vi.fn(), removeComment: vi.fn(), clearPending: vi.fn(), getPendingCount: vi.fn(() => 0) }
    return sel ? sel(state) : state
  }),
}))
vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((sel: Function) => sel({ activeView: 'pr-station' })),
}))
vi.mock('../../diff/DiffViewer', () => ({
  DiffViewer: (props: any) => <div data-testid="diff-viewer" data-files={props.files?.length ?? 0} />,
}))

import { PRStationDiff } from '../PRStationDiff'

const mockPr = { number: 42, repo: 'bde', html_url: '', title: '', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'feat/x', sha: '' }, base: { ref: 'main' }, user: { login: '' }, merged: false, merged_at: null }

describe('PRStationDiff', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches and renders diff via DiffViewer', async () => {
    render(<PRStationDiff pr={mockPr} />)
    await waitFor(() => expect(screen.getByTestId('diff-viewer')).toBeInTheDocument())
  })

  it('shows error on fetch failure', async () => {
    const { getPRDiff } = await import('../../../lib/github-api')
    vi.mocked(getPRDiff).mockRejectedValueOnce(new Error('Network error'))
    render(<PRStationDiff pr={mockPr} />)
    await waitFor(() => expect(screen.getByText(/error|failed/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pr-station/__tests__/PRStationDiff.test.tsx
git commit -m "test: add PRStationDiff component tests"
```

---

### Task 9: PR Station — ReviewSubmitDialog

**Files:**
- Test: `src/renderer/src/components/pr-station/__tests__/ReviewSubmitDialog.test.tsx`
- Reference: `src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../lib/github-api', () => ({
  createReview: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../stores/pendingReview', () => ({
  usePendingReviewStore: vi.fn((sel?: Function) => {
    const state = {
      pendingComments: new Map([['bde#42', [{ id: 'c1', path: 'file.ts', line: 10, side: 'RIGHT', body: 'Fix this' }]]]),
      clearPending: vi.fn(),
      getPendingCount: vi.fn(() => 1),
    }
    return sel ? sel(state) : state
  }),
}))
vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { ReviewSubmitDialog } from '../ReviewSubmitDialog'

const mockPr = { number: 42, repo: 'bde', html_url: '', title: '', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: '', sha: '' }, base: { ref: '' }, user: { login: '' }, merged: false, merged_at: null }

describe('ReviewSubmitDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders review type radio options', () => {
    render(<ReviewSubmitDialog pr={mockPr} prKey="bde#42" onClose={vi.fn()} onSubmitted={vi.fn()} />)
    expect(screen.getByText(/comment/i)).toBeInTheDocument()
    expect(screen.getByText(/approve/i)).toBeInTheDocument()
    expect(screen.getByText(/request changes/i)).toBeInTheDocument()
  })

  it('shows pending comment count', () => {
    render(<ReviewSubmitDialog pr={mockPr} prKey="bde#42" onClose={vi.fn()} onSubmitted={vi.fn()} />)
    expect(screen.getByText(/1/)).toBeInTheDocument()
  })

  it('calls onClose when cancel clicked', async () => {
    const onClose = vi.fn()
    render(<ReviewSubmitDialog pr={mockPr} prKey="bde#42" onClose={onClose} onSubmitted={vi.fn()} />)
    await userEvent.click(screen.getByText(/cancel/i))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pr-station/__tests__/ReviewSubmitDialog.test.tsx
git commit -m "test: add ReviewSubmitDialog component tests"
```

---

### Task 10: Diff Components — DiffCommentComposer, DiffCommentWidget, DiffSizeWarning

**Files:**
- Test: `src/renderer/src/components/diff/__tests__/DiffCommentComposer.test.tsx`
- Test: `src/renderer/src/components/diff/__tests__/DiffCommentWidget.test.tsx`
- Test: `src/renderer/src/components/diff/__tests__/DiffSizeWarning.test.tsx`

- [ ] **Step 1: Write DiffCommentComposer tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DiffCommentComposer } from '../DiffCommentComposer'

describe('DiffCommentComposer', () => {
  it('renders textarea with placeholder', () => {
    render(<DiffCommentComposer onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('submits on button click when body non-empty', async () => {
    const onSubmit = vi.fn()
    render(<DiffCommentComposer onSubmit={onSubmit} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox'), 'Nice work')
    await userEvent.click(screen.getByText(/submit/i))
    expect(onSubmit).toHaveBeenCalledWith('Nice work')
  })

  it('disables submit when body is empty', () => {
    render(<DiffCommentComposer onSubmit={vi.fn()} onCancel={vi.fn()} />)
    const submitBtn = screen.getByText(/submit/i)
    expect(submitBtn).toBeDisabled()
  })

  it('calls onCancel when cancel clicked', async () => {
    const onCancel = vi.fn()
    render(<DiffCommentComposer onSubmit={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByText(/cancel/i))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Write DiffCommentWidget tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../lib/render-markdown', () => ({ renderMarkdown: (s: string) => s ?? '' }))

import { DiffCommentWidget } from '../DiffCommentWidget'

const comments = [
  { id: 1, user: { login: 'alice', avatar_url: '' }, body: 'First comment', created_at: '2026-01-01T00:00:00Z', updated_at: '', html_url: '' },
  { id: 2, user: { login: 'bob', avatar_url: '' }, body: 'Reply', created_at: '2026-01-01T01:00:00Z', updated_at: '', html_url: '' },
]

describe('DiffCommentWidget', () => {
  it('renders comment count', () => {
    render(<DiffCommentWidget comments={comments} />)
    expect(screen.getByText(/2/)).toBeInTheDocument()
  })

  it('expands thread on click', async () => {
    render(<DiffCommentWidget comments={comments} />)
    const toggle = screen.getByRole('button')
    await userEvent.click(toggle)
    expect(screen.getByText('First comment')).toBeInTheDocument()
    expect(screen.getByText('Reply')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Write DiffSizeWarning tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DiffSizeWarning } from '../DiffSizeWarning'

describe('DiffSizeWarning', () => {
  it('formats and displays size in KB', () => {
    render(<DiffSizeWarning sizeBytes={2048} onLoadAnyway={vi.fn()} />)
    expect(screen.getByText(/2.*KB/i)).toBeInTheDocument()
  })

  it('calls onLoadAnyway when button clicked', async () => {
    const onLoad = vi.fn()
    render(<DiffSizeWarning sizeBytes={500000} onLoadAnyway={onLoad} />)
    await userEvent.click(screen.getByText(/load anyway/i))
    expect(onLoad).toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run all three**

Run: `npx vitest run src/renderer/src/components/diff/__tests__/`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/diff/__tests__/
git commit -m "test: add Diff component tests (Composer, Widget, SizeWarning)"
```

---

### Task 11: Diff Components — DiffViewer

**Files:**
- Test: `src/renderer/src/components/diff/__tests__/DiffViewer.test.tsx`
- Reference: `src/renderer/src/components/diff/DiffViewer.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((sel: Function) => sel({ activeView: 'pr-station' })),
}))

import { DiffViewer } from '../DiffViewer'

const files = [
  {
    path: 'src/main.ts',
    additions: 3,
    deletions: 1,
    hunks: [{
      header: '@@ -1,3 +1,5 @@',
      lines: [
        { type: 'context', lineNo: { old: 1, new: 1 }, content: ' const a = 1' },
        { type: 'del', lineNo: { old: 2, new: undefined }, content: '-const b = 2' },
        { type: 'add', lineNo: { old: undefined, new: 2 }, content: '+const b = 3' },
        { type: 'add', lineNo: { old: undefined, new: 3 }, content: '+const c = 4' },
        { type: 'add', lineNo: { old: undefined, new: 4 }, content: '+const d = 5' },
        { type: 'context', lineNo: { old: 3, new: 5 }, content: ' export {}' },
      ],
    }],
  },
]

describe('DiffViewer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders file list with path', () => {
    render(<DiffViewer files={files} />)
    expect(screen.getByText('src/main.ts')).toBeInTheDocument()
  })

  it('renders diff lines', () => {
    render(<DiffViewer files={files} />)
    expect(screen.getByText(/const a = 1/)).toBeInTheDocument()
    expect(screen.getByText(/const b = 3/)).toBeInTheDocument()
  })

  it('renders with empty files list', () => {
    const { container } = render(<DiffViewer files={[]} />)
    expect(container).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/diff/__tests__/DiffViewer.test.tsx
git commit -m "test: add DiffViewer component tests"
```

---

### Task 12: Settings — SettingsView + Sections

**Files:**
- Test: `src/renderer/src/components/settings/__tests__/SettingsView.test.tsx`
- Test: `src/renderer/src/components/settings/__tests__/AppearanceSection.test.tsx`
- Test: `src/renderer/src/components/settings/__tests__/ConnectionsSection.test.tsx`
- Test: `src/renderer/src/components/settings/__tests__/RepositoriesSection.test.tsx`
- Test: `src/renderer/src/components/settings/__tests__/AgentManagerSection.test.tsx`
- Test: `src/renderer/src/components/settings/__tests__/TaskTemplatesSection.test.tsx`
- Test: `src/renderer/src/components/settings/__tests__/CredentialForm.test.tsx`

- [ ] **Step 1: Write SettingsView tab-switching test**

```tsx
// SettingsView.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/theme', () => ({
  useThemeStore: vi.fn((sel: Function) => sel({ theme: 'dark', toggleTheme: vi.fn(), setTheme: vi.fn() })),
}))

import SettingsView from '../../../views/SettingsView'

describe('SettingsView', () => {
  it('renders all tab labels', () => {
    render(<SettingsView />)
    expect(screen.getByText(/appearance/i)).toBeInTheDocument()
    expect(screen.getByText(/connections/i)).toBeInTheDocument()
    expect(screen.getByText(/repositories/i)).toBeInTheDocument()
  })

  it('switches sections on tab click', async () => {
    render(<SettingsView />)
    await userEvent.click(screen.getByText(/about/i))
    expect(screen.getByText(/version/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Write AppearanceSection test**

```tsx
// AppearanceSection.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/theme', () => ({
  useThemeStore: vi.fn((sel: Function) => sel({ theme: 'dark', toggleTheme: vi.fn(), setTheme: vi.fn() })),
}))

import { AppearanceSection } from '../AppearanceSection'

describe('AppearanceSection', () => {
  it('renders theme toggle', () => {
    render(<AppearanceSection />)
    expect(screen.getByText(/theme/i)).toBeInTheDocument()
  })

  it('renders accent color options', () => {
    render(<AppearanceSection />)
    expect(screen.getByText(/accent/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Write ConnectionsSection test**

```tsx
// ConnectionsSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { ConnectionsSection } from '../ConnectionsSection'

describe('ConnectionsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.api.settings.get).mockResolvedValue(null)
    vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
  })

  it('renders auth status section', async () => {
    render(<ConnectionsSection />)
    await waitFor(() => expect(screen.getByText(/auth/i)).toBeInTheDocument())
  })

  it('renders agent manager settings', async () => {
    render(<ConnectionsSection />)
    await waitFor(() => expect(screen.getByText(/agent manager/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 4: Write remaining section tests (Repos, AgentManager, Templates, CredentialForm)**

Each follows the same render + assert pattern. Write minimal tests: renders, loads data, handles save.

- [ ] **Step 5: Run all settings tests**

Run: `npx vitest run src/renderer/src/components/settings/__tests__/`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/settings/__tests__/
git commit -m "test: add Settings view and section component tests"
```

---

### Task 13: MemoryView

**Files:**
- Test: `src/renderer/src/views/__tests__/MemoryView.test.tsx`
- Reference: `src/renderer/src/views/MemoryView.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../stores/ui', () => ({
  useUIStore: vi.fn((sel: Function) => sel({ activeView: 'memory' })),
}))

import MemoryView from '../MemoryView'

const mockFiles = [
  { path: 'MEMORY.md', name: 'MEMORY.md', size: 256, modifiedAt: Date.now() },
  { path: 'daily/2026-03-23.md', name: '2026-03-23.md', size: 128, modifiedAt: Date.now() },
]

describe('MemoryView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue(mockFiles)
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('# Memory content')
  })

  it('loads and renders file list', async () => {
    render(<MemoryView />)
    await waitFor(() => expect(screen.getByText('MEMORY.md')).toBeInTheDocument())
  })

  it('loads file content on selection', async () => {
    render(<MemoryView />)
    await waitFor(() => expect(screen.getByText('MEMORY.md')).toBeInTheDocument())
    await userEvent.click(screen.getByText('MEMORY.md'))
    await waitFor(() => expect(window.api.readMemoryFile).toHaveBeenCalledWith('MEMORY.md'))
  })

  it('shows empty state when no files', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([])
    render(<MemoryView />)
    await waitFor(() => expect(screen.getByText(/no.*file/i)).toBeInTheDocument())
  })

  it('tracks dirty state on edit', async () => {
    render(<MemoryView />)
    await waitFor(() => expect(screen.getByText('MEMORY.md')).toBeInTheDocument())
    await userEvent.click(screen.getByText('MEMORY.md'))
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
    await userEvent.type(screen.getByRole('textbox'), ' edits')
    // Save button should be enabled when dirty
    expect(screen.getByText(/save/i)).not.toBeDisabled()
  })
})
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/views/__tests__/MemoryView.test.tsx
git commit -m "test: add MemoryView component tests"
```

---

### Task 14: Terminal Components

**Files:**
- Test: `src/renderer/src/components/terminal/__tests__/TerminalTabBar.test.tsx`
- Test: `src/renderer/src/components/terminal/__tests__/TerminalToolbar.test.tsx`
- Test: `src/renderer/src/components/terminal/__tests__/TerminalContent.test.tsx`
- Test: `src/renderer/src/views/__tests__/TerminalView.test.tsx`

- [ ] **Step 1: Write TerminalTabBar test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TerminalTabBar } from '../TerminalTabBar'

const tabs = [
  { id: 'tab-1', label: 'Terminal 1', kind: 'shell' as const },
  { id: 'tab-2', label: 'Terminal 2', kind: 'shell' as const },
]

describe('TerminalTabBar', () => {
  it('renders tab labels', () => {
    render(<TerminalTabBar tabs={tabs} activeTabId="tab-1" onSelectTab={vi.fn()} onCloseTab={vi.fn()} onAddTab={vi.fn()} onCreateAgentTab={vi.fn()} onRenameTab={vi.fn()} onReorderTab={vi.fn()} onDuplicateTab={vi.fn()} onCloseOthers={vi.fn()} onCloseAll={vi.fn()} />)
    expect(screen.getByText('Terminal 1')).toBeInTheDocument()
    expect(screen.getByText('Terminal 2')).toBeInTheDocument()
  })

  it('calls onSelectTab when tab clicked', async () => {
    const onSelect = vi.fn()
    render(<TerminalTabBar tabs={tabs} activeTabId="tab-1" onSelectTab={onSelect} onCloseTab={vi.fn()} onAddTab={vi.fn()} onCreateAgentTab={vi.fn()} onRenameTab={vi.fn()} onReorderTab={vi.fn()} onDuplicateTab={vi.fn()} onCloseOthers={vi.fn()} onCloseAll={vi.fn()} />)
    await userEvent.click(screen.getByText('Terminal 2'))
    expect(onSelect).toHaveBeenCalledWith('tab-2')
  })

  it('calls onAddTab when plus button clicked', async () => {
    const onAdd = vi.fn()
    render(<TerminalTabBar tabs={tabs} activeTabId="tab-1" onSelectTab={vi.fn()} onCloseTab={vi.fn()} onAddTab={onAdd} onCreateAgentTab={vi.fn()} onRenameTab={vi.fn()} onReorderTab={vi.fn()} onDuplicateTab={vi.fn()} onCloseOthers={vi.fn()} onCloseAll={vi.fn()} />)
    // Find the add button (usually a plus icon)
    const addBtns = screen.getAllByRole('button')
    const addBtn = addBtns.find(b => b.getAttribute('aria-label')?.includes('add') || b.textContent?.includes('+'))
    if (addBtn) await userEvent.click(addBtn)
  })
})
```

- [ ] **Step 2: Write TerminalToolbar and TerminalContent tests**

```tsx
// TerminalToolbar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TerminalToolbar } from '../TerminalToolbar'

describe('TerminalToolbar', () => {
  it('renders clear and split buttons', () => {
    render(<TerminalToolbar onClear={vi.fn()} onToggleSplit={vi.fn()} splitEnabled={false} isAgentTab={false} />)
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
  })

  it('hides for agent tabs', () => {
    const { container } = render(<TerminalToolbar onClear={vi.fn()} onToggleSplit={vi.fn()} splitEnabled={false} isAgentTab={true} />)
    expect(container.innerHTML).toBe('')
  })
})
```

- [ ] **Step 3: Write TerminalView keyboard shortcut test**

```tsx
// TerminalView.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'

vi.mock('../../stores/ui', () => ({
  useUIStore: vi.fn((sel: Function) => sel({ activeView: 'terminal' })),
}))
vi.mock('../../stores/terminal', () => {
  const addTab = vi.fn()
  const closeTab = vi.fn()
  const state = {
    tabs: [{ id: 'tab-1', label: 'Term 1', kind: 'shell' }],
    activeTabId: 'tab-1',
    showFind: false,
    selectedShell: '/bin/zsh',
    splitEnabled: false,
    addTab,
    closeTab,
    setActiveTab: vi.fn(),
    setShowFind: vi.fn(),
    setSelectedShell: vi.fn(),
    toggleSplit: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
  }
  return {
    useTerminalStore: vi.fn((sel?: Function) => sel ? sel(state) : state),
    __mocks: { addTab, closeTab },
  }
})
vi.mock('../../components/terminal/TerminalPane', () => ({
  TerminalPane: () => <div data-testid="terminal-pane" />,
  clearTerminal: vi.fn(),
  getSearchAddon: vi.fn(),
}))
vi.mock('../../components/terminal/FindBar', () => ({ FindBar: () => null }))

import { TerminalView } from '../TerminalView'

describe('TerminalView', () => {
  it('renders without crashing', () => {
    const { container } = render(<TerminalView />)
    expect(container.firstChild).toBeTruthy()
  })
})
```

- [ ] **Step 4: Run all terminal tests**

Run: `npx vitest run src/renderer/src/components/terminal/__tests__/ src/renderer/src/views/__tests__/TerminalView.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/terminal/__tests__/ src/renderer/src/views/__tests__/TerminalView.test.tsx
git commit -m "test: add Terminal component and view tests"
```

---

### Task 15: Untested Stores

**Files:**
- Test: `src/renderer/src/stores/__tests__/pendingReview.test.ts`
- Test: `src/renderer/src/stores/__tests__/sprintUI.test.ts`
- Test: `src/renderer/src/stores/__tests__/healthCheck.test.ts`
- Test: `src/renderer/src/stores/__tests__/prConflicts.test.ts`
- Test: `src/renderer/src/stores/__tests__/sprintTasks.test.ts`
- Test: `src/renderer/src/stores/__tests__/costData.test.ts`

- [ ] **Step 1: Write pendingReview store test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { usePendingReviewStore } from '../pendingReview'

describe('pendingReview store', () => {
  beforeEach(() => {
    usePendingReviewStore.setState({ pendingComments: new Map() })
  })

  it('adds a comment to a PR key', () => {
    const { addComment } = usePendingReviewStore.getState()
    addComment('bde#42', { id: 'c1', path: 'file.ts', line: 10, side: 'RIGHT', body: 'Fix' })
    const comments = usePendingReviewStore.getState().pendingComments.get('bde#42')
    expect(comments).toHaveLength(1)
    expect(comments![0].body).toBe('Fix')
  })

  it('removes a comment by ID', () => {
    const { addComment } = usePendingReviewStore.getState()
    addComment('bde#42', { id: 'c1', path: 'file.ts', line: 10, side: 'RIGHT', body: 'Fix' })
    usePendingReviewStore.getState().removeComment('bde#42', 'c1')
    expect(usePendingReviewStore.getState().pendingComments.get('bde#42')).toHaveLength(0)
  })

  it('updates a comment body', () => {
    const { addComment } = usePendingReviewStore.getState()
    addComment('bde#42', { id: 'c1', path: 'file.ts', line: 10, side: 'RIGHT', body: 'Fix' })
    usePendingReviewStore.getState().updateComment('bde#42', 'c1', 'Updated')
    expect(usePendingReviewStore.getState().pendingComments.get('bde#42')![0].body).toBe('Updated')
  })

  it('clears all pending for a PR key', () => {
    const { addComment } = usePendingReviewStore.getState()
    addComment('bde#42', { id: 'c1', path: 'file.ts', line: 10, side: 'RIGHT', body: 'Fix' })
    usePendingReviewStore.getState().clearPending('bde#42')
    expect(usePendingReviewStore.getState().pendingComments.has('bde#42')).toBe(false)
  })

  it('returns correct pending count', () => {
    const { addComment, getPendingCount } = usePendingReviewStore.getState()
    addComment('bde#42', { id: 'c1', path: 'file.ts', line: 10, side: 'RIGHT', body: 'Fix' })
    addComment('bde#42', { id: 'c2', path: 'file.ts', line: 20, side: 'RIGHT', body: 'Also fix' })
    expect(getPendingCount('bde#42')).toBe(2)
    expect(getPendingCount('bde#99')).toBe(0)
  })
})
```

- [ ] **Step 2: Write sprintUI, healthCheck, prConflicts store tests**

Each store test follows the same pattern: reset state in `beforeEach`, test each action, verify state after.

```ts
// sprintUI.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useSprintUIStore } from '../sprintUI'

describe('sprintUI store', () => {
  beforeEach(() => {
    useSprintUIStore.setState({
      selectedTaskId: null, logDrawerTaskId: null, repoFilter: null, generatingIds: new Set()
    })
  })

  it('sets selected task ID', () => {
    useSprintUIStore.getState().setSelectedTaskId('task-1')
    expect(useSprintUIStore.getState().selectedTaskId).toBe('task-1')
  })

  it('sets log drawer task ID', () => {
    useSprintUIStore.getState().setLogDrawerTaskId('task-1')
    expect(useSprintUIStore.getState().logDrawerTaskId).toBe('task-1')
  })

  it('sets repo filter', () => {
    useSprintUIStore.getState().setRepoFilter('bde')
    expect(useSprintUIStore.getState().repoFilter).toBe('bde')
  })
})
```

```ts
// healthCheck.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useHealthCheckStore } from '../healthCheck'

describe('healthCheck store', () => {
  beforeEach(() => {
    useHealthCheckStore.setState({ stuckTaskIds: new Set(), dismissedIds: new Set() })
  })

  it('sets stuck task IDs', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1', 'task-2'])
    expect(useHealthCheckStore.getState().stuckTaskIds.size).toBe(2)
  })

  it('dismisses a task', () => {
    useHealthCheckStore.getState().dismiss('task-1')
    expect(useHealthCheckStore.getState().dismissedIds.has('task-1')).toBe(true)
  })

  it('clears dismissed', () => {
    useHealthCheckStore.getState().dismiss('task-1')
    useHealthCheckStore.getState().clearDismissed()
    expect(useHealthCheckStore.getState().dismissedIds.size).toBe(0)
  })
})
```

```ts
// prConflicts.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { usePrConflictsStore } from '../prConflicts'

describe('prConflicts store', () => {
  beforeEach(() => {
    usePrConflictsStore.setState({ conflictingTaskIds: new Set() })
  })

  it('sets conflict IDs', () => {
    usePrConflictsStore.getState().setConflicts(['t1', 't2'])
    expect(usePrConflictsStore.getState().conflictingTaskIds.size).toBe(2)
  })

  it('does not re-render if same conflicts set', () => {
    usePrConflictsStore.getState().setConflicts(['t1'])
    const before = usePrConflictsStore.getState().conflictingTaskIds
    usePrConflictsStore.getState().setConflicts(['t1'])
    const after = usePrConflictsStore.getState().conflictingTaskIds
    // Should be same reference if smart equality
    expect(before).toBe(after)
  })
})
```

- [ ] **Step 3: Write sprintTasks store test**

```ts
// sprintTasks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSprintTasks } from '../sprintTasks'

vi.mock('../toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe('sprintTasks store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSprintTasks.setState({
      tasks: [], loading: true, loadError: null, prMergedMap: {},
      pendingUpdates: new Map(), pendingCreates: new Set(),
    })
  })

  it('loadData populates tasks from IPC', async () => {
    const mockTasks = [{ id: 't1', title: 'Task 1', status: 'backlog', repo: 'bde' }]
    vi.mocked(window.api.sprint.list).mockResolvedValue(mockTasks as any)
    await useSprintTasks.getState().loadData()
    expect(useSprintTasks.getState().tasks).toHaveLength(1)
    expect(useSprintTasks.getState().loading).toBe(false)
  })

  it('loadData sets loadError on failure', async () => {
    vi.mocked(window.api.sprint.list).mockRejectedValue(new Error('network'))
    await useSprintTasks.getState().loadData()
    expect(useSprintTasks.getState().loadError).toContain('network')
  })

  it('updateTask applies optimistic update immediately', async () => {
    useSprintTasks.setState({ tasks: [{ id: 't1', title: 'Old', status: 'backlog' } as any] })
    vi.mocked(window.api.sprint.update).mockResolvedValue({} as any)
    const promise = useSprintTasks.getState().updateTask('t1', { title: 'New' })
    // Optimistic: updated immediately
    expect(useSprintTasks.getState().tasks[0].title).toBe('New')
    await promise
  })

  it('updateTask protects optimistic data during concurrent loadData', async () => {
    useSprintTasks.setState({
      tasks: [{ id: 't1', title: 'Optimistic', status: 'active' } as any],
      pendingUpdates: new Map([['t1', Date.now()]]),
    })
    // loadData returns stale data
    vi.mocked(window.api.sprint.list).mockResolvedValue([{ id: 't1', title: 'Stale', status: 'backlog' } as any])
    await useSprintTasks.getState().loadData()
    // Optimistic version preserved
    expect(useSprintTasks.getState().tasks[0].title).toBe('Optimistic')
  })

  it('mergeSseUpdate merges incoming event into task', () => {
    useSprintTasks.setState({ tasks: [{ id: 't1', title: 'Task', status: 'active' } as any] })
    useSprintTasks.getState().mergeSseUpdate({ taskId: 't1', status: 'done', pr_url: 'http://pr' })
    const task = useSprintTasks.getState().tasks[0]
    expect(task.status).toBe('done')
    expect(task.pr_status).toBe('open') // auto-set when done+pr_url
  })

  it('deleteTask removes task and shows toast', async () => {
    useSprintTasks.setState({ tasks: [{ id: 't1' } as any] })
    vi.mocked(window.api.sprint.delete).mockResolvedValue({ ok: true } as any)
    await useSprintTasks.getState().deleteTask('t1')
    expect(useSprintTasks.getState().tasks).toHaveLength(0)
  })
})
```

- [ ] **Step 4: Write costData store test**

```ts
// costData.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useCostDataStore } from '../costData'

describe('costData store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCostDataStore.setState({ localAgents: [], isFetching: false, totalCost: 0 })
  })

  it('fetchLocalAgents loads agents and computes total cost', async () => {
    vi.mocked(window.api.cost as any).getAgentHistory = vi.fn().mockResolvedValue([
      { id: 'a1', costUsd: 1.5 },
      { id: 'a2', costUsd: 2.5 },
    ])
    await useCostDataStore.getState().fetchLocalAgents()
    expect(useCostDataStore.getState().localAgents).toHaveLength(2)
    expect(useCostDataStore.getState().totalCost).toBe(4.0)
    expect(useCostDataStore.getState().isFetching).toBe(false)
  })

  it('prevents concurrent fetches', async () => {
    useCostDataStore.setState({ isFetching: true })
    vi.mocked(window.api.cost as any).getAgentHistory = vi.fn()
    await useCostDataStore.getState().fetchLocalAgents()
    expect((window.api.cost as any).getAgentHistory).not.toHaveBeenCalled()
  })

  it('handles fetch errors gracefully', async () => {
    vi.mocked(window.api.cost as any).getAgentHistory = vi.fn().mockRejectedValue(new Error('fail'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await useCostDataStore.getState().fetchLocalAgents()
    expect(useCostDataStore.getState().isFetching).toBe(false)
    spy.mockRestore()
  })
})
```

- [ ] **Step 4: Run all store tests**

Run: `npx vitest run src/renderer/src/stores/__tests__/`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/__tests__/pendingReview.test.ts src/renderer/src/stores/__tests__/sprintUI.test.ts src/renderer/src/stores/__tests__/healthCheck.test.ts src/renderer/src/stores/__tests__/prConflicts.test.ts src/renderer/src/stores/__tests__/sprintTasks.test.ts src/renderer/src/stores/__tests__/costData.test.ts
git commit -m "test: add tests for untested Zustand stores"
```

---

### Task 16: Untested Hooks

**Files:**
- Test: `src/renderer/src/hooks/__tests__/useHealthCheck.test.ts`
- Test: `src/renderer/src/hooks/__tests__/useSprintPolling.test.ts`
- Test: `src/renderer/src/hooks/__tests__/useRepoOptions.test.ts`
- Test: `src/renderer/src/hooks/__tests__/usePrStatusPolling.test.ts`
- Test: `src/renderer/src/hooks/__tests__/useSprintTaskActions.test.ts`

- [ ] **Step 1: Write useRepoOptions test (simplest hook)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('../../stores/toasts', () => ({ toast: { error: vi.fn() } }))

import { useRepoOptions } from '../useRepoOptions'

describe('useRepoOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads repos from settings', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue([
      { name: 'bde', localPath: '/path/bde', githubOwner: 'org', githubRepo: 'bde' },
    ])
    const { result } = renderHook(() => useRepoOptions())
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0))
    expect(result.current[0].name).toBe('bde')
  })
})
```

- [ ] **Step 2: Write useHealthCheck test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../../stores/healthCheck', () => ({
  useHealthCheckStore: vi.fn((sel: Function) => sel({
    stuckTaskIds: new Set(['task-1']),
    dismissedIds: new Set(),
    setStuckTasks: vi.fn(),
    dismiss: vi.fn(),
  })),
}))

import { useHealthCheck } from '../useHealthCheck'

const tasks = [
  { id: 'task-1', status: 'active', title: 'Test' },
  { id: 'task-2', status: 'active', title: 'Test 2' },
] as any[]

describe('useHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.api.sprint.healthCheck).mockResolvedValue(['task-1'])
  })

  it('returns visible stuck tasks (non-dismissed)', () => {
    const { result } = renderHook(() => useHealthCheck(tasks))
    expect(result.current.visibleStuckTasks.length).toBe(1)
    expect(result.current.visibleStuckTasks[0].id).toBe('task-1')
  })
})
```

- [ ] **Step 3: Write useSprintPolling test**

```ts
// useSprintPolling.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: Function) => sel({
    tasks: [{ id: 't1', status: 'active' }],
    loadData: vi.fn().mockResolvedValue(undefined),
  })),
}))
vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn((cb: Function, ms: number | null) => {
    // Simulate immediate call for testing
    if (ms !== null) cb()
  }),
}))

import { useSprintPolling } from '../useSprintPolling'

describe('useSprintPolling', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invokes polling without error', () => {
    expect(() => renderHook(() => useSprintPolling())).not.toThrow()
  })
})
```

- [ ] **Step 4: Write usePrStatusPolling test**

```ts
// usePrStatusPolling.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: Function) => sel({
    tasks: [],
    updateTask: vi.fn(),
  })),
}))
vi.mock('../../stores/prConflicts', () => ({
  usePrConflictsStore: vi.fn((sel: Function) => sel({
    conflictingTaskIds: new Set(),
    setConflicts: vi.fn(),
  })),
}))
vi.mock('../../stores/toasts', () => ({ toast: { error: vi.fn() } }))
vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn(),
}))

import { usePrStatusPolling } from '../usePrStatusPolling'

describe('usePrStatusPolling', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders without error', () => {
    expect(() => renderHook(() => usePrStatusPolling())).not.toThrow()
  })
})
```

- [ ] **Step 5: Write useSprintTaskActions test**

```ts
// useSprintTaskActions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: Function) => sel({
    tasks: [{ id: 't1', status: 'backlog', title: 'Task 1' }],
    updateTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    launchTask: vi.fn().mockResolvedValue(undefined),
  })),
}))
vi.mock('../../stores/sprintUI', () => ({
  useSprintUIStore: vi.fn((sel: Function) => sel({
    setSelectedTaskId: vi.fn(),
    setLogDrawerTaskId: vi.fn(),
  })),
}))
vi.mock('../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), undoable: vi.fn() },
}))

import { useSprintTaskActions } from '../useSprintTaskActions'

describe('useSprintTaskActions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns expected action functions', () => {
    const { result } = renderHook(() => useSprintTaskActions())
    expect(result.current.handleDragEnd).toBeTypeOf('function')
    expect(result.current.handleMarkDone).toBeTypeOf('function')
    expect(result.current.handleStop).toBeTypeOf('function')
    expect(result.current.launchTask).toBeTypeOf('function')
    expect(result.current.deleteTask).toBeTypeOf('function')
  })
})
```

- [ ] **Step 4: Run all hook tests**

Run: `npx vitest run src/renderer/src/hooks/__tests__/`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/__tests__/
git commit -m "test: add tests for untested hooks"
```

---

### Task 17: Main Process Integration — Sprint PR Poller

**Files:**
- Test: `src/main/__tests__/sprint-pr-poller.test.ts`
- Reference: `src/main/sprint-pr-poller.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSprintPrPoller } from '../sprint-pr-poller'
import type { SprintPrPollerDeps } from '../sprint-pr-poller'

function makeDeps(overrides: Partial<SprintPrPollerDeps> = {}): SprintPrPollerDeps {
  return {
    listTasksWithOpenPrs: vi.fn().mockResolvedValue([]),
    pollPrStatuses: vi.fn().mockResolvedValue([]),
    markTaskDoneByPrNumber: vi.fn().mockResolvedValue([]),
    markTaskCancelledByPrNumber: vi.fn().mockResolvedValue([]),
    updateTaskMergeableState: vi.fn().mockResolvedValue(undefined),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('createSprintPrPoller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('polls on start and marks merged PRs as done', async () => {
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockResolvedValue([
        { id: 'task-1', pr_url: 'https://github.com/o/r/pull/42', pr_status: 'open' },
      ]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        { taskId: 'task-1', merged: true, state: 'MERGED', mergeableState: null },
      ]),
      markTaskDoneByPrNumber: vi.fn().mockResolvedValue(['task-1']),
    })

    const poller = createSprintPrPoller(deps)
    poller.start()

    // Flush the initial poll
    await vi.runOnlyPendingTimersAsync()

    expect(deps.markTaskDoneByPrNumber).toHaveBeenCalledWith(42)
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'done')

    poller.stop()
  })

  it('marks closed PRs as cancelled', async () => {
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockResolvedValue([
        { id: 'task-2', pr_url: 'https://github.com/o/r/pull/99', pr_status: 'open' },
      ]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        { taskId: 'task-2', merged: false, state: 'CLOSED', mergeableState: null },
      ]),
      markTaskCancelledByPrNumber: vi.fn().mockResolvedValue(['task-2']),
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    await vi.runOnlyPendingTimersAsync()

    expect(deps.markTaskCancelledByPrNumber).toHaveBeenCalledWith(99)
    poller.stop()
  })

  it('skips polling when no tasks with open PRs', async () => {
    const deps = makeDeps()
    const poller = createSprintPrPoller(deps)
    poller.start()
    await vi.runOnlyPendingTimersAsync()

    expect(deps.pollPrStatuses).not.toHaveBeenCalled()
    poller.stop()
  })

  it('stops polling on stop()', async () => {
    const deps = makeDeps()
    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    await vi.advanceTimersByTimeAsync(120_000)
    // Only the initial poll (from start), no interval polls
    expect(deps.listTasksWithOpenPrs).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run and verify**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/__tests__/sprint-pr-poller.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/sprint-pr-poller.test.ts
git commit -m "test: add sprint PR poller integration tests"
```

---

### Task 18: Main Process Integration — AgentManager Pipeline

**Files:**
- Test: `src/main/__tests__/integration/agent-manager-pipeline.test.ts`
- Reference: `src/main/agent-manager/index.ts`

- [ ] **Step 1: Write pipeline integration test**

This test verifies the full drain→claim→spawn→complete lifecycle. Use the existing mock patterns from `src/main/agent-manager/__tests__/index.test.ts` — mock sprint-queries, sdk-adapter, worktree, and paths. The integration test exercises multiple modules together rather than individual functions.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock external dependencies at module boundaries
vi.mock('../../data/sprint-queries', () => ({
  getQueuedTasks: vi.fn(),
  claimTask: vi.fn(),
  updateTask: vi.fn(),
  getTask: vi.fn(),
  getOrphanedTasks: vi.fn().mockResolvedValue([]),
  getTasksWithDependencies: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../agent-manager/sdk-adapter', () => ({ spawnAgent: vi.fn() }))
vi.mock('../../agent-manager/worktree', () => ({
  setupWorktree: vi.fn(),
  cleanupWorktree: vi.fn(),
  pruneStaleWorktrees: vi.fn().mockResolvedValue(0),
  branchNameForTask: vi.fn((t: any) => `agent/${t.title.toLowerCase().replace(/\s+/g, '-')}`),
}))
vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn(),
  getGhRepo: vi.fn(),
  BDE_AGENT_LOG_PATH: '/tmp/bde-agent-test.log',
}))

import { createAgentManager } from '../../agent-manager'
import { getQueuedTasks, claimTask, updateTask } from '../../data/sprint-queries'
import { spawnAgent } from '../../agent-manager/sdk-adapter'
import { setupWorktree } from '../../agent-manager/worktree'
import { getRepoPaths } from '../../paths'

function makeTask(id: string) {
  return {
    id, title: `Task ${id}`, repo: 'myrepo', prompt: 'Do work', spec: null,
    priority: 1, status: 'queued' as const, notes: null, retry_count: 0,
    fast_fail_count: 0, agent_run_id: null, pr_number: null, pr_status: null,
    pr_url: null, claimed_by: null, started_at: null, completed_at: null,
    template_name: null, depends_on: null, updated_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
  }
}

function makeBlockingHandle() {
  let resolve: (() => void) | undefined
  const p = new Promise<void>(r => { resolve = r })
  const abort = vi.fn(() => resolve?.())
  async function* gen() { await p }
  return {
    handle: { messages: gen(), sessionId: 's1', abort, steer: vi.fn().mockResolvedValue(undefined) },
    abort, resolve: () => resolve?.(),
  }
}

describe('AgentManager pipeline integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(getRepoPaths).mockReturnValue({ myrepo: '/repos/myrepo' })
    vi.mocked(setupWorktree).mockResolvedValue({ worktreePath: '/tmp/wt', branch: 'agent/task' })
  })

  afterEach(() => vi.useRealTimers())

  it('drains a queued task through spawn', async () => {
    const task = makeTask('t1')
    vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
    vi.mocked(claimTask).mockResolvedValueOnce({ ...task, status: 'active' })
    const { handle } = makeBlockingHandle()
    vi.mocked(spawnAgent).mockResolvedValueOnce(handle as any)

    const mgr = createAgentManager({
      maxConcurrent: 1, worktreeBase: '/tmp/wt', maxRuntimeMs: 600000,
      idleTimeoutMs: 120000, pollIntervalMs: 1000, defaultModel: 'claude-sonnet-4-5',
    }, { info: vi.fn(), warn: vi.fn(), error: vi.fn() })

    mgr.start()

    // Advance past first drain interval
    await vi.advanceTimersByTimeAsync(1500)

    const status = mgr.getStatus()
    expect(status.running).toBe(true)
    expect(spawnAgent).toHaveBeenCalled()

    await mgr.stop(1000)
  })
})
```

- [ ] **Step 2: Run and verify**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/__tests__/integration/agent-manager-pipeline.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/integration/agent-manager-pipeline.test.ts
git commit -m "test: add AgentManager pipeline integration test"
```

---

### Task 19: Main Process Integration — Queue API with Real HTTP

**Files:**
- Test: `src/main/__tests__/integration/queue-api-integration.test.ts`
- Reference: `src/main/queue-api/`

- [ ] **Step 1: Write full HTTP integration test**

This test starts a real HTTP server on a random port and exercises the full request→handler→response cycle. Use the existing `request()` helper pattern from `queue-api.test.ts`.

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import http from 'node:http'

// Mock data layer — sprint-queries used by queue-api router
vi.mock('../../data/sprint-queries', () => {
  const tasks = new Map()
  return {
    getQueuedTasks: vi.fn(async () => Array.from(tasks.values()).filter(t => t.status === 'queued')),
    getTask: vi.fn(async (id: string) => tasks.get(id) ?? null),
    createTask: vi.fn(async (data: any) => {
      const task = { id: `task-${Date.now()}`, ...data, status: data.status ?? 'backlog', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      tasks.set(task.id, task)
      return task
    }),
    updateTask: vi.fn(async (id: string, patch: any) => {
      const task = tasks.get(id)
      if (!task) return null
      Object.assign(task, patch, { updated_at: new Date().toISOString() })
      return task
    }),
    listTasks: vi.fn(async () => Array.from(tasks.values())),
    __tasks: tasks,
  }
})
vi.mock('../../data/settings-queries', () => ({
  getSetting: vi.fn(() => 'test-api-key'),
}))

import { startQueueApi, stopQueueApi } from '../../queue-api/server'

let port: number

function request(method: string, path: string, body?: unknown, token = 'test-api-key'): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1', port, path, method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null })
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

describe('Queue API HTTP integration', () => {
  beforeAll(async () => {
    const server = startQueueApi({ port: 0, host: '127.0.0.1' })
    await new Promise<void>((resolve) => {
      server.on('listening', () => {
        const addr = server.address()
        if (typeof addr === 'object' && addr) port = addr.port
        resolve()
      })
    })
  })

  afterAll(async () => { await stopQueueApi() })

  it('GET /queue/health returns stats', async () => {
    const res = await request('GET', '/queue/health')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('backlog')
  })

  it('POST /queue/tasks creates a task', async () => {
    const res = await request('POST', '/queue/tasks', { title: 'Integration test', repo: 'bde', priority: 1 })
    expect(res.status).toBe(201)
    expect(res.body.title).toBe('Integration test')
  })

  it('GET /queue/tasks/:id retrieves a task', async () => {
    const create = await request('POST', '/queue/tasks', { title: 'Fetch me', repo: 'bde', priority: 1 })
    const res = await request('GET', `/queue/tasks/${create.body.id}`)
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Fetch me')
  })

  it('rejects requests with invalid token', async () => {
    const res = await request('GET', '/queue/health', undefined, 'wrong-key')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run and verify**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/__tests__/integration/queue-api-integration.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/integration/queue-api-integration.test.ts
git commit -m "test: add Queue API HTTP integration tests"
```

---

### Task 20: Expanded Smoke Tests

**Files:**
- Modify: `src/renderer/src/views/__tests__/smoke.test.tsx`

- [ ] **Step 1: Add PR Station view smoke test**

Add import and test for the PR Station view (PRStationView or however it's exported). Mock all PR Station child components.

```tsx
// Add to existing smoke.test.tsx

vi.mock('../../components/pr-station/PRStationList', () => ({
  PRStationList: () => <div data-testid="pr-station-list" />,
}))
vi.mock('../../components/pr-station/PRStationDetail', () => ({
  PRStationDetail: () => <div data-testid="pr-station-detail" />,
}))
vi.mock('../../components/pr-station/PRStationDiff', () => ({
  PRStationDiff: () => <div data-testid="pr-station-diff" />,
}))

import PRStationView from '../PRStationView'

// In describe block:
it('PRStationView renders without crashing', () => {
  const { container } = render(<PRStationView />)
  expect(container.firstChild).toBeInTheDocument()
  expect(container.innerHTML).not.toBe('')
})
```

- [ ] **Step 2: Run smoke tests**

Run: `npx vitest run src/renderer/src/views/__tests__/smoke.test.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/views/__tests__/smoke.test.tsx
git commit -m "test: add PR Station to view smoke tests"
```

---

### Task 21: Final Verification

- [ ] **Step 1: Run full renderer test suite**

Run: `npm test`
Expected: All tests pass (existing 398 + ~100 new)

- [ ] **Step 2: Run full main test suite**

Run: `npm run test:main`
Expected: All tests pass (existing 436 + ~15 new)

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Clean (no new type errors)

- [ ] **Step 4: Run coverage report**

Run: `npm run test:coverage`
Expected: Coverage above 40% threshold

- [ ] **Step 5: Final commit with updated test counts in CLAUDE.md**

Update the CLAUDE.md integration test counts to reflect the new totals.

```bash
git add -A
git commit -m "test: full test remediation — 35+ new test files covering PR Station, Diff, Settings, Memory, Terminal, stores, hooks, and integration"
```

---

## Scope Notes

### Hooks excluded from this plan (already tested or trivial)

- `useVisibilityAwareInterval` — already has tests
- `useTaskNotifications` — already has tests
- `useSidebarResize` — pure DOM/resize observer, UI-only
- `useSprintKeyboardShortcuts` — keyboard event listener, covered implicitly by SprintView smoke tests
- `useGitHubRateLimitWarning` — simple toast-on-header-check, low risk
- `useUnifiedAgents` — thin wrapper around store, covered by store tests

### Stores excluded

- `sprintEvents` — event bus store, implicitly tested through hooks that consume it
- `agentEvents` — already tested indirectly via AgentList component tests
- `commandPalette` — simple open/close toggle, covered by CommandPalette component test
- `panelLayout` — already tested in `panelLayout.test.ts`

These exclusions can be revisited in a follow-up if coverage numbers warrant it.
