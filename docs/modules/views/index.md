# Views

Top-level React view components. One per app view (Dashboard, IDE, Sprint Pipeline, etc.).
Source: `src/renderer/src/views/`

All views listed below are wrapped in `<ErrorBoundary name="ViewName">` so a render crash in one view cannot take down the entire panel.

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `DashboardView.tsx` | V1/V2 feature-flag dispatcher. Renders `DashboardViewV1` (default) or `DashboardViewV2` based on `featureFlags.v2Dashboard`. Toggle: `localStorage.setItem('fleet:ff', JSON.stringify({v2Dashboard:true})); location.reload()`. | `DashboardView` (default) |
| `DashboardViewV1.tsx` | V1 dashboard: status counters, pipeline flow, charts, activity feed. Preserved for feature-flag rollback. Uses neon-era components (StatusRail, CenterColumn, ActivitySection, MorningBriefing, FiresStrip). | `DashboardViewV1` (default) |
| `DashboardViewV2.tsx` | V2 dashboard: triage-oriented layout — MissionBriefBand + Live column (ActiveAgents, PipelineGlance, Throughput) + Triage column (Attention, ReviewQueue, RecentCompletions) + KPI strip + stats accordion. Delegates data aggregation to `useDashboardData`. Rendered when `featureFlags.v2Dashboard = true`. | `DashboardViewV2` (default) |
| `IDEView.tsx` | Monaco editor + file explorer sidebar + integrated terminal. Multi-tab interface with dirty-state tracking. File-loading state uses `<LoadingState />` (accessible `role="status"`). ErrorBoundary protected. | `IDEView` (default) |
| `GitTreeView.tsx` | Source control: staging, committing, and pushing across configured repositories. Polls git status every 30s. ErrorBoundary protected. | `GitTreeView` (default) |
| `CodeReviewView.tsx` | Human-in-the-loop review interface: diff inspection, commit history, conversation log, and action buttons (merge, PR, revise, discard, approve). ErrorBoundary protected. Renders `GitHubOptedOutBanner` above `TopBar` so users who chose read-only mode see why PR actions fail. `reviewTasksSorted` memo now includes both `review` and `approved` statuses so j/k navigation and command palette actions span both sidebar sections. | `CodeReviewView` (default) |
| `PlannerView.tsx` | Multi-task workflow planning: epic management with task grouping, dependency management, and batch queuing. Add Task / Edit Task open the canonical `TaskWorkbenchModal` via `useTaskWorkbenchModalStore`. Handles `handleTogglePause` via `togglePause` from `useTaskGroups` and threads it to `EpicDetail`. Tracks `assistantOpen` state; placeholder renders only when both `assistantOpen` and `selectedGroup` are truthy (derived during render — no effect). ErrorBoundary protected. | `PlannerView` (default) |
| `SprintView.tsx` | Sprint pipeline execution monitor: three-zone layout (backlog, stages, task detail). | `SprintView` (default) |
| `AgentsView.tsx` | V1/V2 feature-flag dispatcher. Renders `AgentsViewV1` (default) or `AgentsViewV2` based on `featureFlags.v2Agents`. Toggle: `localStorage.setItem('fleet:ff', JSON.stringify({v2Agents:true})); location.reload()`. | `AgentsView` (default) |
| `AgentsViewV1.tsx` | V1 agents view: neon command center with Fleet List + Agent Console (two-pane). Preserved for feature-flag rollback. | `AgentsViewV1` |
| `AgentsViewV2.tsx` | V2 agents view stub — full implementation in progress. Rendered when `featureFlags.v2Agents = true`. | `AgentsViewV2` |
| `TaskWorkbenchView.tsx` | File kept on disk but removed from `VIEW_REGISTRY` and `View` union — no longer navigable. Task creation lives in the canonical `TaskWorkbenchModal` mounted at app root. Still renders `GitHubOptedOutBanner` above the workbench so the read-only-mode indicator is in place if the view is ever re-registered. | `TaskWorkbenchView` (default) |
| `SettingsView.tsx` | Settings layout with sidebar + content area. 7 tabs: Connections, Repositories, Templates, Agents, Memory, Appearance & Shortcuts, About & Usage. Driven by `useSettingsNavStore`. | `SettingsView` (default) |
