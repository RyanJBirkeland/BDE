/**
 * Notifications store — persistent notification history center.
 * Tracks last 50 critical events (agent completed/failed, PR merged/closed, conflicts).
 * Powers the NotificationBell component in the title bar.
 */
import { create } from 'zustand'

export type NotificationType =
  | 'agent_completed'
  | 'agent_failed'
  | 'pr_merged'
  | 'pr_closed'
  | 'merge_conflict'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  timestamp: string
  read: boolean
  viewLink?: string
}

interface AddNotificationInput {
  type: NotificationType
  title: string
  message: string
  viewLink?: string
}

const MAX_NOTIFICATIONS = 50

interface NotificationsStore {
  notifications: Notification[]
  addNotification: (input: AddNotificationInput) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  getUnreadCount: () => number
  clearAll: () => void
}

let nextId = 0

export const useNotificationsStore = create<NotificationsStore>((set, get) => ({
  notifications: [],

  addNotification: (input): void => {
    const notification: Notification = {
      id: `notif-${++nextId}-${Date.now()}`,
      type: input.type,
      title: input.title,
      message: input.message,
      timestamp: new Date().toISOString(),
      read: false,
      viewLink: input.viewLink
    }

    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS)
    }))
  },

  markAsRead: (id): void => {
    set((state) => ({
      notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
    }))
  },

  markAllAsRead: (): void => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true }))
    }))
  },

  getUnreadCount: (): number => {
    return get().notifications.filter((n) => !n.read).length
  },

  clearAll: (): void => {
    set({ notifications: [] })
  }
}))
