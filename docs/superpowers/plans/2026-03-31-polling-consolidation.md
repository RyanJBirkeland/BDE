# Polling Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all renderer data-fetching pollers into a single root-level `PollingProvider`, eliminating duplicate timers and keeping stores always warm.

**Architecture:** New `PollingProvider` component mounted in `App.tsx` owns all data-fetching intervals. Views become pure store consumers. New `dashboardData` Zustand store holds dashboard-specific IPC data. `useHealthCheck` refactored to read tasks from store directly.

**Tech Stack:** React, Zustand, vitest, existing `useVisibilityAwareInterval` and `useBackoffInterval` hooks.

**Spec:** `docs/superpowers/specs/2026-03-31-polling-consolidation-design.md`

---

## File Structure

### New files

- `src/renderer/src/stores/dashboardData.ts` — Zustand store for dashboard chart data, feed events, PR count, card errors, loading state
- `src/renderer/src/hooks/useDashboardPolling.ts` — polls dashboard IPC endpoints, writes to `dashboardData` store
- `src/renderer/src/hooks/useGitStatusPolling.ts` — polls git status for active repo
- `src/renderer/src/hooks/useAgentSessionPolling.ts` — polls agent session list
- `src/renderer/src/hooks/useCostPolling.ts` — polls cost data + refreshes costData store
- `src/renderer/src/components/PollingProvider.tsx` — renderless root component calling all polling hooks
- `src/renderer/src/stores/__tests__/dashboardData.test.ts` — store unit tests
- `src/renderer/src/hooks/__tests__/useDashboardPolling.test.ts` — hook tests
- `src/renderer/src/hooks/__tests__/useGitStatusPolling.test.ts` — hook tests
- `src/renderer/src/hooks/__tests__/useAgentSessionPolling.test.ts` — hook tests
- `src/renderer/src/hooks/__tests__/useCostPolling.test.ts` — hook tests
- `src/renderer/src/components/__tests__/PollingProvider.test.tsx` — integration test

### Modified files

- `src/renderer/src/stores/healthCheck.ts` — add `useVisibleStuckTasks()` selector hook
- `src/renderer/src/hooks/useHealthCheck.ts` — read tasks from `useSprintTasks` store instead of param
- `src/renderer/src/App.tsx` — mount `PollingProvider`
- `src/renderer/src/views/DashboardView.tsx` — remove polling, read from `dashboardData` store
- `src/renderer/src/views/GitTreeView.tsx` — remove polling interval
- `src/renderer/src/views/AgentsView.tsx` — remove polling interval
- `src/renderer/src/components/sprint/SprintPipeline.tsx` — remove polling hooks, use store for health check
- `src/renderer/src/components/settings/CostSection.tsx` — remove polling interval
- `src/renderer/src/lib/logPoller.ts` — add visibility-aware pause/resume
- `src/renderer/src/views/__tests__/DashboardView.test.tsx` — update for store-based data
- `src/renderer/src/views/__tests__/GitTreeView.test.tsx` — remove interval mock expectations
- `src/renderer/src/views/__tests__/AgentsView.test.tsx` — remove interval mock expectations
- `src/renderer/src/components/sprint/__tests__/SprintPipeline.test.tsx` — update health check usage
- `src/renderer/src/hooks/__tests__/useSprintPolling.test.ts` — no changes (hook unchanged)
- `src/renderer/src/hooks/__tests__/usePrStatusPolling.test.ts` — no changes (hook unchanged)
- `src/renderer/src/stores/__tests__/healthCheck.test.ts` — add selector tests

---

## Task 1: Create `dashboardData` Zustand store

**Files:**

- Create: `src/renderer/src/stores/dashboardData.ts`
- Create: `src/renderer/src/stores/__tests__/dashboardData.test.ts`

- [ ] **Step 1: Write failing tests for the store**

