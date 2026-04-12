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
import { pruneOldDiffSnapshots, DIFF_SNAPSHOT_RETENTION_DAYS } from './data/sprint-task-repository'
import { loadPlugins } from './services/plugin-loader'
import { startLoadSampler, stopLoadSampler } from './services/load-sampler'
import type { TaskTerminalService } from './services/task-terminal-service'
import type { DialogService } from './dialog-service'
import { BACKUP_INTERVAL_MS, PRUNE_CHANGES_DAYS } from './constants'

const logger = createLogger('bootstrap')

export const DEBOUNCE_MS = 500

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
 * Initialize database and run one-time migrations/imports.
 */
export function initializeDatabase(): void {
  getDb()

  // Ensure Claude Code has sensible default permissions for BDE agents
  import('./claude-settings-bootstrap')
    .then((m) => m.ensureClaudeSettings())
    .catch((err) => {
      logger.warn(`Failed to ensure Claude settings: ${getErrorMessage(err)}`)
    })

  // Run backup on startup and every 24 hours
  backupDatabase()
  const backupInterval = setInterval(backupDatabase, BACKUP_INTERVAL_MS)
  app.on('will-quit', () => clearInterval(backupInterval))

  // One-time async import from Supabase (no-op if local table already has rows or credentials missing)
  importSprintTasksFromSupabase(getDb()).catch((err) =>
    logger.warn(`Supabase import skipped: ${getErrorMessage(err)}`)
  )
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
    const db = getDb()
    const result = db.prepare("DELETE FROM sprint_tasks WHERE title LIKE 'Test task%'").run()
    if (result.changes > 0) {
      logger.info(`Cleaned ${result.changes} test task artifacts`)
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
        `connect-src 'self' ${connectSrc} http://localhost:* ws://localhost:*`
      : "default-src 'self'; " +
        "script-src 'self'; " +
        "worker-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        `connect-src 'self' ${connectSrc} https://api.github.com`

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}
