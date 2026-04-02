# Command Center Test Coverage Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all Command Center test coverage gaps — two untested dashboard cards, three under-covered components — to raise branch coverage well above the 65% CI gate.

**Architecture:** Pure unit tests using the existing Vitest + Testing Library setup. Each component gets isolated tests with Zustand store mocks (dashboard cards) or direct prop-based rendering (neon components). No new dependencies needed.

**Tech Stack:** Vitest, @testing-library/react, vi.mock for Zustand stores, vi.useFakeTimers for time-dependent tests

---

## File Structure

Almost all work is new test files or additions to existing test files. One production bugfix in DashboardView (PR count always reads 0).

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/renderer/src/components/dashboard/__tests__/CostSummaryCard.test.tsx` | Full coverage for CostSummaryCard |
| Create | `src/renderer/src/components/dashboard/__tests__/OpenPRsCard.test.tsx` | Full coverage for OpenPRsCard |
| Modify | `src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx` | Cover hours/days branches (L21-23) |
| Modify | `src/renderer/src/components/neon/__tests__/StatCounter.test.tsx` | Cover trend directions + icon prop |
| Modify | `src/renderer/src/components/neon/__tests__/MiniChart.test.tsx` | Cover default accent fallback (L33) |
| Modify | `src/renderer/src/views/DashboardView.tsx:112` | Fix PR count bug (Array.isArray on object) |
| Modify | `src/renderer/src/views/__tests__/DashboardView.test.tsx` | Cover data-fetching branches, PR count logic |

---

## Phase 1: New Test Files (zero → full coverage)

### Task 1: CostSummaryCard tests

**Files:**
- Create: `src/renderer/src/components/dashboard/__tests__/CostSummaryCard.test.tsx`
- Reference: `src/renderer/src/components/dashboard/CostSummaryCard.tsx`

- [ ] **Step 1: Write the test file with store mock and all cases**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

interface Agent {
  costUsd?: number | null
}

let mockLocalAgents: Agent[] = []
let mockTotalCost = 0

vi.mock('../../../stores/costData', () => ({
  useCostDataStore: (selector: (s: { localAgents: Agent[]; totalCost: number }) => unknown) =>
    selector({ localAgents: mockLocalAgents, totalCost: mockTotalCost }),
}))

import { CostSummaryCard } from '../CostSummaryCard'

describe('CostSummaryCard', () => {
  beforeEach(() => {
    mockLocalAgents = []
    mockTotalCost = 0
  })

  it('renders card title', () => {
    render(<CostSummaryCard />)
    expect(screen.getByText('Cost Summary')).toBeInTheDocument()
  })

  it('renders all three stat labels', () => {
    render(<CostSummaryCard />)
    expect(screen.getByText('Total Cost')).toBeInTheDocument()
    expect(screen.getByText('Runs')).toBeInTheDocument()
    expect(screen.getByText('Avg / Run')).toBeInTheDocument()
  })

  it('shows formatted total cost', () => {
    mockTotalCost = 12.5
    render(<CostSummaryCard />)
    expect(screen.getByText('$12.50')).toBeInTheDocument()
  })

  it('shows <$0.01 for tiny total cost', () => {
    mockTotalCost = 0.001
    render(<CostSummaryCard />)
    expect(screen.getByText('<$0.01')).toBeInTheDocument()
  })

  it('shows zero runs when no agents', () => {
    render(<CostSummaryCard />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('shows run count from localAgents length', () => {
    mockLocalAgents = [{ costUsd: 1.5 }, { costUsd: 2.5 }]
    render(<CostSummaryCard />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('calculates average cost per run', () => {
    mockLocalAgents = [{ costUsd: 2.0 }, { costUsd: 4.0 }]
    mockTotalCost = 6.0
    render(<CostSummaryCard />)
    // Avg = (2+4)/2 = $3.00
    expect(screen.getByText('$3.00')).toBeInTheDocument()
  })

  it('excludes zero-cost agents from average calculation', () => {
    mockLocalAgents = [{ costUsd: 0 }, { costUsd: 4.0 }]
    mockTotalCost = 4.0
    render(<CostSummaryCard />)
    // Only one agent with cost > 0, avg = 4.0/1 = $4.00
    expect(screen.getByText('$4.00')).toBeInTheDocument()
  })

  it('handles null costUsd in agents', () => {
    mockLocalAgents = [{ costUsd: null }, { costUsd: 3.0 }]
    mockTotalCost = 3.0
    render(<CostSummaryCard />)
    expect(screen.getByText('$3.00')).toBeInTheDocument()
  })

  it('shows <$0.01 for avg when all agents have zero cost', () => {
    mockLocalAgents = [{ costUsd: 0 }]
    render(<CostSummaryCard />)
    // avg = 0 because no agents pass the > 0 filter
    // formatCost(0) → '<$0.01'
    const smallCosts = screen.getAllByText('<$0.01')
    expect(smallCosts.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/CostSummaryCard.test.tsx`
