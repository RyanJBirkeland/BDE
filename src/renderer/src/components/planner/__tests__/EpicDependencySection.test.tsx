/**
 * Tests for EpicDependencySection component
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EpicDependencySection } from '../EpicDependencySection'
import type { TaskGroup } from '../../../../../shared/types'

describe('EpicDependencySection', () => {
  const mockGroup: TaskGroup = {
    id: 'epic-1',
    name: 'Epic One',
    icon: 'E',
    accent_color: '#00ff00',
    goal: 'Test epic',
    status: 'draft',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    depends_on: null
  }

  const mockUpstreamEpic: TaskGroup = {
    id: 'epic-2',
    name: 'Upstream Epic',
    icon: 'U',
    accent_color: '#ff0000',
    goal: 'Upstream test',
    status: 'ready',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    depends_on: null
  }

  const mockAllGroups: TaskGroup[] = [mockGroup, mockUpstreamEpic]

  const mockHandlers = {
    onAddDependency: vi.fn().mockResolvedValue(undefined),
    onRemoveDependency: vi.fn().mockResolvedValue(undefined),
    onUpdateCondition: vi.fn().mockResolvedValue(undefined)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty state when no dependencies', () => {
    render(<EpicDependencySection group={mockGroup} allGroups={mockAllGroups} {...mockHandlers} />)

    expect(
      screen.getByText(/No upstream epics. This epic's tasks can run as soon as they're queued/)
    ).toBeInTheDocument()
  })

  it('renders add button', () => {
    render(<EpicDependencySection group={mockGroup} allGroups={mockAllGroups} {...mockHandlers} />)

    expect(screen.getByRole('button', { name: /add epic dependency/i })).toBeInTheDocument()
  })

  it('opens modal when add button clicked', async () => {
    const user = userEvent.setup()
    render(<EpicDependencySection group={mockGroup} allGroups={mockAllGroups} {...mockHandlers} />)

    await user.click(screen.getByRole('button', { name: /add epic dependency/i }))

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /add epic dependency/i })).toBeInTheDocument()
    })
  })

  it('renders dependency rows when dependencies exist', () => {
    const groupWithDeps: TaskGroup = {
      ...mockGroup,
      depends_on: [{ id: 'epic-2', condition: 'on_success' }]
    }

    render(
      <EpicDependencySection group={groupWithDeps} allGroups={mockAllGroups} {...mockHandlers} />
    )

    expect(screen.getByText('Upstream Epic')).toBeInTheDocument()
    expect(screen.queryByText(/No upstream epics/)).not.toBeInTheDocument()
  })

  it('calls onRemoveDependency when remove button clicked', async () => {
    const user = userEvent.setup()
    const groupWithDeps: TaskGroup = {
      ...mockGroup,
      depends_on: [{ id: 'epic-2', condition: 'on_success' }]
    }

    render(
      <EpicDependencySection group={groupWithDeps} allGroups={mockAllGroups} {...mockHandlers} />
    )

    // Click remove button
    const removeButton = screen.getByRole('button', { name: /remove dependency on upstream epic/i })
    await user.click(removeButton)

    // Confirm in modal
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    const confirmButton = screen.getByRole('button', { name: /^remove$/i })
    await user.click(confirmButton)

    await waitFor(() => {
      expect(mockHandlers.onRemoveDependency).toHaveBeenCalledWith('epic-2')
    })
  })

  it('calls onUpdateCondition when condition select changes', async () => {
    const user = userEvent.setup()
    const groupWithDeps: TaskGroup = {
      ...mockGroup,
      depends_on: [{ id: 'epic-2', condition: 'on_success' }]
    }

    render(
      <EpicDependencySection group={groupWithDeps} allGroups={mockAllGroups} {...mockHandlers} />
    )

    const select = screen.getByRole('combobox', {
      name: /condition for dependency on upstream epic/i
    })
    await user.selectOptions(select, 'manual')

    await waitFor(() => {
      expect(mockHandlers.onUpdateCondition).toHaveBeenCalledWith('epic-2', 'manual')
    })
  })
})
