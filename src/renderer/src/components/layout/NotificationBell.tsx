import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Bell,
  CheckCircle2,
  XCircle,
  GitMerge,
  GitPullRequestClosed,
  AlertTriangle
} from 'lucide-react'
import {
  useNotificationsStore,
  selectUnreadCount,
  type NotificationType
} from '../../stores/notifications'
import './NotificationBell.css'
import { usePanelLayoutStore, type View } from '../../stores/panelLayout'
import { useSprintSelection } from '../../stores/sprintSelection'
import { useCodeReviewStore } from '../../stores/codeReview'
import { VIEW_LABELS } from '../../lib/view-registry'
import { timeAgo } from '../../lib/format'

const NOTIFICATION_ICONS: Record<
  NotificationType,
  React.FC<{ size: number; className?: string }>
> = {
  agent_completed: CheckCircle2,
  agent_failed: XCircle,
  pr_merged: GitMerge,
  pr_closed: GitPullRequestClosed,
  merge_conflict: AlertTriangle,
  app_error: XCircle
}

const NOTIFICATION_COLORS: Record<NotificationType, string> = {
  agent_completed: 'notification-item--success',
  agent_failed: 'notification-item--error',
  pr_merged: 'notification-item--success',
  pr_closed: 'notification-item--muted',
  merge_conflict: 'notification-item--warning',
  app_error: 'notification-item--error'
}

export function NotificationBell(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const markReadTimerRef = useRef<number | null>(null)

  const notifications = useNotificationsStore((s) => s.notifications)
  const markAsRead = useNotificationsStore((s) => s.markAsRead)
  const markAllAsRead = useNotificationsStore((s) => s.markAllAsRead)
  const unreadCount = useNotificationsStore(selectUnreadCount)
  const setView = usePanelLayoutStore((s) => s.setView)
  const setSelectedTaskId = useSprintSelection((s) => s.setSelectedTaskId)
  const selectCodeReviewTask = useCodeReviewStore((s) => s.selectTask)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent): void => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Auto-focus first notification when dropdown opens
  useEffect(() => {
    if (isOpen && listRef.current && notifications.length > 0) {
      const firstItem = listRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]')
      firstItem?.focus()
    }
  }, [isOpen, notifications.length])

  // Auto-mark-read after 1.5s when dropdown is open
  useEffect(() => {
    if (isOpen && unreadCount > 0) {
      markReadTimerRef.current = window.setTimeout(() => {
        markAllAsRead()
      }, 1500)
    }

    return () => {
      if (markReadTimerRef.current) {
        clearTimeout(markReadTimerRef.current)
        markReadTimerRef.current = null
      }
    }
  }, [isOpen, unreadCount, markAllAsRead])

  // Keyboard navigation for dropdown
  const handleListKeyDown = useCallback((e: React.KeyboardEvent) => {
    const list = listRef.current
    if (!list) return
    const items = Array.from(list.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    const currentIndex = items.indexOf(e.target as HTMLElement)

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0
        items[next]?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1
        items[prev]?.focus()
        break
      }
      case 'Enter':
      case ' ':
        e.preventDefault()
        ;(e.target as HTMLElement).click()
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        buttonRef.current?.focus()
        break
    }
  }, [])

  const handleNotificationClick = (id: string, viewLink?: string): void => {
    markAsRead(id)
    if (viewLink) {
      if (viewLink.startsWith('http')) {
        window.open(viewLink, '_blank')
      } else {
        // Internal path like '/sprint/task-id' or '/code-review/task-id'
        const segments = viewLink.replace(/^\//, '').split('/')
        const viewName = segments[0]
        const taskId = segments[1]

        // Validate viewName against known views before casting to View type
        if (viewName && viewName in VIEW_LABELS) {
          setView(viewName as View)

          // Select task in appropriate store based on view type
          if (taskId) {
            if (viewName === 'sprint') {
              setSelectedTaskId(taskId)
            } else if (viewName === 'code-review') {
              selectCodeReviewTask(taskId)
            }
          }

          setIsOpen(false)
        }
      }
    }
  }

  const handleToggle = (): void => {
    setIsOpen((prev) => !prev)
  }

  const handleMarkAllAsRead = (): void => {
    markAllAsRead()
  }

  return (
    <div className="notification-bell">
      <button
        ref={buttonRef}
        className="bde-btn bde-btn--icon bde-btn--sm notification-bell__button"
        onClick={handleToggle}
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span
            className="notification-bell__badge"
            aria-label={`${unreadCount} unread notifications`}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Screen reader announcements */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {unreadCount > 0 && `${unreadCount} unread notifications`}
      </div>

      {isOpen && (
        <div ref={dropdownRef} className="notification-bell__dropdown glass-modal elevation-3">
          <div className="notification-bell__header">
            <h3 className="notification-bell__title">Notifications</h3>
            {unreadCount > 0 && (
              <button className="bde-btn bde-btn--ghost bde-btn--sm" onClick={handleMarkAllAsRead}>
                Mark all as read
              </button>
            )}
          </div>

          <div
            ref={listRef}
            role="menu"
            aria-label="Notifications"
            className="notification-bell__list"
            onKeyDown={handleListKeyDown}
          >
            {notifications.length === 0 ? (
              <div className="notification-bell__empty">
                <Bell size={32} />
                <p>No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => {
                const Icon = NOTIFICATION_ICONS[notification.type]
                const colorClass = NOTIFICATION_COLORS[notification.type]

                return (
                  <button
                    key={notification.id}
                    role="menuitem"
                    tabIndex={-1}
                    className={`notification-item ${colorClass} ${
                      notification.read ? 'notification-item--read' : ''
                    }`}
                    onClick={() => handleNotificationClick(notification.id, notification.viewLink)}
                  >
                    <div className="notification-item__icon">
                      <Icon size={16} />
                    </div>
                    <div className="notification-item__content">
                      <div className="notification-item__title">{notification.title}</div>
                      <div className="notification-item__message">{notification.message}</div>
                      <div className="notification-item__time">
                        {timeAgo(notification.timestamp)}
                      </div>
                    </div>
                    {!notification.read && <div className="notification-item__unread-dot" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