```ts
// src/renderer/src/stores/__tests__/dashboardData.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDashboardDataStore } from '../dashboardData'

// Mock window.api
const mockCompletionsPerHour = vi.fn()
const mockRecentEvents = vi.fn()
const mockGetPrList = vi.fn()

Object.defineProperty(window, 'api', {
  value: {
    dashboard: {
      completionsPerHour: mockCompletionsPerHour,
      recentEvents: mockRecentEvents
    },
    getPrList: mockGetPrList
  },
  writable: true,
  configurable: true
})

beforeEach(() => {
  useDashboardDataStore.setState({
    chartData: [],
    feedEvents: [],
    prCount: 0,
    cardErrors: {},
    loading: true
  })
  vi.clearAllMocks()
})

describe('dashboardData store', () => {
  it('starts with empty default state', () => {
    const state = useDashboardDataStore.getState()
    expect(state.chartData).toEqual([])
    expect(state.feedEvents).toEqual([])
    expect(state.prCount).toBe(0)
    expect(state.cardErrors).toEqual({})
    expect(state.loading).toBe(true)
  })

  it('fetchAll populates all fields on success', async () => {
    mockCompletionsPerHour.mockResolvedValue([{ hour: '12:00', count: 5 }])
    mockRecentEvents.mockResolvedValue([
      { id: 1, event_type: 'complete', agent_id: 'a1', timestamp: '2026-01-01T00:00:00Z' }
    ])
    mockGetPrList.mockResolvedValue({ prs: [{ id: 1 }, { id: 2 }] })

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    expect(state.chartData.length).toBe(1)
    expect(state.feedEvents.length).toBe(1)
    expect(state.prCount).toBe(2)
    expect(state.loading).toBe(false)
    expect(state.cardErrors).toEqual({})
  })

  it('fetchAll sets cardErrors on partial failure', async () => {
    mockCompletionsPerHour.mockRejectedValue(new Error('fail'))
    mockRecentEvents.mockResolvedValue([])
    mockGetPrList.mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    expect(state.cardErrors.chart).toBeDefined()
    expect(state.loading).toBe(false)
  })

  it('fetchAll clears previous errors on success', async () => {
    useDashboardDataStore.setState({ cardErrors: { chart: 'old error' } })
    mockCompletionsPerHour.mockResolvedValue([])
    mockRecentEvents.mockResolvedValue([])
    mockGetPrList.mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    expect(useDashboardDataStore.getState().cardErrors).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/stores/__tests__/dashboardData.test.ts`
Expected: FAIL — module `../dashboardData` not found

- [ ] **Step 3: Implement the store**

```ts
// src/renderer/src/stores/dashboardData.ts
import { create } from 'zustand'
import type { ChartBar } from '../components/neon/MiniChart'
import type { FeedEvent } from '../components/neon/ActivityFeed'

interface DashboardDataState {
  chartData: ChartBar[]
  feedEvents: FeedEvent[]
  prCount: number
  cardErrors: Record<string, string | undefined>
  loading: boolean
  fetchAll: () => Promise<void>
}

const ACCENT_CYCLE: ChartBar['accent'][] = ['cyan', 'pink', 'blue', 'orange', 'purple']
const EVENT_ACCENT: Record<string, FeedEvent['accent']> = {
  error: 'red',
  complete: 'cyan'
}

export const useDashboardDataStore = create<DashboardDataState>((set) => ({
  chartData: [],
  feedEvents: [],
  prCount: 0,
  cardErrors: {},
  loading: true,

  fetchAll: async () => {
    const errors: Record<string, string> = {}

    // Fetch completions chart
    let chartData: ChartBar[] = []
    try {
      const data = await window.api.dashboard?.completionsPerHour()
      if (data) {
        chartData = data.map((d, i) => ({
          value: d.count,
          accent: ACCENT_CYCLE[i % ACCENT_CYCLE.length],
          label: d.hour
        }))
      }
    } catch {
      errors.chart = 'Failed to load completions'
    }

    // Fetch activity feed
    let feedEvents: FeedEvent[] = []
    try {
      const events = await window.api.dashboard?.recentEvents(30)
      if (events) {
        feedEvents = events.map((e) => ({
          id: String(e.id),
          label: `${e.event_type}: ${e.agent_id}`,
          accent: EVENT_ACCENT[e.event_type] ?? ('purple' as const),
          timestamp: e.timestamp
        }))
      }
    } catch {
      errors.feed = 'Failed to load activity feed'
    }

    // Fetch PR count
    let prCount = 0
    try {
      const prs = await window.api.getPrList()
      prCount = prs?.prs?.length ?? 0
    } catch {
      errors.prs = 'Failed to load PR data'
    }

    set({
      chartData,
      feedEvents,
      prCount,
      cardErrors: Object.keys(errors).length > 0 ? errors : {},
      loading: false
    })
  }
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/stores/__tests__/dashboardData.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/dashboardData.ts src/renderer/src/stores/__tests__/dashboardData.test.ts
git commit -m "feat: add dashboardData Zustand store for polling consolidation"
```

---

## Task 2: Refactor `useHealthCheck` to read tasks from store

**Files:**

- Modify: `src/renderer/src/hooks/useHealthCheck.ts`
- Modify: `src/renderer/src/stores/healthCheck.ts`
- Modify: `src/renderer/src/stores/__tests__/healthCheck.test.ts`
- Modify: `src/renderer/src/hooks/__tests__/useHealthCheck.test.ts` (if exists)

- [ ] **Step 1: Add `useVisibleStuckTasks` selector to healthCheck store**

Add to `src/renderer/src/stores/healthCheck.ts`:

