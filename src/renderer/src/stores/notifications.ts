/**
 * Notifications store — persistent notification history center.
 * Tracks last 50 critical events (agent completed/failed, PR merged/closed, conflicts).
 * Powers the NotificationBell component in the title bar.
 */
import { create } from 'zustand'
import { nowIso } from '../../../shared/time'

export type NotificationType =
  | 'agent_completed'
  | 'agent_failed'
  | 'pr_merged'
  | 'pr_closed'
  | 'merge_conflict'
  | 'app_error'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  timestamp: string
  read: boolean
  viewLink?: string | undefined
}

interface AddNotificationInput {
  type: NotificationType
  title: string
  message: string
  viewLink?: string | undefined
}

const MAX_NOTIFICATIONS = 50
const STORAGE_KEY = 'bde:notifications'

interface NotificationsStore {
  notifications: Notification[]
  addNotification: (input: AddNotificationInput) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  getUnreadCount: () => number
  clearAll: () => void
}

export const selectUnreadCount = (state: NotificationsStore): number =>
  state.notifications.filter((n) => !n.read).length

let nextId = 0

// Load notifications from localStorage
function loadFromStorage(): Notification[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error('Failed to load notifications from localStorage:', err)
    return []
  }
}

// Save notifications to localStorage
function saveToStorage(notifications: Notification[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications))
  } catch (err) {
    console.error('Failed to save notifications to localStorage:', err)
  }
}

export const useNotificationsStore = create<NotificationsStore>((set, get) => ({
  notifications: loadFromStorage(),

  addNotification: (input): void => {
    const notification: Notification = {
      id: `notif-${++nextId}-${Date.now()}`,
      type: input.type,
      title: input.title,
      message: input.message,
      timestamp: nowIso(),
      read: false,
      viewLink: input.viewLink
    }

    set((state) => {
      const newNotifications = [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS)
      saveToStorage(newNotifications)
      return { notifications: newNotifications }
    })
  },

  markAsRead: (id): void => {
    set((state) => {
      const newNotifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      )
      saveToStorage(newNotifications)
      return { notifications: newNotifications }
    })
  },

  markAllAsRead: (): void => {
    set((state) => {
      const newNotifications = state.notifications.map((n) => ({ ...n, read: true }))
      saveToStorage(newNotifications)
      return { notifications: newNotifications }
    })
  },

  getUnreadCount: (): number => {
    return get().notifications.filter((n) => !n.read).length
  },

  clearAll: (): void => {
    set({ notifications: [] })
    saveToStorage([])
  }
}))