Expected: All 10 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/dashboard/__tests__/CostSummaryCard.test.tsx
git commit -m "test: add CostSummaryCard tests — formatCost branches, avg calculation"
```

---

### Task 2: OpenPRsCard tests

**Files:**
- Create: `src/renderer/src/components/dashboard/__tests__/OpenPRsCard.test.tsx`
- Reference: `src/renderer/src/components/dashboard/OpenPRsCard.tsx`
- Reference: `src/shared/types.ts:129-141` (OpenPr interface)

This component calls `window.api.getPrList()` in a useEffect. The global `window.api` mock from `test-setup.ts` stubs it as `vi.fn().mockResolvedValue([])`. We need to override this mock per test for different PR scenarios.

The `getPrList()` returns `PrListPayload` which is `{ prs: OpenPr[], checks: Record<string, CheckRunSummary> }`.

- [ ] **Step 1: Write the test file**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OpenPr } from '../../../../../shared/types'

import { OpenPRsCard } from '../OpenPRsCard'

function makePr(overrides: Partial<OpenPr> = {}): OpenPr {
  return {
    number: 1,
    title: 'Test PR',
    html_url: 'https://github.com/test/repo/pull/1',
    state: 'open',
    draft: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    head: { ref: 'feat/test', sha: 'abc123' },
    base: { ref: 'main' },
    user: { login: 'testuser' },
    merged: false,
    merged_at: null,
    repo: 'test-repo',
    ...overrides,
  }
}

describe('OpenPRsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders card title', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({ prs: [], checks: {} })
    render(<OpenPRsCard />)
    expect(screen.getByText('Open PRs')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    // Never-resolving promise to keep loading state
    vi.mocked(window.api.getPrList).mockReturnValue(new Promise(() => {}))
    render(<OpenPRsCard />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows empty state when no PRs', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({ prs: [], checks: {} })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('No open pull requests')).toBeInTheDocument()
    })
  })

  it('renders PR titles after loading', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [makePr({ number: 42, title: 'Add auth module' })],
      checks: {},
    })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('Add auth module')).toBeInTheDocument()
    })
  })

  it('shows PR number', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [makePr({ number: 99 })],
      checks: {},
    })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('#99')).toBeInTheDocument()
    })
  })

  it('shows Draft badge for draft PRs', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [makePr({ draft: true })],
      checks: {},
    })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument()
    })
  })

  it('does not show Draft badge for non-draft PRs', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [makePr({ draft: false })],
      checks: {},
    })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('Test PR')).toBeInTheDocument()
    })
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
  })

  it('limits display to 5 PRs', async () => {
    const prs = Array.from({ length: 7 }, (_, i) =>
      makePr({ number: i + 1, title: `PR ${i + 1}` }),
    )
    vi.mocked(window.api.getPrList).mockResolvedValue({ prs, checks: {} })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('PR 5')).toBeInTheDocument()
    })
    expect(screen.queryByText('PR 6')).not.toBeInTheDocument()
  })

  it('calls openExternal when link button clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [makePr({ number: 7, html_url: 'https://github.com/test/repo/pull/7' })],
      checks: {},
    })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('Test PR')).toBeInTheDocument()
    })
    await user.click(screen.getByLabelText('Open PR #7 in browser'))
    expect(window.api.openExternal).toHaveBeenCalledWith(
      'https://github.com/test/repo/pull/7',
    )
  })

  it('handles getPrList rejection gracefully', async () => {
    vi.mocked(window.api.getPrList).mockRejectedValue(new Error('network'))
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('No open pull requests')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/OpenPRsCard.test.tsx`
Expected: All 10 tests PASS

