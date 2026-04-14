import { describe, it, expect, vi } from 'vitest'

// Mock all lazy-loaded views as synchronous components
vi.mock('../../views/DashboardView', () => ({ default: () => <div data-testid="dashboard" /> }))
vi.mock('../../views/AgentsView', () => ({
  AgentsView: () => <div data-testid="agents" />
}))
vi.mock('../../views/IDEView', () => ({ default: () => <div data-testid="ide" /> }))
vi.mock('../../views/SprintView', () => ({ default: () => <div data-testid="sprint" /> }))
vi.mock('../../views/SettingsView', () => ({ default: () => <div data-testid="settings" /> }))
vi.mock('../../views/CodeReviewView', () => ({
  default: () => <div data-testid="code-review" />
}))
vi.mock('../../views/TaskWorkbenchView', () => ({
  default: () => <div data-testid="task-workbench" />
}))
vi.mock('../../views/GitTreeView', () => ({ default: () => <div data-testid="git" /> }))
vi.mock('../../views/PlannerView', () => ({ default: () => <div data-testid="planner" /> }))

import { resolveView } from '../view-resolver'
import type { View } from '../../stores/panelLayout'

describe('resolveView', () => {
  const viewKeys: View[] = [
    'dashboard',
    'agents',
    'ide',
    'sprint',
    'settings',
    'code-review',
    'task-workbench',
    'git',
    'planner'
  ]

  it.each(viewKeys)('returns a React node for "%s"', (viewKey) => {
    const node = resolveView(viewKey)
    expect(node).toBeDefined()
    expect(node).not.toBeNull()
  })

  it('returns all 9 view types', () => {
    for (const key of viewKeys) {
      const result = resolveView(key)
      expect(result).toBeTruthy()
    }
  })
})