```ts
// After the store definition, add a selector hook that derives visibleStuckTasks
// by combining stuckTaskIds, dismissedIds, and tasks from sprintTasks store.
import { useSprintTasks } from './sprintTasks'
import { useMemo } from 'react'
import type { SprintTask } from '../../../shared/types'

export function useVisibleStuckTasks(): {
  visibleStuckTasks: SprintTask[]
  dismissTask: (id: string) => void
} {
  const tasks = useSprintTasks((s) => s.tasks)
  const stuckTaskIds = useHealthCheckStore((s) => s.stuckTaskIds)
  const dismissedIds = useHealthCheckStore((s) => s.dismissedIds)
  const dismissTask = useHealthCheckStore((s) => s.dismiss)

  const visibleStuckTasks = useMemo(
    () => tasks.filter((t) => stuckTaskIds.includes(t.id) && !dismissedIds.includes(t.id)),
    [tasks, stuckTaskIds, dismissedIds]
  )

  return { visibleStuckTasks, dismissTask }
}
```

- [ ] **Step 2: Refactor `useHealthCheck` to be parameterless**

Update `src/renderer/src/hooks/useHealthCheck.ts`:

```ts
import { useCallback, useEffect } from 'react'
import { useHealthCheckStore } from '../stores/healthCheck'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { POLL_HEALTH_CHECK_MS } from '../lib/constants'

/**
 * useHealthCheckPolling — polls for stuck tasks on a visibility-aware interval.
 * Writes results to healthCheck store. Consumers use useVisibleStuckTasks() to read.
 */
export function useHealthCheckPolling(): void {
  const setStuckTasks = useHealthCheckStore((s) => s.setStuckTasks)

  const runHealthCheck = useCallback(async () => {
    try {
      const stuck = await window.api.sprint.healthCheck()
      setStuckTasks(stuck.map((t) => t.id))
    } catch {
      /* silent */
    }
  }, [setStuckTasks])

  useEffect(() => {
    runHealthCheck()
  }, [runHealthCheck])
  useVisibilityAwareInterval(runHealthCheck, POLL_HEALTH_CHECK_MS)
}
```

- [ ] **Step 3: Update healthCheck store tests**

Add tests for `useVisibleStuckTasks` in `src/renderer/src/stores/__tests__/healthCheck.test.ts`. Mock `useSprintTasks` to return tasks, verify the selector filters correctly.

- [ ] **Step 4: Update useHealthCheck tests**

Update `src/renderer/src/hooks/__tests__/useHealthCheck.test.ts`:

- Change import from `import { useHealthCheck } from '../useHealthCheck'` to `import { useHealthCheckPolling } from '../useHealthCheck'`
- Replace all `renderHook(() => useHealthCheck(tasks))` calls with `renderHook(() => useHealthCheckPolling())`
- Remove the `tasks` variable/parameter setup since the hook now reads from the store
- Mock `useSprintTasks` store to provide tasks for tests that check stuck task filtering

- [ ] **Step 5: Run tests**

Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/stores/__tests__/healthCheck.test.ts src/renderer/src/hooks/__tests__/useHealthCheck.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useHealthCheck.ts src/renderer/src/stores/healthCheck.ts src/renderer/src/stores/__tests__/healthCheck.test.ts src/renderer/src/hooks/__tests__/useHealthCheck.test.ts
git commit -m "refactor: useHealthCheck reads tasks from store, add useVisibleStuckTasks selector"
```

---

## Task 3: Create new polling hooks

**Files:**

- Create: `src/renderer/src/hooks/useDashboardPolling.ts`
- Create: `src/renderer/src/hooks/useGitStatusPolling.ts`
- Create: `src/renderer/src/hooks/useAgentSessionPolling.ts`
- Create: `src/renderer/src/hooks/useCostPolling.ts`
- Create: `src/renderer/src/hooks/__tests__/useDashboardPolling.test.ts`
- Create: `src/renderer/src/hooks/__tests__/useGitStatusPolling.test.ts`
- Create: `src/renderer/src/hooks/__tests__/useAgentSessionPolling.test.ts`
- Create: `src/renderer/src/hooks/__tests__/useCostPolling.test.ts`

### 3a: `useDashboardPolling`

- [ ] **Step 1: Write failing test**

```ts
// src/renderer/src/hooks/__tests__/useDashboardPolling.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDashboardPolling } from '../useDashboardPolling'

const mockFetchAll = vi.fn()
vi.mock('../../stores/dashboardData', () => ({
  useDashboardDataStore: vi.fn((sel: (s: unknown) => unknown) => sel({ fetchAll: mockFetchAll }))
}))

vi.mock('../useBackoffInterval', () => ({
  useBackoffInterval: vi.fn()
}))

// Mock window.api
Object.defineProperty(window, 'api', {
  value: { onExternalSprintChange: vi.fn(() => vi.fn()) },
  writable: true,
  configurable: true
})

