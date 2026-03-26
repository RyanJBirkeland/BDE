import { useState, useRef, useEffect } from 'react'
import {
  Bell,
  CheckCircle2,
  XCircle,
  GitMerge,
  GitPullRequestClosed,
  AlertTriangle
} from 'lucide-react'
import { useNotificationsStore, type NotificationType } from '../../stores/notifications'
import { timeAgo } from '../../lib/format'

const NOTIFICATION_ICONS: Record<
  NotificationType,
  React.FC<{ size: number; className?: string }>
> = {
  agent_completed: CheckCircle2,
  agent_failed: XCircle,
  pr_merged: GitMerge,
  pr_closed: GitPullRequestClosed,
  merge_conflict: AlertTriangle
}

const NOTIFICATION_COLORS: Record<NotificationType, string> = {
  agent_completed: 'notification-item--success',
  agent_failed: 'notification-item--error',
  pr_merged: 'notification-item--success',
  pr_closed: 'notification-item--muted',
  merge_conflict: 'notification-item--warning'
}

export function NotificationBell(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const notifications = useNotificationsStore((s) => s.notifications)
  const markAsRead = useNotificationsStore((s) => s.markAsRead)
  const markAllAsRead = useNotificationsStore((s) => s.markAllAsRead)
  const getUnreadCount = useNotificationsStore((s) => s.getUnreadCount)

  const unreadCount = getUnreadCount()

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

  const handleNotificationClick = (id: string, viewLink?: string): void => {
    markAsRead(id)
    if (viewLink) {
      // TODO: Navigate to viewLink
      // For now, just mark as read
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
            {unreadCount}
          </span>
        )}
      </button>

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

          <div className="notification-bell__list">
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
