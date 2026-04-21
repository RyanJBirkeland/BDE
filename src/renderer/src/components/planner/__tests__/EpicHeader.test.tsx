import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EpicHeader } from '../EpicHeader'

// Minimal valid TaskGroup
const mockEpic = {
  id: 'epic-1',
  name: 'Test Epic',
  goal: 'Test goal',
  status: 'draft' as const,
  icon: '📋',
  accent_color: '#4a9eff',
  task_ids: [],
  depends_on: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
}

describe('EpicHeader', () => {
  it('renders Ask AI button when totalCount > 0', () => {
    const onOpenAssistant = vi.fn()
    render(
      <EpicHeader
        group={mockEpic}
        isReady={false}
        isCompleted={false}
        doneCount={1}
        totalCount={3}
        onOpenAssistant={onOpenAssistant}
        onEdit={vi.fn()}
        onToggleReady={vi.fn()}
        onMarkCompleted={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /ask ai/i })).toBeInTheDocument()
  })

  it('does not render Ask AI button when totalCount is 0', () => {
    render(
      <EpicHeader
        group={mockEpic}
        isReady={false}
        isCompleted={false}
        doneCount={0}
        totalCount={0}
        onOpenAssistant={vi.fn()}
        onEdit={vi.fn()}
        onToggleReady={vi.fn()}
        onMarkCompleted={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /ask ai/i })).not.toBeInTheDocument()
  })

  it('calls onOpenAssistant when Ask AI button clicked', async () => {
    const onOpenAssistant = vi.fn()
    render(
      <EpicHeader
        group={mockEpic}
        isReady={false}
        isCompleted={false}
        doneCount={2}
        totalCount={5}
        onOpenAssistant={onOpenAssistant}
        onEdit={vi.fn()}
        onToggleReady={vi.fn()}
        onMarkCompleted={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /ask ai/i }))
    expect(onOpenAssistant).toHaveBeenCalledOnce()
  })

  it('renders progress stripe when totalCount > 0', () => {
    const { container } = render(
      <EpicHeader
        group={mockEpic}
        isReady={false}
        isCompleted={false}
        doneCount={2}
        totalCount={4}
        onOpenAssistant={vi.fn()}
        onEdit={vi.fn()}
        onToggleReady={vi.fn()}
        onMarkCompleted={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const fill = container.querySelector('.epic-detail__header-stripe-fill') as HTMLElement
    expect(fill).toBeInTheDocument()
    expect(fill.style.width).toBe('50%')
  })
})
