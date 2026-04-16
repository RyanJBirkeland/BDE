/**
 * Bootstrap utilities extracted from index.ts — DB initialization, watchers, CSP, and periodic tasks.
 */
import { watch, type FSWatcher } from 'fs'
import { app, BrowserWindow, session } from 'electron'
import { is } from '@electron-toolkit/utils'
import { BDE_DB_PATH } from './paths'
import { getDb, backupDatabase } from './db'
import { importSprintTasksFromSupabase } from './data/supabase-import'
import { startPrPoller, stopPrPoller } from './pr-poller'
import { startSprintPrPoller, stopSprintPrPoller } from './sprint-pr-poller'
import { pruneOldEvents } from './data/event-queries'
import { pruneOldChanges } from './data/task-changes'
import { getEventRetentionDays } from './config'
import { createLogger } from './logger'
import { getErrorMessage } from '../shared/errors'
import { pruneOldDiffSnapshots, DIFF_SNAPSHOT_RETENTION_DAYS, cleanTestArtifacts } from './data/sprint-maintenance-facade'
import { loadPlugins } from './services/plugin-loader'
import { startLoadSampler, stopLoadSampler } from './services/load-sampler'
import type { TaskTerminalService } from './services/task-terminal-service'
import type { DialogService } from './dialog-service'
import { BACKUP_INTERVAL_MS, PRUNE_CHANGES_DAYS } from './constants'
import { getSetting as _getRawSetting } from './data/settings-queries'
import { SENSITIVE_SETTING_KEYS, ENCRYPTED_PREFIX } from './secure-storage'
import { broadcast } from './broadcast'

const logger = createLogger('bootstrap')

export const DEBOUNCE_MS = 500

/**
 * Non-trivial errors that occurred during async startup operations.
 * Populated by fire-and-forget tasks whose failures are otherwise invisible to the user.
 * Cleared after emission so repeated calls to emitStartupWarnings are safe.
 */
const startupErrors: string[] = []

/**
 * Returns true for errors that indicate a genuine problem (filesystem, permissions, etc.)
 * rather than expected conditions like missing credentials on a fresh install.
 */
function isNonTrivialError(message: string): boolean {
  const trivialPatterns = [
    'credentials not configured',
    'credentials missing',
    'no credentials',
    'not configured',
    'already has',
    'skipping',
    'no rows',
  ]
  const lowered = message.toLowerCase()
  return !trivialPatterns.some((pattern) => lowered.includes(pattern))
}

/**
 * Broadcasts any accumulated startup errors to the renderer via manager:warning.
 * Safe to call multiple times — clears the array after emission.
 * Should be called once the main window is ready to receive IPC events.
 */
export function emitStartupWarnings(): void {
  if (startupErrors.length === 0) return
  for (const message of startupErrors) {
    broadcast('manager:warning', { message })
  }
  startupErrors.length = 0
}

export function startDbWatcher(): () => void {
  const dbPath = BDE_DB_PATH
  const walPath = dbPath + '-wal'
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const notify = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('sprint:externalChange')
      }
    }, DEBOUNCE_MS)
  }

  const watchers: FSWatcher[] = []

  for (const path of [dbPath, walPath]) {
    try {
      watchers.push(watch(path, notify))
    } catch {
      // File may not exist yet — task runner creates it on first write
    }
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    for (const w of watchers) w.close()
  }
}

export function buildConnectSrc(): string {
  return 'https://api.github.com'
}

/**
 * Scan sensitive settings for plaintext values (missing ENC: prefix) and warn.
 * Runs once at startup to surface credentials that were stored before encryption was enforced.
 */
export function warnPlaintextSensitiveSettings(): void {
  const db = getDb()
  const plaintextKeys: string[] = []

  for (const key of SENSITIVE_SETTING_KEYS) {
    const raw = _getRawSetting(db, key)
    if (raw !== null && !raw.startsWith(ENCRYPTED_PREFIX)) {
      plaintextKeys.push(key)
    }
  }

  if (plaintextKeys.length > 0) {
    logger.warn(
      `Sensitive settings stored as plaintext (missing ${ENCRYPTED_PREFIX} prefix): ${plaintextKeys.join(', ')}. ` +
        'These values are unencrypted in SQLite. Re-save each credential via Settings to encrypt it.'
    )
  }
}

/**
 * Initialize database and run one-time migrations/imports.
 */
