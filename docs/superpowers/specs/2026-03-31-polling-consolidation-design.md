# Polling Consolidation Design

> Consolidate all renderer data-fetching pollers into a single root-level `PollingProvider`, eliminating duplicate timers and ensuring stores are always warm regardless of which view is active.

## Problem

The renderer has up to 11 concurrent `setInterval`/`setTimeout` timers spread across individual views and components. Key issues:

1. **Duplicate polling**: `useSprintPolling()` is called in both `SprintPipeline` and `DashboardView` — when both panels are mounted, sprint data is fetched twice per interval
2. **Cold stores on view switch**: Data only polls while its view is mounted, causing a loading flash when switching to a view that hasn't been open
3. **Scattered ownership**: Polling logic is split across 7+ files, making it hard to reason about aggregate load or adjust intervals globally

## Design

### PollingProvider component

A new renderless component at `src/renderer/src/components/PollingProvider.tsx` that owns all data-fetching pollers. Mounted once in `App.tsx` wrapping the app shell. Returns `{children}` — no DOM output.

```tsx
// Pseudocode structure
export function PollingProvider({ children }: { children: React.ReactNode }) {
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

All pollers run unconditionally (always-on). The overhead of a few extra IPC calls per minute is negligible compared to the complexity of view-aware activation, and stores stay warm so views render instantly on switch.

### Pollers moving to the provider

| Poller              | Hook                     | Interval                         | Current location              | Notes                                                                  |
| ------------------- | ------------------------ | -------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| Sprint tasks        | `useSprintPolling`       | 30s (active tasks) / 120s (idle) | SprintPipeline, DashboardView | Remove duplicate. Keep SSE listener                                    |
| PR status           | `usePrStatusPolling`     | 60s                              | SprintPipeline                | No changes to hook internals                                           |
| Health check        | `useHealthCheckPolling`  | 600s                             | SprintPipeline                | Refactor: read tasks from store directly instead of accepting as param |
| Dashboard aggregate | `useDashboardPolling`    | 60s (backoff)                    | DashboardView                 | Extract fetch logic into new hook                                      |
| Git status          | `useGitStatusPolling`    | 30s                              | GitTreeView                   | Extract; always poll for first configured repo, or all                 |
| Agent sessions      | `useAgentSessionPolling` | 10s                              | AgentsView                    | Extract fetch logic into new hook                                      |
| Cost data           | `useCostPolling`         | 30s                              | CostSection                   | Extract fetch logic into new hook                                      |

### Pollers staying per-component

| Poller         | Interval | Location                                                          | Reason                                                      |
| -------------- | -------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Elapsed timers | 1-10s    | TaskPill, TaskDetailDrawer, ElapsedTime, AgentCard, ConsoleHeader | Cosmetic tick counters, cheap, mount/unmount with component |
| Log poller     | 1s       | logPoller.ts (store action)                                       | Imperative start/stop tied to specific agent session        |

### Hook refactors

**`useHealthCheck`** — Currently accepts `tasks: SprintTask[]` as a parameter from SprintPipeline. Refactor to import and subscribe to `useSprintTasks` store directly so it can run independently in the provider. The `visibleStuckTasks` derivation (currently a `useMemo` in the hook) becomes a selector hook `useVisibleStuckTasks()` exported from `healthCheck.ts` — consumers call `useVisibleStuckTasks()` instead of destructuring from the hook return. The `dismissTask` action already lives in the store.

**`useDashboardPolling`** (new) — Extract the `fetchDashboardData` logic from `DashboardView.tsx` into a standalone hook. Note: the dashboard fetches three IPC endpoints (`dashboard.completionsPerHour`, `dashboard.recentEvents`, `getPrList`) that currently store results in **local component state** (`chartData`, `feedEvents`, `prCount`, `cardErrors`, `loading`). This state must move to a new `dashboardData` Zustand store so the provider can populate it and DashboardView can read it reactively. The store holds: `chartData: ChartBar[]`, `feedEvents: FeedEvent[]`, `prCount: number`, `cardErrors: Record<string, string | undefined>`, `loading: boolean`, and a `fetchAll()` action.

**`useGitStatusPolling`** (new) — Extract git status polling from `GitTreeView.tsx`. Runs unconditionally — polls `git:status` for the active repo (read from `gitTree` store). If no repo is selected, the poll is a no-op.

**`useAgentSessionPolling`** (new) — Extract agent list fetch from `AgentsView.tsx` into a hook that calls `window.api.sessions.list()` on interval and updates the agents store. Note: the current 10s interval is the shortest of any poller (6 calls/min). This is acceptable because agent session listing is a lightweight local IPC call (reads from in-memory agent manager state, no disk/network), but if profiling shows overhead, increase to 30s.

**`useCostPolling`** (new) — Extract cost data fetch from `CostSection.tsx` into a hook that refreshes the cost store. Must also call `refreshStore()` (which triggers `fetchLocalAgents` in the `costData` store) to keep `totalCost` fresh for the Dashboard and TitleBar.

### View changes

Each view removes its polling setup but keeps a one-time `useEffect(() => { loadData() }, [])` for immediate mount fetch (no blank flash on first render before the next interval fires):

- **SprintPipeline.tsx** — Remove `useSprintPolling()`, `usePrStatusPolling()`, `useHealthCheck(tasks)`. Read `visibleStuckTasks`/`dismissTask` from `healthCheck` store instead
- **DashboardView.tsx** — Remove `useSprintPolling()`, `useBackoffInterval(fetchDashboardData, ...)`. Keep initial fetch
- **GitTreeView.tsx** — Remove `useVisibilityAwareInterval(poll, ...)`. Remove the `activeRepo ? interval : null` conditional. Keep initial fetch
- **AgentsView.tsx** — Remove `useVisibilityAwareInterval(fetchAgents, ...)`. Remove the `activeView === 'agents' ? interval : null` conditional. Keep initial fetch
- **CostSection.tsx** — Remove `useVisibilityAwareInterval(fetchData, ...)`. Keep initial fetch

### Log poller migration

`src/renderer/src/lib/logPoller.ts` currently uses raw `setInterval` with a manual `document.hidden` guard. Refactor `createLogPollerActions` to add a `document.hidden` early-return at the top of `poll()` and replace the raw `setInterval` with the same visibility-pause pattern used by `useVisibilityAwareInterval` (listen for `visibilitychange`, stop timer on hide, restart + immediate fire on show). The imperative `startLogPolling` / `stopLogPolling` API stays unchanged — it's needed for the agent console open/close lifecycle.

### App.tsx integration

`PollingProvider` wraps the entire return JSX of the `App` component (there is no separate `AppShell` component):

```tsx
// In App.tsx, wrap the app content
return (
  <PollingProvider>
    <div className="app-shell elevation-0">{/* existing app content */}</div>
  </PollingProvider>
)
```

The provider mounts before any view, so stores begin warming immediately on app launch.

## Files changed

| File                                                    | Change                                                    |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `src/renderer/src/components/PollingProvider.tsx`       | **New** — root polling orchestrator                       |
| `src/renderer/src/hooks/useDashboardPolling.ts`         | **New** — extracted from DashboardView                    |
| `src/renderer/src/hooks/useGitStatusPolling.ts`         | **New** — extracted from GitTreeView                      |
| `src/renderer/src/hooks/useAgentSessionPolling.ts`      | **New** — extracted from AgentsView                       |
| `src/renderer/src/hooks/useCostPolling.ts`              | **New** — extracted from CostSection                      |
| `src/renderer/src/hooks/useHealthCheck.ts`              | **Modified** — read tasks from store, remove tasks param  |
| `src/renderer/src/stores/healthCheck.ts`                | **Modified** — add `useVisibleStuckTasks()` selector hook |
| `src/renderer/src/stores/dashboardData.ts`              | **New** — Zustand store for dashboard chart/feed/PR data  |
| `src/renderer/src/App.tsx`                              | **Modified** — mount PollingProvider                      |
| `src/renderer/src/views/DashboardView.tsx`              | **Modified** — remove polling hooks                       |
| `src/renderer/src/views/GitTreeView.tsx`                | **Modified** — remove polling interval                    |
| `src/renderer/src/views/AgentsView.tsx`                 | **Modified** — remove polling interval                    |
| `src/renderer/src/components/sprint/SprintPipeline.tsx` | **Modified** — remove polling hooks                       |
| `src/renderer/src/components/settings/CostSection.tsx`  | **Modified** — remove polling interval                    |
| `src/renderer/src/lib/logPoller.ts`                     | **Modified** — migrate to visibility-aware interval       |
| Tests for all modified/new files                        | **Modified/New** — update mocks, add coverage             |

## Testing

- Unit tests for each new polling hook (mock IPC, verify interval setup/teardown)
- Update existing view tests to remove polling mock expectations
- Verify no duplicate `setInterval` calls via test that mounts `PollingProvider` + views simultaneously
- `npm test` and `npm run test:main` must pass
- `npm run typecheck` must pass

## Out of scope

- Consolidating elapsed-time cosmetic timers (cheap, per-component, no IPC)
- Changing polling intervals (separate tuning exercise)
- Main process pollers (PR poller, sprint PR poller, agent manager timers — already well-structured)
- SSE-based push to replace polling (future enhancement)