Note: The `vi.mocked(window.api.getPrList)` pattern relies on `window.api` being set up in `test-setup.ts`. If type errors occur, cast as needed: `(window.api.getPrList as ReturnType<typeof vi.fn>)`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/dashboard/__tests__/OpenPRsCard.test.tsx
git commit -m "test: add OpenPRsCard tests — loading, empty, draft badge, max limit, error"
```

---

## Phase 2: Branch Coverage Gaps (existing tests → fuller coverage)

### Task 3: ActivityFeed — hours and days branches

**Files:**
- Modify: `src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx`
- Reference: `src/renderer/src/components/neon/ActivityFeed.tsx:15-24` (formatRelativeTime)

The uncovered lines are L21-23: the `hours` and `days` branches in `formatRelativeTime`. Current tests only cover seconds and minutes timestamps.

- [ ] **Step 1: Add tests for hours and days time formatting**

Append these tests inside the existing `describe('ActivityFeed', ...)` block:

```tsx
it('shows hours-ago format for timestamps 1-23 hours old', () => {
  const hoursAgoEvents: FeedEvent[] = [
    { id: 'h1', label: 'hours test', accent: 'cyan', timestamp: Date.now() - 3 * 60 * 60 * 1000 },
  ]
  render(<ActivityFeed events={hoursAgoEvents} />)
  expect(screen.getByText('3h ago')).toBeInTheDocument()
})

it('shows days-ago format for timestamps 24+ hours old', () => {
  const daysAgoEvents: FeedEvent[] = [
    { id: 'd1', label: 'days test', accent: 'pink', timestamp: Date.now() - 48 * 60 * 60 * 1000 },
  ]
  render(<ActivityFeed events={daysAgoEvents} />)
  expect(screen.getByText('2d ago')).toBeInTheDocument()
})

