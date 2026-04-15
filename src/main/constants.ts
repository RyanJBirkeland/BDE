/**
 * Main process constants
 */

/** Database backup interval (24 hours) */
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Days to retain task change history before pruning */
export const PRUNE_CHANGES_DAYS = 30

/** Max chars for tool_result summary in agent events */
export const TOOL_RESULT_SUMMARY_MAX_CHARS = 200

/** Stuck-task threshold for health check (1 hour) */
export const STUCK_TASK_THRESHOLD_MS = 3_600_000

/** Cursor position poll interval for cross-window drag */
export const CURSOR_POLL_INTERVAL_MS = 64

/** Timeout for cross-window drag detection */
export const CROSS_WINDOW_DRAG_TIMEOUT_MS = 10_000

/** Webhook HTTP request timeout */
export const WEBHOOK_TIMEOUT_MS = 10_000
