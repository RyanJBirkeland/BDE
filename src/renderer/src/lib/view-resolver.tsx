import React, { lazy } from 'react'
import type { View } from '../stores/panelLayout'

const DashboardView = lazy(() => import('../views/DashboardView'))
const AgentsView = lazy(() =>
  import('../views/AgentsView').then((m) => ({ default: m.AgentsView }))
)
const IDEView = lazy(() => import('../views/IDEView'))
const SprintView = lazy(() => import('../views/SprintView'))
const SettingsView = lazy(() => import('../views/SettingsView'))
const PRStationView = lazy(() => import('../views/PRStationView'))
const TaskWorkbenchView = lazy(() => import('../views/TaskWorkbenchView'))
const GitTreeView = lazy(() => import('../views/GitTreeView'))

export function resolveView(viewKey: View): React.ReactNode {
  switch (viewKey) {
    case 'dashboard':
      return <DashboardView />
    case 'agents':
      return <AgentsView />
    case 'ide':
      return <IDEView />
    case 'sprint':
      return <SprintView />
    case 'settings':
      return <SettingsView />
    case 'pr-station':
      return <PRStationView />
    case 'task-workbench':
      return <TaskWorkbenchView />
    case 'git':
      return <GitTreeView />
  }
}