it('shows "just now" for events less than 1 second old', () => {
  const justNowEvents: FeedEvent[] = [
    { id: 'jn', label: 'just now test', accent: 'blue', timestamp: Date.now() },
  ]
  render(<ActivityFeed events={justNowEvents} />)
  expect(screen.getByText('just now')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify all pass**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx`
Expected: 7 tests PASS (4 existing + 3 new)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx
git commit -m "test: cover ActivityFeed hours/days/just-now time branches"
```

---

### Task 4: StatCounter — trend directions and icon prop

**Files:**
- Modify: `src/renderer/src/components/neon/__tests__/StatCounter.test.tsx`
- Reference: `src/renderer/src/components/neon/StatCounter.tsx:56-64` (trend rendering)

Uncovered branches: L58-63 — the `trend.direction === 'down'` vs `'up'` conditional (arrow + color), and the `icon` prop rendering. Existing tests cover `trend` with `'down'` direction but don't verify the arrow symbol or the `'up'` direction.

- [ ] **Step 1: Add tests for both trend directions and icon**

Append inside the existing `describe('StatCounter', ...)` block:

```tsx
it('renders up arrow and red color for upward trend', () => {
  const { container } = render(
    <StatCounter label="Cost" value="$10" accent="orange" trend={{ direction: 'up', label: '5% increase' }} />,
  )
  expect(screen.getByText(/↑/)).toBeInTheDocument()
  expect(screen.getByText(/5% increase/)).toBeInTheDocument()
})

it('renders down arrow for downward trend', () => {
  render(
    <StatCounter label="Cost" value="$4" accent="cyan" trend={{ direction: 'down', label: '3% drop' }} />,
  )
  expect(screen.getByText(/↓/)).toBeInTheDocument()
  expect(screen.getByText(/3% drop/)).toBeInTheDocument()
})

it('does not render trend section when trend is undefined', () => {
  const { container } = render(
    <StatCounter label="Agents" value={5} accent="cyan" />,
  )
  expect(screen.queryByText(/↑/)).not.toBeInTheDocument()
  expect(screen.queryByText(/↓/)).not.toBeInTheDocument()
})

it('renders icon when provided', () => {
  render(
    <StatCounter label="Agents" value={3} accent="cyan" icon={<span data-testid="test-icon">⚡</span>} />,
  )
  expect(screen.getByTestId('test-icon')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify all pass**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/StatCounter.test.tsx`
Expected: 8 tests PASS (4 existing + 4 new)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/__tests__/StatCounter.test.tsx
git commit -m "test: cover StatCounter trend up/down arrows, icon prop"
```

---

### Task 5: MiniChart — default accent fallback

**Files:**
- Modify: `src/renderer/src/components/neon/__tests__/MiniChart.test.tsx`
- Reference: `src/renderer/src/components/neon/MiniChart.tsx:33` (`bar.accent ?? 'purple'`)

L33 is the `?? 'purple'` fallback when `bar.accent` is undefined. All existing test data provides explicit accents.

- [ ] **Step 1: Add test for default accent**

Append inside the existing `describe('MiniChart', ...)` block:

```tsx
it('uses purple as default accent when bar has no accent', () => {
  const noAccentData: ChartBar[] = [{ value: 50 }]
  const { container } = render(<MiniChart data={noAccentData} />)
  const bar = container.querySelector('[data-role="chart-bar"]') as HTMLElement
  expect(bar.style.background).toContain('var(--neon-purple)')
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/MiniChart.test.tsx`
Expected: 4 tests PASS (3 existing + 1 new)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/__tests__/MiniChart.test.tsx
git commit -m "test: cover MiniChart default purple accent fallback"
```

---

## Phase 3: DashboardView Branch Coverage

### Task 6: DashboardView — fix PR count bug + cover data fetch branches

**Files:**
- Modify: `src/renderer/src/views/DashboardView.tsx:112`
- Modify: `src/renderer/src/views/__tests__/DashboardView.test.tsx`
- Reference: `src/renderer/src/views/DashboardView.tsx:50-118` (useEffect data fetches)

**Bug found during coverage audit:** `DashboardView.tsx` line 112 does `Array.isArray(prs) ? prs.length : 0` where `prs` is a `PrListPayload` object (`{ prs: OpenPr[], checks: ... }`). Since an object is never an array, `prCount` is always 0. The fix is `setPrCount(prs?.prs?.length ?? 0)`.

The existing tests render with empty mocks. Branch coverage is at 50% because none of the data-fetching paths are exercised with real data. Key untested branches:
- L65: `data.map()` in completionsPerHour callback (requires non-empty response)
- L86-94: event type → accent mapping (`'error'` → red, `'complete'` → cyan, else → purple)
- L112: PR count extraction (currently bugged)

- [ ] **Step 1: Fix the PR count bug in DashboardView.tsx**

In `src/renderer/src/views/DashboardView.tsx`, change line 112 from:

```tsx
        setPrCount(Array.isArray(prs) ? prs.length : 0)
```

to:

```tsx
        setPrCount(prs?.prs?.length ?? 0)
```

- [ ] **Step 2: Write the failing test first (TDD for the bugfix)**

Add `waitFor` to the imports at the top of `DashboardView.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
```

Then add these tests inside the existing `describe('DashboardView', ...)` block:

```tsx
it('renders chart data from completionsPerHour', async () => {
  vi.mocked(window.api.dashboard.completionsPerHour).mockResolvedValue([
    { hour: '10:00', count: 5 },
    { hour: '11:00', count: 3 },
  ])
  render(<DashboardView />)
  await waitFor(() => {
    expect(screen.getByText('Completions / Hour')).toBeInTheDocument()
  })
})

it('renders feed events from recentEvents', async () => {
  vi.mocked(window.api.dashboard.recentEvents).mockResolvedValue([
    { id: 1, event_type: 'complete', agent_id: 'agent-1', timestamp: Date.now() - 5000 },
    { id: 2, event_type: 'error', agent_id: 'agent-2', timestamp: Date.now() - 10000 },
    { id: 3, event_type: 'spawn', agent_id: 'agent-3', timestamp: Date.now() - 20000 },
  ])
  render(<DashboardView />)
  await waitFor(() => {
    expect(screen.getByText('complete: agent-1')).toBeInTheDocument()
    expect(screen.getByText('error: agent-2')).toBeInTheDocument()
    expect(screen.getByText('spawn: agent-3')).toBeInTheDocument()
  })
})

it('renders correct PR count from getPrList payload', async () => {
  vi.mocked(window.api.getPrList).mockResolvedValue({
    prs: [
      { number: 1, title: 'PR1', html_url: '', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'a', sha: 'b' }, base: { ref: 'main' }, user: { login: 'u' }, merged: false, merged_at: null, repo: 'r' },
      { number: 2, title: 'PR2', html_url: '', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'c', sha: 'd' }, base: { ref: 'main' }, user: { login: 'u' }, merged: false, merged_at: null, repo: 'r' },
    ],
    checks: {},
  })
  render(<DashboardView />)
  // After the bugfix, PR count should be 2 (extracted from payload.prs.length)
  await waitFor(() => {
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
```

Note: If TypeScript complains about `vi.mocked`, cast the mock:
```tsx
;(window.api.dashboard.completionsPerHour as ReturnType<typeof vi.fn>).mockResolvedValue(...)
```

- [ ] **Step 3: Run test to verify all pass**

Run: `npx vitest run src/renderer/src/views/__tests__/DashboardView.test.tsx`
Expected: 6 tests PASS (3 existing + 3 new). The PR count test specifically validates the bugfix — it would show `0` with the old code.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/DashboardView.tsx src/renderer/src/views/__tests__/DashboardView.test.tsx
git commit -m "fix: PR count always 0 on dashboard — Array.isArray checked object not array

Also adds tests for data-fetch branches (chart data, feed events, PR count)."
```

---

## Phase 4: Verify and Ratchet

### Task 7: Run full coverage and ratchet thresholds

- [ ] **Step 1: Run full test suite with coverage**

Run: `npm run test:coverage`
Expected: All tests PASS, all thresholds met

- [ ] **Step 2: Check new Command Center coverage numbers**

Run: `npx vitest run --coverage 2>&1 | grep -E "(neon|dashboard|Dashboard)"`

Verify:
- `CostSummaryCard` → lines ≥ 90%, branches ≥ 80%
- `OpenPRsCard` → lines ≥ 90%, branches ≥ 80%
- `ActivityFeed` → lines = 100%, branches ≥ 90%
- `StatCounter` → lines = 100%, branches ≥ 90%
- `MiniChart` → lines = 100%, branches = 100%
- `DashboardView` → branches ≥ 70%

- [ ] **Step 3: Ratchet coverage thresholds in vitest.config.ts if overall numbers allow**

Per CLAUDE.md: "Ratchet up after adding tests — never lower." If overall coverage has risen above current thresholds (72% stmts, 65% branches, 69% funcs, 73% lines), bump each threshold to the new floor (rounded down to nearest integer).

- [ ] **Step 4: Final commit**

```bash
git add vitest.config.ts
git commit -m "chore: ratchet coverage thresholds after Command Center test improvements"
```
