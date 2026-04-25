import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationBell } from '../NotificationBell'
import { useNotificationsStore } from '../../../stores/notifications'
import { usePanelLayoutStore } from '../../../stores/panelLayout'

describe('NotificationBell', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: [] })
  })

  it('renders bell icon', () => {
    render(<NotificationBell />)
    const button = screen.getByRole('button', { name: /notifications/i })
    expect(button).toBeInTheDocument()
  })

  it('shows unread count badge when there are unread notifications', () => {
    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'Agent done',
      message: 'Task completed'
    })
    useNotificationsStore.getState().addNotification({
      type: 'pr_merged',
      title: 'PR merged',
      message: 'PR was merged'
    })

    render(<NotificationBell />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('does not show badge when all notifications are read', () => {
    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'Agent done',
      message: 'Task completed'
    })
    useNotificationsStore.getState().markAllAsRead()

    render(<NotificationBell />)
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('opens dropdown panel when bell is clicked', async () => {
    const user = userEvent.setup()
    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'Agent completed',
      message: 'Task done successfully'
    })

    render(<NotificationBell />)
    const button = screen.getByRole('button', { name: /notifications/i })
    await user.click(button)

    expect(screen.getByText('Agent completed')).toBeInTheDocument()
    expect(screen.getByText('Task done successfully')).toBeInTheDocument()
  })

  it('closes dropdown when bell is clicked again', async () => {
    const user = userEvent.setup()
    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'Agent completed',
      message: 'Task done'
    })

    render(<NotificationBell />)
    const button = screen.getByRole('button', { name: /notifications/i })

    // Open
    await user.click(button)
    expect(screen.getByText('Agent completed')).toBeInTheDocument()

    // Close
    await user.click(button)
    expect(screen.queryByText('Agent completed')).not.toBeInTheDocument()
  })

  it('shows empty state when no notifications', async () => {
    const user = userEvent.setup()
    render(<NotificationBell />)
    const button = screen.getByRole('button', { name: /notifications/i })
    await user.click(button)

    expect(screen.getByText(/no notifications/i)).toBeInTheDocument()
  })

  it('marks notification as read when clicked', async () => {
    const user = userEvent.setup()
    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'Agent completed',
      message: 'Task done'
    })

    render(<NotificationBell />)
    const button = screen.getByRole('button', { name: /^notifications$/i })
    await user.click(button)

    const notification = screen.getByRole('menuitem', { name: /agent completed/i })
    expect(notification).toBeInTheDocument()
    await user.click(notification)

    // Badge should be gone (no more unread)
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('shows "Mark all as read" button when there are unread notifications', async () => {
    const user = userEvent.setup()
    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'First',
      message: 'First message'
    })
    useNotificationsStore.getState().addNotification({
      type: 'pr_merged',
      title: 'Second',
      message: 'Second message'
    })

    render(<NotificationBell />)
    const button = screen.getByRole('button', { name: /notifications/i })
    await user.click(button)

    const markAllButton = screen.getByRole('button', { name: /mark all as read/i })
    expect(markAllButton).toBeInTheDocument()

    await user.click(markAllButton)

    // Badge should be gone
    expect(screen.queryByText('2')).not.toBeInTheDocument()
  })

  it('clears a single notification when its X button is clicked', async () => {
    const user = userEvent.setup()
    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'Keep me',
      message: 'Stay'
    })
    useNotificationsStore.getState().addNotification({
      type: 'agent_failed',
      title: 'Remove me',
      message: 'Goodbye'
    })

    render(<NotificationBell />)
    await user.click(screen.getByRole('button', { name: /^notifications$/i }))

    const clearButton = screen.getByRole('button', { name: /clear notification: remove me/i })
    await user.click(clearButton)

    expect(screen.queryByText('Remove me')).not.toBeInTheDocument()
    expect(screen.getByText('Keep me')).toBeInTheDocument()
  })

  it('does not navigate when the per-item clear button is clicked', async () => {
    const user = userEvent.setup()
    const setView = vi.fn()
    usePanelLayoutStore.setState({ setView })

    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'Task done',
      message: 'Completed',
      viewLink: '/sprint/task-123'
    })

    render(<NotificationBell />)
    await user.click(screen.getByRole('button', { name: /^notifications$/i }))
    await user.click(screen.getByRole('button', { name: /clear notification: task done/i }))

    expect(setView).not.toHaveBeenCalled()
    expect(screen.queryByText('Task done')).not.toBeInTheDocument()
  })

  it('clears every notification when "Clear all" is clicked', async () => {
    const user = userEvent.setup()
    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'First',
      message: 'First message'
    })
    useNotificationsStore.getState().addNotification({
      type: 'pr_merged',
      title: 'Second',
      message: 'Second message'
    })

    render(<NotificationBell />)
    await user.click(screen.getByRole('button', { name: /^notifications$/i }))

    await user.click(screen.getByRole('button', { name: /clear all/i }))

    expect(screen.queryByText('First')).not.toBeInTheDocument()
    expect(screen.queryByText('Second')).not.toBeInTheDocument()
    expect(screen.getByText(/no notifications/i)).toBeInTheDocument()
  })

  it('does not show "Clear all" button when there are no notifications', async () => {
    const user = userEvent.setup()
    render(<NotificationBell />)
    await user.click(screen.getByRole('button', { name: /^notifications$/i }))

    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()
  })

  it('does not show "Mark all as read" button when all are read', async () => {
    const user = userEvent.setup()
    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'First',
      message: 'First message'
    })
    useNotificationsStore.getState().markAllAsRead()

    render(<NotificationBell />)
    const button = screen.getByRole('button', { name: /notifications/i })
    await user.click(button)

    expect(screen.queryByRole('button', { name: /mark all as read/i })).not.toBeInTheDocument()
  })

  it('shows relative timestamps', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const notification = {
      id: 'test-1',
      type: 'agent_completed' as const,
      title: 'Test',
      message: 'Test message',
      timestamp: new Date(now.getTime() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
      read: false
    }

    useNotificationsStore.setState({ notifications: [notification] })

    render(<NotificationBell />)
    const button = screen.getByRole('button', { name: /notifications/i })
    await user.click(button)

    // Should show something like "5 minutes ago" or "5m ago"
    expect(screen.getByText(/ago/i)).toBeInTheDocument()
  })

  it('displays different icons for different notification types', async () => {
    const user = userEvent.setup()
    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'Completed',
      message: 'Done'
    })
    useNotificationsStore.getState().addNotification({
      type: 'agent_failed',
      title: 'Failed',
      message: 'Error'
    })
    useNotificationsStore.getState().addNotification({
      type: 'pr_merged',
      title: 'Merged',
      message: 'PR merged'
    })

    render(<NotificationBell />)
    const button = screen.getByRole('button', { name: /notifications/i })
    await user.click(button)

    // All three should be visible
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Merged')).toBeInTheDocument()
  })

  it('navigates to internal view when notification with path viewLink is clicked', async () => {
    const user = userEvent.setup()
    const setView = vi.fn()
    usePanelLayoutStore.setState({ setView })

    useNotificationsStore.getState().addNotification({
      type: 'agent_completed',
      title: 'Task done',
      message: 'Completed',
      viewLink: '/sprint/task-123'
    })

    render(<NotificationBell />)
    await user.click(screen.getByRole('button', { name: /^notifications$/i }))
    await user.click(screen.getByRole('menuitem', { name: /task done/i }))

    expect(setView).toHaveBeenCalledWith('sprint')
  })

  it('opens external URL in new tab when notification has http viewLink', async () => {
    const user = userEvent.setup()
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    useNotificationsStore.getState().addNotification({
      type: 'pr_merged',
      title: 'PR merged',
      message: 'Merged',
      viewLink: 'https://github.com/org/repo/pull/42'
    })

    render(<NotificationBell />)
    await user.click(screen.getByRole('button', { name: /^notifications$/i }))
    await user.click(screen.getByRole('menuitem', { name: /pr merged/i }))

    expect(windowOpenSpy).toHaveBeenCalledWith('https://github.com/org/repo/pull/42', '_blank')
    windowOpenSpy.mockRestore()
  })
})
