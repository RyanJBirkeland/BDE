# Views

Top-level React view components. One per app view (Dashboard, IDE, Sprint Pipeline, etc.).
Source: `src/renderer/src/views/`

All views listed below are wrapped in `<ErrorBoundary name="ViewName">` so a render crash in one view cannot take down the entire panel.

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `DashboardView.tsx` | Dashboard overview: status counters, pipeline flow, charts, activity feed. Polls dashboard data every 60s (`POLL_DASHBOARD_INTERVAL`) and load average every 5s (`POLL_LOAD_AVERAGE`). Both intervals start immediately on mount. ErrorBoundary protected. | `DashboardView` (default) |
| `IDEView.tsx` | Monaco editor + file explorer sidebar + integrated terminal. Multi-tab interface with dirty-state tracking. ErrorBoundary protected. | `IDEView` (default) |
| `GitTreeView.tsx` | Source control: staging, committing, and pushing across configured repositories. Polls git status every 30s. ErrorBoundary protected. | `GitTreeView` (default) |
| `CodeReviewView.tsx` | Human-in-the-loop review interface: diff inspection, commit history, conversation log, and action buttons (merge, PR, revise, discard). ErrorBoundary protected. Renders `GitHubOptedOutBanner` above `TopBar` so users who chose read-only mode see why PR actions fail. | `CodeReviewView` (default) |
| `PlannerView.tsx` | Multi-task workflow planning: epic management with task grouping, dependency management, and batch queuing. Add Task / Edit Task open the canonical `TaskWorkbenchModal` via `useTaskWorkbenchModalStore`. Tracks `assistantOpen` state; placeholder renders only when both `assistantOpen` and `selectedGroup` are truthy (derived during render — no effect). ErrorBoundary protected. | `PlannerView` (default) |
| `SprintView.tsx` | Sprint pipeline execution monitor: three-zone layout (backlog, stages, task detail). | `SprintView` (default) |
| `AgentsView.tsx` | Adhoc and assistant agent sessions: spawn, chat, and monitor multi-turn agent conversations. | `AgentsView` (default) |
| `TaskWorkbenchView.tsx` | File kept on disk but removed from `VIEW_REGISTRY` and `View` union — no longer navigable. Task creation lives in the canonical `TaskWorkbenchModal` mounted at app root. Still renders `GitHubOptedOutBanner` above the workbench so the read-only-mode indicator is in place if the view is ever re-registered. | `TaskWorkbenchView` (default) |
| `SettingsView.tsx` | Settings layout with sidebar + content area. 7 tabs: Connections, Repositories, Templates, Agents, Memory, Appearance & Shortcuts, About & Usage. Driven by `useSettingsNavStore`. | `SettingsView` (default) |
