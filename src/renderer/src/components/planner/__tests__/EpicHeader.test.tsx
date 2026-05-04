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
  is_paused: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
}

describe('EpicHeader', () => {
  it('renders Ask AI button regardless of task count', () => {
    const onOpenAssistant = vi.fn()
    render(
      <EpicHeader
        group={mockEpic}
        isReady={false}
        isCompleted={false}
        doneCount={0}
        totalCount={0}
        onOpenAssistant={onOpenAssistant}
        onEdit={vi.fn()}
        onToggleReady={vi.fn()}
        onMarkCompleted={vi.fn()}
        onDelete={vi.fn()}
        onTogglePause={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /ask ai/i })).toBeInTheDocument()
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
        onTogglePause={vi.fn()}
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
        onTogglePause={vi.fn()}
      />
    )
    const fill = container.querySelector('.epic-detail__header-stripe-fill') as HTMLElement
    expect(fill).toBeInTheDocument()
    expect(fill.style.width).toBe('50%')
  })

  describe('pause/resume menu item', () => {
    it('shows "Pause Epic" in overflow menu when epic is not paused', async () => {
      render(
        <EpicHeader
          group={{ ...mockEpic, is_paused: false }}
          isReady={false}
          isCompleted={false}
          doneCount={0}
          totalCount={0}
          onOpenAssistant={vi.fn()}
          onEdit={vi.fn()}
          onToggleReady={vi.fn()}
          onMarkCompleted={vi.fn()}
          onDelete={vi.fn()}
          onTogglePause={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /more options/i }))
      expect(screen.getByRole('menuitem', { name: /pause epic/i })).toBeInTheDocument()
    })

    it('shows "Resume Epic" in overflow menu when epic is paused', async () => {
      render(
        <EpicHeader
          group={{ ...mockEpic, is_paused: true }}
          isReady={false}
          isCompleted={false}
          doneCount={0}
          totalCount={0}
          onOpenAssistant={vi.fn()}
          onEdit={vi.fn()}
          onToggleReady={vi.fn()}
          onMarkCompleted={vi.fn()}
          onDelete={vi.fn()}
          onTogglePause={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /more options/i }))
      expect(screen.getByRole('menuitem', { name: /resume epic/i })).toBeInTheDocument()
    })

    it('calls onTogglePause when pause menu item is clicked', async () => {
      const onTogglePause = vi.fn()
      render(
        <EpicHeader
          group={{ ...mockEpic, is_paused: false }}
          isReady={false}
          isCompleted={false}
          doneCount={0}
          totalCount={0}
          onOpenAssistant={vi.fn()}
          onEdit={vi.fn()}
          onToggleReady={vi.fn()}
          onMarkCompleted={vi.fn()}
          onDelete={vi.fn()}
          onTogglePause={onTogglePause}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /more options/i }))
      await userEvent.click(screen.getByRole('menuitem', { name: /pause epic/i }))
      expect(onTogglePause).toHaveBeenCalledOnce()
    })
  })
})