beforeEach(() => vi.clearAllMocks())

describe('useDashboardPolling', () => {
  it('calls fetchAll on mount', () => {
    renderHook(() => useDashboardPolling())
    expect(mockFetchAll).toHaveBeenCalled()
  })

  it('registers useBackoffInterval', async () => {
    const { useBackoffInterval } = await import('../useBackoffInterval')
    renderHook(() => useDashboardPolling())
    expect(useBackoffInterval).toHaveBeenCalledWith(mockFetchAll, expect.any(Number))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/hooks/__tests__/useDashboardPolling.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/hooks/useDashboardPolling.ts
import { useEffect } from 'react'
import { useDashboardDataStore } from '../stores/dashboardData'
import { useBackoffInterval } from './useBackoffInterval'
import { POLL_DASHBOARD_INTERVAL } from '../lib/constants'

/** Polls dashboard IPC endpoints (completions chart, activity feed, PR count). */
export function useDashboardPolling(): void {
  const fetchAll = useDashboardDataStore((s) => s.fetchAll)

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useBackoffInterval(fetchAll, POLL_DASHBOARD_INTERVAL)

  // Refresh on external sprint mutations
  useEffect(() => {
    return window.api.onExternalSprintChange(() => {
      fetchAll()
    })
  }, [fetchAll])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/hooks/__tests__/useDashboardPolling.test.ts`
Expected: PASS

### 3b: `useGitStatusPolling`

- [ ] **Step 5: Write failing test**

```ts
// src/renderer/src/hooks/__tests__/useGitStatusPolling.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitStatusPolling } from '../useGitStatusPolling'

const mockFetchStatus = vi.fn()
let currentActiveRepo = 'BDE'

vi.mock('../../stores/gitTree', () => ({
  useGitTreeStore: vi.fn((sel: (s: unknown) => unknown) =>
    sel({ activeRepo: currentActiveRepo, fetchStatus: mockFetchStatus })
  )
}))

vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
  currentActiveRepo = 'BDE'
})

describe('useGitStatusPolling', () => {
  it('registers visibility-aware interval', async () => {
    const { useVisibilityAwareInterval } = await import('../useVisibilityAwareInterval')
    renderHook(() => useGitStatusPolling())
    expect(useVisibilityAwareInterval).toHaveBeenCalledWith(expect.any(Function), 30_000)
  })

  it('passes null interval when no active repo', async () => {
    currentActiveRepo = ''
    const { useVisibilityAwareInterval } = await import('../useVisibilityAwareInterval')
    renderHook(() => useGitStatusPolling())
    expect(useVisibilityAwareInterval).toHaveBeenCalledWith(expect.any(Function), null)
  })
})
```

- [ ] **Step 6: Implement**

```ts
// src/renderer/src/hooks/useGitStatusPolling.ts
import { useCallback } from 'react'
import { useGitTreeStore } from '../stores/gitTree'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { POLL_GIT_STATUS_INTERVAL } from '../lib/constants'

/** Polls git status for the active repo. No-op if no repo selected. */
export function useGitStatusPolling(): void {
  const activeRepo = useGitTreeStore((s) => s.activeRepo)
  const fetchStatus = useGitTreeStore((s) => s.fetchStatus)

  const poll = useCallback(() => {
    if (activeRepo) fetchStatus(activeRepo)
  }, [activeRepo, fetchStatus])

  useVisibilityAwareInterval(poll, activeRepo ? POLL_GIT_STATUS_INTERVAL : null)
}
```

- [ ] **Step 7: Run test**

Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/hooks/__tests__/useGitStatusPolling.test.ts`
Expected: PASS

### 3c: `useAgentSessionPolling`

- [ ] **Step 8: Write failing test**

```ts
// src/renderer/src/hooks/__tests__/useAgentSessionPolling.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAgentSessionPolling } from '../useAgentSessionPolling'

const mockFetchAgents = vi.fn()

vi.mock('../../stores/agentHistory', () => ({
  useAgentHistoryStore: vi.fn((sel: (s: unknown) => unknown) =>
    sel({ fetchAgents: mockFetchAgents })
  )
}))

vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn()
}))

beforeEach(() => vi.clearAllMocks())

describe('useAgentSessionPolling', () => {
  it('calls fetchAgents on mount', () => {
    renderHook(() => useAgentSessionPolling())
    expect(mockFetchAgents).toHaveBeenCalled()
  })

  it('registers visibility-aware interval at POLL_SESSIONS_INTERVAL', async () => {
    const { useVisibilityAwareInterval } = await import('../useVisibilityAwareInterval')
    renderHook(() => useAgentSessionPolling())
    expect(useVisibilityAwareInterval).toHaveBeenCalledWith(mockFetchAgents, 10_000)
  })
})
```

- [ ] **Step 9: Implement**

```ts
// src/renderer/src/hooks/useAgentSessionPolling.ts
import { useEffect } from 'react'
import { useAgentHistoryStore } from '../stores/agentHistory'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { POLL_SESSIONS_INTERVAL } from '../lib/constants'

/** Polls agent session list unconditionally. */
export function useAgentSessionPolling(): void {
  const fetchAgents = useAgentHistoryStore((s) => s.fetchAgents)

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  useVisibilityAwareInterval(fetchAgents, POLL_SESSIONS_INTERVAL)
}
```

### 3d: `useCostPolling`

- [ ] **Step 10: Write failing test**

```ts
// src/renderer/src/hooks/__tests__/useCostPolling.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCostPolling } from '../useCostPolling'

const mockFetchLocalAgents = vi.fn()

vi.mock('../../stores/costData', () => ({
  useCostDataStore: vi.fn((sel: (s: unknown) => unknown) =>
    sel({ fetchLocalAgents: mockFetchLocalAgents })
  )
}))

vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn()
}))

beforeEach(() => vi.clearAllMocks())

describe('useCostPolling', () => {
  it('calls fetchLocalAgents on mount', () => {
    renderHook(() => useCostPolling())
    expect(mockFetchLocalAgents).toHaveBeenCalled()
  })

  it('registers visibility-aware interval', async () => {
    const { useVisibilityAwareInterval } = await import('../useVisibilityAwareInterval')
    renderHook(() => useCostPolling())
    expect(useVisibilityAwareInterval).toHaveBeenCalledWith(mockFetchLocalAgents, 30_000)
  })
})
```

- [ ] **Step 11: Implement**

```ts
// src/renderer/src/hooks/useCostPolling.ts
import { useEffect } from 'react'
import { useCostDataStore } from '../stores/costData'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { POLL_COST_INTERVAL } from '../lib/constants'

/** Polls cost data and refreshes the shared costData store. */
export function useCostPolling(): void {
  const fetchLocalAgents = useCostDataStore((s) => s.fetchLocalAgents)

  useEffect(() => {
    fetchLocalAgents()
  }, [fetchLocalAgents])

  useVisibilityAwareInterval(fetchLocalAgents, POLL_COST_INTERVAL)
}
```

- [ ] **Step 12: Run all new hook tests**

Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/hooks/__tests__/useDashboardPolling.test.ts src/renderer/src/hooks/__tests__/useGitStatusPolling.test.ts src/renderer/src/hooks/__tests__/useAgentSessionPolling.test.ts src/renderer/src/hooks/__tests__/useCostPolling.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add src/renderer/src/hooks/useDashboardPolling.ts src/renderer/src/hooks/useGitStatusPolling.ts src/renderer/src/hooks/useAgentSessionPolling.ts src/renderer/src/hooks/useCostPolling.ts src/renderer/src/hooks/__tests__/useDashboardPolling.test.ts src/renderer/src/hooks/__tests__/useGitStatusPolling.test.ts src/renderer/src/hooks/__tests__/useAgentSessionPolling.test.ts src/renderer/src/hooks/__tests__/useCostPolling.test.ts
git commit -m "feat: add polling hooks for dashboard, git, agents, and cost"
```

---

## Task 4: Create `PollingProvider` and mount in App

**Files:**

- Create: `src/renderer/src/components/PollingProvider.tsx`
- Create: `src/renderer/src/components/__tests__/PollingProvider.test.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write failing test for PollingProvider**

```tsx
// src/renderer/src/components/__tests__/PollingProvider.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PollingProvider } from '../PollingProvider'

// Mock all polling hooks
vi.mock('../../hooks/useSprintPolling', () => ({ useSprintPolling: vi.fn() }))
vi.mock('../../hooks/usePrStatusPolling', () => ({ usePrStatusPolling: vi.fn() }))
vi.mock('../../hooks/useHealthCheck', () => ({ useHealthCheckPolling: vi.fn() }))
vi.mock('../../hooks/useDashboardPolling', () => ({ useDashboardPolling: vi.fn() }))
vi.mock('../../hooks/useGitStatusPolling', () => ({ useGitStatusPolling: vi.fn() }))
vi.mock('../../hooks/useAgentSessionPolling', () => ({ useAgentSessionPolling: vi.fn() }))
vi.mock('../../hooks/useCostPolling', () => ({ useCostPolling: vi.fn() }))

describe('PollingProvider', () => {
  it('renders children', () => {
    const { getByText } = render(
      <PollingProvider>
        <div>child content</div>
      </PollingProvider>
    )
    expect(getByText('child content')).toBeTruthy()
  })

  it('calls all polling hooks', async () => {
    const { useSprintPolling } = await import('../../hooks/useSprintPolling')
    const { usePrStatusPolling } = await import('../../hooks/usePrStatusPolling')
    const { useHealthCheckPolling } = await import('../../hooks/useHealthCheck')
    const { useDashboardPolling } = await import('../../hooks/useDashboardPolling')
    const { useGitStatusPolling } = await import('../../hooks/useGitStatusPolling')
    const { useAgentSessionPolling } = await import('../../hooks/useAgentSessionPolling')
    const { useCostPolling } = await import('../../hooks/useCostPolling')

    render(
      <PollingProvider>
        <div />
      </PollingProvider>
    )

    expect(useSprintPolling).toHaveBeenCalled()
    expect(usePrStatusPolling).toHaveBeenCalled()
    expect(useHealthCheckPolling).toHaveBeenCalled()
    expect(useDashboardPolling).toHaveBeenCalled()
    expect(useGitStatusPolling).toHaveBeenCalled()
    expect(useAgentSessionPolling).toHaveBeenCalled()
    expect(useCostPolling).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Implement PollingProvider**

```tsx
// src/renderer/src/components/PollingProvider.tsx
import type { ReactNode } from 'react'
import { useSprintPolling } from '../hooks/useSprintPolling'
import { usePrStatusPolling } from '../hooks/usePrStatusPolling'
import { useHealthCheckPolling } from '../hooks/useHealthCheck'
import { useDashboardPolling } from '../hooks/useDashboardPolling'
import { useGitStatusPolling } from '../hooks/useGitStatusPolling'
import { useAgentSessionPolling } from '../hooks/useAgentSessionPolling'
import { useCostPolling } from '../hooks/useCostPolling'

/**
 * Renderless root component that owns all data-fetching pollers.
 * Mount once in App.tsx — views become pure store consumers.
 */
export function PollingProvider({ children }: { children: ReactNode }) {
  useSprintPolling()
  usePrStatusPolling()
  useHealthCheckPolling()
  useDashboardPolling()
  useGitStatusPolling()
  useAgentSessionPolling()
  useCostPolling()

  return <>{children}</>
}
```

- [ ] **Step 3: Run PollingProvider tests**

Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/components/__tests__/PollingProvider.test.tsx`
Expected: PASS

- [ ] **Step 4: Mount in App.tsx**

In `src/renderer/src/App.tsx`:

- Add import: `import { PollingProvider } from './components/PollingProvider'`
- Wrap the `<div className="app-shell elevation-0">` return block with `<PollingProvider>...</PollingProvider>`

- [ ] **Step 5: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/PollingProvider.tsx src/renderer/src/components/__tests__/PollingProvider.test.tsx src/renderer/src/App.tsx
git commit -m "feat: add PollingProvider and mount in App root"
```

---

## Task 5: Remove polling from views

**Files:**

- Modify: `src/renderer/src/views/DashboardView.tsx`
- Modify: `src/renderer/src/views/GitTreeView.tsx`
- Modify: `src/renderer/src/views/AgentsView.tsx`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/components/settings/CostSection.tsx`

### 5a: DashboardView

- [ ] **Step 1: Refactor DashboardView to use `dashboardData` store**

In `src/renderer/src/views/DashboardView.tsx`:

- Remove imports: `useBackoffInterval`, `useSprintPolling`, `POLL_DASHBOARD_INTERVAL`
- Add import: `import { useShallow } from 'zustand/react/shallow'`
- Add import: `import { useDashboardDataStore } from '../stores/dashboardData'`
- Remove local state: `chartData`, `feedEvents`, `prCount`, `loading`, `cardErrors` (all `useState` calls)
- Remove: `cancelledRef`, `fetchCompletionsChart`, `fetchActivityFeed`, `fetchPRCount`, `fetchDashboardData` callbacks
- Remove: `useSprintPolling()` call
- Remove: `useBackoffInterval(fetchDashboardData, POLL_DASHBOARD_INTERVAL)` call
- Remove: `useEffect` that registers `onExternalSprintChange` for dashboard data (this listener is now in `useDashboardPolling`, not lost)
- Add store reads: `const { chartData, feedEvents, prCount, loading, cardErrors } = useDashboardDataStore(useShallow(s => ({ chartData: s.chartData, feedEvents: s.feedEvents, prCount: s.prCount, loading: s.loading, cardErrors: s.cardErrors })))`
- Keep all the `useMemo` derivations (`stats`, `successRate`, `avgDuration`, `costTrendData`, `recentCompletions`, `pipelineStages`) — these read from `sprintTasks` and `costData` stores which are still imported
- **Note on error retry**: DashboardView currently has per-card "Retry" buttons that call individual fetch functions. After refactor, retry calls `useDashboardDataStore.getState().fetchAll()` which re-fetches all three. If per-card retry is important, add `fetchChart`, `fetchFeed`, `fetchPRs` actions to the store. Otherwise simplify to a single retry that calls `fetchAll()`.

### 5b: GitTreeView

- [ ] **Step 2: Remove polling interval from GitTreeView**

In `src/renderer/src/views/GitTreeView.tsx`:

- Remove import: `useVisibilityAwareInterval`, `POLL_GIT_STATUS_INTERVAL`
- Remove: the `poll` callback and `useVisibilityAwareInterval(poll, activeRepo ? POLL_GIT_STATUS_INTERVAL : null)` call
- Keep: the `useEffect` that calls `fetchStatus(activeRepo)` on mount/repo change (lines 54-59)

### 5c: AgentsView

- [ ] **Step 3: Remove polling interval from AgentsView**

In `src/renderer/src/views/AgentsView.tsx`:

- Remove import: `useVisibilityAwareInterval`, `POLL_SESSIONS_INTERVAL`
- Remove: `useVisibilityAwareInterval(fetchAgents, activeView === 'agents' ? POLL_SESSIONS_INTERVAL : null)` call
- Keep: the `useEffect` that calls `fetchAgents()` when `activeView === 'agents'` (lines 54-57)

### 5d: SprintPipeline

- [ ] **Step 4: Remove polling hooks from SprintPipeline**

In `src/renderer/src/components/sprint/SprintPipeline.tsx`:

- Remove imports: `useSprintPolling`, `usePrStatusPolling`, `useHealthCheck`
- Remove: `useSprintPolling()` call (line 122)
- Remove: `usePrStatusPolling()` call (line 123)
- Remove: `const { visibleStuckTasks, dismissTask } = useHealthCheck(tasks)` (line 87)
- Add import: `import { useVisibleStuckTasks } from '../../stores/healthCheck'`
- Add: `const { visibleStuckTasks, dismissTask } = useVisibleStuckTasks()`

### 5e: CostSection

- [ ] **Step 5: Remove polling interval from CostSection**

In `src/renderer/src/components/settings/CostSection.tsx`:

- Remove import: `useVisibilityAwareInterval`, `POLL_COST_INTERVAL`
- Remove: `useVisibilityAwareInterval(fetchData, POLL_COST_INTERVAL)` call (line 253)
- Keep: `fetchData` callback and initial `useEffect` (the CostSection still has its own local state for `summary` and `runs` which are settings-page-specific data not needed globally)

- [ ] **Step 6: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `cd ~/projects/BDE && npm test`
Expected: Some tests may fail due to updated mock expectations — fix in Task 6

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/views/DashboardView.tsx src/renderer/src/views/GitTreeView.tsx src/renderer/src/views/AgentsView.tsx src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/components/settings/CostSection.tsx
git commit -m "refactor: remove polling from views — now owned by PollingProvider"
```

---

## Task 6: Update existing tests

**Files:**

- Modify: `src/renderer/src/views/__tests__/DashboardView.test.tsx`
- Modify: `src/renderer/src/views/__tests__/GitTreeView.test.tsx`
- Modify: `src/renderer/src/views/__tests__/AgentsView.test.tsx`
- Modify: `src/renderer/src/components/sprint/__tests__/SprintPipeline.test.tsx`

- [ ] **Step 1: Update DashboardView tests**

In `src/renderer/src/views/__tests__/DashboardView.test.tsx`:

**Mock changes:**

- Remove mock for `useSprintPolling` (line 28 — no longer imported by DashboardView)
- Add mock for `dashboardData` store: `vi.mock('../../stores/dashboardData', ...)` returning `{ chartData: [], feedEvents: [], prCount: 0, cardErrors: {}, loading: false, fetchAll: vi.fn() }`
- `window.api.dashboard.*` and `window.api.getPrList` mocks can stay (some tests may still set them up) but are no longer called by DashboardView directly

**Tests to delete (they test polling behavior that moved to useDashboardPolling):**

- "re-fetches dashboard data on polling interval" (line ~182) — tests `advanceTimersByTime` triggering refetches; this is now `useDashboardPolling`'s concern
- "logs errors instead of swallowing them" (line ~202) — error logging moved to `dashboardData` store; move this assertion to `dashboardData.test.ts`

**Tests to rewrite (they depend on `advanceTimersByTimeAsync` to flush DashboardView's own fetch):**

- "renders chart data from completionsPerHour" — instead of flushing a timer, mock `useDashboardDataStore` to return chart data and assert it renders
- "renders feed events from recentEvents" — same: mock store with feed events
- "renders correct PR count from getPrList payload" — mock store with `prCount: 2`
- "shows error state with retry button when all fetches fail" — mock store with `cardErrors: { chart: '...', feed: '...', prs: '...' }`
- "retries fetching data when Retry button clicked" — click retry, assert `fetchAll` was called
- "shows Loading... text during initial load" — mock store with `loading: true`

**Tests that stay unchanged** (they only read from `sprintTasks`/`costData` stores, no timer dependency):

- All stat navigation tests (clicking Active/Done/Blocked/Queued/PRs)
- Success ring percentage tests
- Duration formatting tests
- Recent completions tests
- Cost trend chart tests
- "renders the Ops Deck command center", "renders stat counters", "renders pipeline and cost sections"

- [ ] **Step 2: Update GitTreeView tests**

In `src/renderer/src/views/__tests__/GitTreeView.test.tsx`:

- Remove mock for `useVisibilityAwareInterval` (no longer imported)

- [ ] **Step 3: Update AgentsView tests**

In `src/renderer/src/views/__tests__/AgentsView.test.tsx`:

- Remove mock for `useVisibilityAwareInterval` (no longer imported)

- [ ] **Step 4: Update SprintPipeline tests**

In `src/renderer/src/components/sprint/__tests__/SprintPipeline.test.tsx`:

- Remove mocks for `useSprintPolling`, `usePrStatusPolling`
- Update mock for `useHealthCheck` → mock `useVisibleStuckTasks` from `../../stores/healthCheck` instead

- [ ] **Step 5: Run full test suite**

Run: `cd ~/projects/BDE && npm test`
Expected: ALL PASS

- [ ] **Step 6: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/views/__tests__/DashboardView.test.tsx src/renderer/src/views/__tests__/GitTreeView.test.tsx src/renderer/src/views/__tests__/AgentsView.test.tsx src/renderer/src/components/sprint/__tests__/SprintPipeline.test.tsx
git commit -m "test: update view tests for polling consolidation"
```

---

## Task 7: Migrate log poller to visibility-aware pattern

**Files:**

- Modify: `src/renderer/src/lib/logPoller.ts`

- [ ] **Step 1: Refactor logPoller.ts**

Replace the raw `setInterval` + `document.hidden` check with visibility-aware scheduling:

```ts
// In createLogPollerActions, replace the interval setup:
export function createLogPollerActions(
  get: () => LogPollerState,
  set: (s: Partial<LogPollerState>) => void
): {
  startLogPolling: (
    readFn: (fromByte: number) => Promise<{ content: string; nextByte: number }>
  ) => () => void
  stopLogPolling: () => void
} {
  let logInterval: ReturnType<typeof setInterval> | null = null
  let visibilityHandler: (() => void) | null = null

  const stop = (): void => {
    if (logInterval) {
      clearInterval(logInterval)
      logInterval = null
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  return {
    startLogPolling: (readFn): (() => void) => {
      stop()

      const poll = async (): Promise<void> => {
        try {
          const result = await readFn(get().logNextByte)
          if (result.content) {
            let updated = get().logContent + result.content
            let trimmedLines = get().logTrimmedLines

            const lines = updated.split('\n')
            if (lines.length > MAX_LOG_LINES) {
              const excess = lines.length - MAX_LOG_LINES
              trimmedLines += excess
              updated = lines.slice(excess).join('\n')
            }

            set({
              logContent: updated,
              logNextByte: result.nextByte,
              logTrimmedLines: trimmedLines
            })
          }
        } catch {
          // Log may not exist yet
        }
      }

      function startInterval(): void {
        if (logInterval) clearInterval(logInterval)
        logInterval = setInterval(poll, POLL_LOG_INTERVAL)
      }

      visibilityHandler = () => {
        if (document.hidden) {
          if (logInterval) {
            clearInterval(logInterval)
            logInterval = null
          }
        } else {
          poll() // immediate refresh on resume
          startInterval()
        }
      }

      document.addEventListener('visibilitychange', visibilityHandler)
      poll()
      startInterval()
      return stop
    },

    stopLogPolling: stop
  }
}
```

- [ ] **Step 2: Run tests**

Run: `cd ~/projects/BDE && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/logPoller.ts
git commit -m "refactor: migrate log poller to visibility-aware pattern"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd ~/projects/BDE && npm test`
Expected: ALL PASS

- [ ] **Step 2: Run main process tests**

Run: `cd ~/projects/BDE && npm run test:main`
Expected: ALL PASS

- [ ] **Step 3: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run lint**

Run: `cd ~/projects/BDE && npm run lint`
Expected: PASS

- [ ] **Step 5: Run coverage check**

Run: `cd ~/projects/BDE && npm run test:coverage`
Expected: PASS (meets thresholds: 72% stmts, 66% branches, 70% functions, 74% lines)

- [ ] **Step 6: Verify no raw setInterval remains in views**

Run: `grep -r 'setInterval\|useVisibilityAwareInterval\|useBackoffInterval' src/renderer/src/views/ src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/components/settings/CostSection.tsx`
Expected: No polling-related intervals in any of these files (CostSection may still have its local `fetchData` but no interval setup)

- [ ] **Step 7: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore: polling consolidation fixups"
```