export function initializeDatabase(): void {
  getDb()

  // Warn about any sensitive settings that were stored as plaintext before encryption was enforced
  warnPlaintextSensitiveSettings()

  // Ensure Claude Code has sensible default permissions for BDE agents
  import('./claude-settings-bootstrap')
    .then((m) => m.ensureClaudeSettings())
    .catch((err) => {
      const message = `Failed to ensure Claude settings: ${getErrorMessage(err)}`
      logger.warn(message)
      if (isNonTrivialError(message)) {
        startupErrors.push(message)
      }
    })

  // Run backup on startup and every 24 hours.
  // Backup failure (disk full, bad permissions) must not abort startup with a misleading
  // "Database Migration Failed" dialog — it is non-fatal.
  try {
    backupDatabase()
  } catch (err) {
    logger.warn(`Startup backup failed (non-fatal): ${getErrorMessage(err)}`)
  }
  const safeBackup = (): void => {
    try {
      backupDatabase()
    } catch (err) {
      logger.warn(`Scheduled backup failed (non-fatal): ${getErrorMessage(err)}`)
    }
  }
  const backupInterval = setInterval(safeBackup, BACKUP_INTERVAL_MS)
  app.on('will-quit', () => clearInterval(backupInterval))

  // One-time async import from Supabase (no-op if local table already has rows or credentials missing)
  importSprintTasksFromSupabase(getDb()).catch((err) => {
    const message = `Supabase import failed: ${getErrorMessage(err)}`
    logger.warn(message)
    if (isNonTrivialError(message)) {
      // This may resolve after the window is ready — emit directly rather than relying on
      // emitStartupWarnings() which is called at window load time.
      broadcast('manager:warning', { message })
    }
  })
}

/**
 * Start background services — load sampler, plugins.
 */
export function startBackgroundServices(): void {
  loadPlugins()

  startLoadSampler()
  app.on('will-quit', stopLoadSampler)
}

/**
 * Start PR pollers for GitHub integration.
 */
export function startPrPollers(terminalDeps: {
  onStatusTerminal: TaskTerminalService['onStatusTerminal']
  dialog: DialogService
}): void {
  startPrPoller()
  app.on('will-quit', stopPrPoller)

  startSprintPrPoller(terminalDeps)
  app.on('will-quit', stopSprintPrPoller)
}

/**
 * Run initial cleanup tasks and schedule periodic cleanup.
 */
export function setupCleanupTasks(): void {
  // Prune old agent events on startup
  pruneOldEvents(getDb(), getEventRetentionDays())

  // Prune agent_events periodically (every 24 hours)
  const pruneEventsInterval = setInterval(
    () => {
      try {
        pruneOldEvents(getDb(), getEventRetentionDays())
      } catch {
        /* non-fatal */
      }
    },
    24 * 60 * 60 * 1000
  )
  app.on('will-quit', () => clearInterval(pruneEventsInterval))

  // Prune old audit trail records (non-fatal)
  try {
    const pruned = pruneOldChanges(PRUNE_CHANGES_DAYS)
    if (pruned > 0) logger.info(`Pruned ${pruned} old task change records`)
  } catch (err) {
    logger.warn(`Failed to prune task changes: ${err}`)
  }

  // Null out review_diff_snapshot blobs on long-completed tasks (non-fatal).
  // Snapshots can be ~500KB each — without this, the DB grows unbounded.
  try {
    const pruned = pruneOldDiffSnapshots(DIFF_SNAPSHOT_RETENTION_DAYS)
    if (pruned > 0)
      logger.info(
        `Cleared review_diff_snapshot on ${pruned} terminal tasks older than ${DIFF_SNAPSHOT_RETENTION_DAYS} days`
      )
  } catch (err) {
    logger.warn(`Failed to prune diff snapshots: ${err}`)
  }

  // Clean up test task artifacts (agents running tests create "Test task" records)
  try {
    const cleaned = cleanTestArtifacts()
    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} test task artifacts`)
    }
  } catch {
    /* non-fatal */
  }

  // Prune task_changes periodically (every 24 hours)
  const pruneTakeChangesInterval = setInterval(
    () => {
      try {
        pruneOldChanges(30)
      } catch {
        /* non-fatal */
      }
    },
    24 * 60 * 60 * 1000
  )
  app.on('will-quit', () => clearInterval(pruneTakeChangesInterval))

  // Prune review_diff_snapshot periodically (every 24 hours)
  const pruneDiffSnapshotsInterval = setInterval(
    () => {
      try {
        const cleared = pruneOldDiffSnapshots(DIFF_SNAPSHOT_RETENTION_DAYS)
        if (cleared > 0) logger.info(`Cleared review_diff_snapshot on ${cleared} terminal tasks`)
      } catch {
        /* non-fatal */
      }
    },
    24 * 60 * 60 * 1000
  )
  app.on('will-quit', () => clearInterval(pruneDiffSnapshotsInterval))
}

/**
 * Configure Content Security Policy for dev and production.
 */
export function setupCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const connectSrc = buildConnectSrc()

    const csp = is.dev
      ? "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
        "worker-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        `connect-src 'self' ${connectSrc} http://localhost:* ws://localhost:*; ` +
        "frame-ancestors 'none'; " +
        "form-action 'self'"
      : "default-src 'self'; " +
        "script-src 'self'; " +
        "worker-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        `connect-src 'self' ${connectSrc} https://api.github.com; ` +
        "frame-ancestors 'none'; " +
        "form-action 'self'"

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}
