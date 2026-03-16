// Polling intervals (ms)
export const POLL_LOG_INTERVAL = 1_000
export const POLL_PROCESSES_INTERVAL = 5_000
export const POLL_AGENTS_INTERVAL = 10_000
export const POLL_SESSIONS_INTERVAL = 10_000
export const POLL_GIT_STATUS_INTERVAL = 30_000
export const POLL_SPRINT_INTERVAL = 30_000
export const POLL_PR_LIST_INTERVAL = 60_000

// Timeouts (ms)
export const GATEWAY_DISCONNECT_TOAST_DELAY = 4_000
export const KILL_UNDO_WINDOW = 5_000
export const SESSION_ACTIVE_THRESHOLD = 5 * 60 * 1000

// Pagination
export const CHAT_HISTORY_LIMIT = 100
export const AGENT_HISTORY_LIMIT = 20
export const AGENT_LIST_FETCH_LIMIT = 100
export const SPAWN_TASK_MAX_CHARS_SOFT = 2_000
export const SPAWN_TASK_MAX_CHARS_HARD = 4_000
export const SPAWN_TASK_HISTORY_LIMIT = 10

// UI
export const SIDEBAR_WIDTH_DEFAULT = 240
export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 400
export const CHAT_SCROLL_THRESHOLD = 80
export const CHAT_COLLAPSE_THRESHOLD = 600
