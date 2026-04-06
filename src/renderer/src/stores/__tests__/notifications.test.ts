import { describe, it, expect, beforeEach } from 'vitest'
import { useNotificationsStore } from '../notifications'

describe('notifications store', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: [] })
  })

  it('starts with empty notifications', () => {
    const state = useNotificationsStore.getState()
    expect(state.notifications).toEqual([])
  })

  it('addNotification adds a notification with auto-generated ID and timestamp', () => {
    const { addNotification } = useNotificationsStore.getState()
    addNotification({
      type: 'agent_completed',
      title: 'Agent finished',
      message: 'Task completed successfully'
    })
    const notifications = useNotificationsStore.getState().notifications
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      type: 'agent_completed',
      title: 'Agent finished',
      message: 'Task completed successfully',
      read: false
    })
    expect(notifications[0].id).toBeDefined()
    expect(notifications[0].timestamp).toBeDefined()
  })

  it('addNotification prepends new notifications (newest first)', () => {
    const { addNotification } = useNotificationsStore.getState()
    addNotification({ type: 'agent_completed', title: 'First', message: 'First message' })
    addNotification({ type: 'pr_merged', title: 'Second', message: 'Second message' })
    const notifications = useNotificationsStore.getState().notifications
    expect(notifications[0].title).toBe('Second')
    expect(notifications[1].title).toBe('First')
  })

  it('addNotification includes optional viewLink', () => {
    const { addNotification } = useNotificationsStore.getState()
    addNotification({
      type: 'agent_completed',
      title: 'Done',
      message: 'Task done',
      viewLink: '/sprint/task-123'
    })
    const notifications = useNotificationsStore.getState().notifications
    expect(notifications[0].viewLink).toBe('/sprint/task-123')
  })

  it('caps at MAX_NOTIFICATIONS (50)', () => {
    const { addNotification } = useNotificationsStore.getState()
    // Add 55 notifications
    for (let i = 0; i < 55; i++) {
      addNotification({
        type: 'agent_completed',
        title: `Notification ${i}`,
        message: `Message ${i}`
      })
    }
    const notifications = useNotificationsStore.getState().notifications
    expect(notifications).toHaveLength(50)
    // Newest should be first
    expect(notifications[0].title).toBe('Notification 54')
    // Oldest retained should be notification 5 (notifications 0-4 were evicted)
    expect(notifications[49].title).toBe('Notification 5')
  })

  it('markAsRead marks a notification as read', () => {
    const { addNotification, markAsRead } = useNotificationsStore.getState()
    addNotification({ type: 'agent_completed', title: 'First', message: 'Message' })
    const id = useNotificationsStore.getState().notifications[0].id
    markAsRead(id)
    const notifications = useNotificationsStore.getState().notifications
    expect(notifications[0].read).toBe(true)
  })

  it('markAsRead does nothing for non-existent ID', () => {
    const { addNotification, markAsRead } = useNotificationsStore.getState()
    addNotification({ type: 'agent_completed', title: 'First', message: 'Message' })
    markAsRead('non-existent-id')
    const notifications = useNotificationsStore.getState().notifications
    expect(notifications[0].read).toBe(false)
  })

  it('markAllAsRead marks all notifications as read', () => {
    const { addNotification, markAllAsRead } = useNotificationsStore.getState()
    addNotification({ type: 'agent_completed', title: 'First', message: 'Message 1' })
    addNotification({ type: 'pr_merged', title: 'Second', message: 'Message 2' })
    addNotification({ type: 'agent_failed', title: 'Third', message: 'Message 3' })
    markAllAsRead()
    const notifications = useNotificationsStore.getState().notifications
    expect(notifications.every((n) => n.read)).toBe(true)
  })

  it('getUnreadCount returns correct count', () => {
    const { addNotification, markAsRead } = useNotificationsStore.getState()
    addNotification({ type: 'agent_completed', title: 'First', message: 'Message 1' })
    addNotification({ type: 'pr_merged', title: 'Second', message: 'Message 2' })
    addNotification({ type: 'agent_failed', title: 'Third', message: 'Message 3' })

    let unreadCount = useNotificationsStore.getState().getUnreadCount()
    expect(unreadCount).toBe(3)

    const firstId = useNotificationsStore.getState().notifications[0].id
    markAsRead(firstId)
    unreadCount = useNotificationsStore.getState().getUnreadCount()
    expect(unreadCount).toBe(2)
  })

  it('clearAll removes all notifications', () => {
    const { addNotification, clearAll } = useNotificationsStore.getState()
    addNotification({ type: 'agent_completed', title: 'First', message: 'Message 1' })
    addNotification({ type: 'pr_merged', title: 'Second', message: 'Message 2' })
    clearAll()
    const notifications = useNotificationsStore.getState().notifications
    expect(notifications).toHaveLength(0)
  })

  it('persists notifications to localStorage', () => {
    const { addNotification } = useNotificationsStore.getState()
    addNotification({ type: 'agent_completed', title: 'Persist Test', message: 'msg' })
    const stored = localStorage.getItem('bde:notifications')
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].title).toBe('Persist Test')
  })

  it('clearAll also clears localStorage', () => {
    const { addNotification, clearAll } = useNotificationsStore.getState()
    addNotification({ type: 'agent_completed', title: 'Test', message: 'msg' })
    clearAll()
    const stored = localStorage.getItem('bde:notifications')
    expect(stored).toBe('[]')
  })

  it('handles different notification types', () => {
    const { addNotification } = useNotificationsStore.getState()
    addNotification({ type: 'agent_completed', title: 'Completed', message: 'Done' })
    addNotification({ type: 'agent_failed', title: 'Failed', message: 'Error' })
    addNotification({ type: 'pr_merged', title: 'Merged', message: 'PR merged' })
    addNotification({ type: 'pr_closed', title: 'Closed', message: 'PR closed' })
    addNotification({ type: 'merge_conflict', title: 'Conflict', message: 'Merge conflict' })

    const notifications = useNotificationsStore.getState().notifications
    expect(notifications).toHaveLength(5)
    expect(notifications.map((n) => n.type)).toEqual([
      'merge_conflict',
      'pr_closed',
      'pr_merged',
      'agent_failed',
      'agent_completed'
    ])
  })
})
