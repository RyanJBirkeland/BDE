/**
 * Bootstrap utilities extracted from index.ts — DB initialization, watchers, CSP, and periodic tasks.
 */
import { watch, existsSync, type FSWatcher } from 'fs'
import { app, BrowserWindow, session } from 'electron'
import { is } from '@electron-toolkit/utils'
import { BDE_DB_PATH } from './paths'
import { getDb, backupDatabase } from './db'
import { startPrPoller, stopPrPoller } from './pr-poller'
import { SprintPrPoller } from './sprint-pr-poller'
import { pollPrStatuses } from './github-pr-status'
import {
  listTasksWithOpenPrs,
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  updateTaskMergeableState
} from './services/sprint-service'
import { pruneOldEvents } from './data/event-queries'
import { pruneOldChanges } from './data/task-changes'
import { getEventRetentionDays } from './config'
import { createLogger } from './logger'
import { getErrorMessage } from '../shared/errors'
import {
  pruneOldDiffSnapshots,
  DIFF_SNAPSHOT_RETENTION_DAYS,
  cleanTestArtifacts
} from './data/sprint-maintenance-facade'
import { loadPlugins } from './services/plugin-loader'
import { startLoadSampler, stopLoadSampler } from './services/load-sampler'
import type { TaskTerminalService } from './services/task-terminal-service'
import type { DialogService } from './dialog-service'
import { BACKUP_INTERVAL_MS, PRUNE_CHANGES_DAYS } from './constants'
import { getSetting as _getRawSetting, setSetting as _setSetting } from './data/settings-queries'
import { getConfiguredRepos } from './paths'
import {
  SENSITIVE_SETTING_KEYS,
  ENCRYPTED_PREFIX,
  encryptSetting,
  isEncryptionAvailable
} from './secure-storage'
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
 * Marks errors that callers should drop on the floor when reporting startup
 * problems to the user (e.g. expected "credentials missing on a fresh install"
 * conditions). Throwers should construct this rather than relying on substring
 * matching downstream.
 */
export class ExpectedStartupCondition extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExpectedStartupCondition'
  }
}

function isReportableStartupFailure(err: unknown): boolean {
  return !(err instanceof ExpectedStartupCondition)
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
 * Scan sensitive settings for plaintext values (missing ENC: prefix) and re-encrypt them in place.
 * Runs once at startup so credentials stored before encryption was enforced are migrated
 * immediately rather than waiting for the lazy migration in getSetting().
 *
 * If safeStorage is unavailable (headless CI, locked keychain), we log a warning and skip —
 * the values remain readable so BDE continues to function.
 */
export function warnPlaintextSensitiveSettings(): void {
  if (!isEncryptionAvailable()) {
    logger.warn(
      'safeStorage unavailable — plaintext sensitive settings will not be re-encrypted at startup'
    )
    return
  }

  // Defer the safeStorage loop off the synchronous startup call stack so it
  // doesn't block the first event-loop tick (safeStorage IPC calls are
  // expensive and would delay renderer IPC responsiveness).
  setImmediate(() => {
    const db = getDb()
    const stillPlaintext: string[] = []

    for (const key of SENSITIVE_SETTING_KEYS) {
      const raw = _getRawSetting(db, key)
      if (raw === null || raw.startsWith(ENCRYPTED_PREFIX)) continue

      try {
        _setSetting(db, key, encryptSetting(raw))
        logger.info(`Re-encrypted "${key}" at startup`)
      } catch (err) {
        stillPlaintext.push(key)
        logger.warn(`Could not re-encrypt "${key}" at startup: ${getErrorMessage(err)}`)
      }
    }

    if (stillPlaintext.length > 0) {
      logger.warn(
        `Sensitive settings remain as plaintext: ${stillPlaintext.join(', ')}. ` +
          'Re-save each credential via Settings → Connections to encrypt it.'
      )
    }
  })
}

/**
 * Check each configured repo's localPath and queue a startup warning for any that don't exist.
 * Runs at startup so users see an actionable toast if paths differ on a new machine.
 */
export function validateRepoPaths(): void {
  const repos = getConfiguredRepos()
  for (const repo of repos) {
    if (repo.localPath && !existsSync(repo.localPath)) {
      startupErrors.push(
        `Repository "${repo.name}" path not found: ${repo.localPath}. ` +
          'Update the path in Settings → Repositories.'
      )
    }
  }
}

/**
 * Initialize database and run one-time migrations/imports.
 */
export function initializeDatabase(): void {
  getDb()

  // Warn about any sensitive settings that were stored as plaintext before encryption was enforced
  warnPlaintextSensitiveSettings()

  // Warn about configured repos whose local paths don't exist on this machine
  validateRepoPaths()

  // Ensure Claude Code has sensible default permissions for BDE agents
  import('./claude-settings-bootstrap')
    .then((m) => m.ensureClaudeSettings())
    .catch((err) => {
      const message = `Failed to ensure Claude settings: ${getErrorMessage(err)}`
      logger.warn(message)
      if (isReportableStartupFailure(err)) startupErrors.push(message)
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
  const pollerLogger = createLogger('sprint-pr-poller')
  const sprintPrPoller = new SprintPrPoller({
    listTasksWithOpenPrs,
    pollPrStatuses,
    markTaskDoneByPrNumber,
    markTaskCancelledByPrNumber,
    updateTaskMergeableState,
    onTaskTerminal: terminalDeps.onStatusTerminal,
    logger: pollerLogger
  })

  startPrPoller()
  sprintPrPoller.start()
  app.on('will-quit', () => {
    stopPrPoller()
    sprintPrPoller.stop()
  })
}

const DAILY_MS = 24 * 60 * 60 * 1000

interface PeriodicCleanupTask {
  name: string
  intervalMs: number
  run: () => void
}

/**
 * Schedule a periodic task plus its "will-quit" teardown in one step. The task
 * body is wrapped in try/catch so a transient failure doesn't abort the timer.
 */
function schedulePeriodic(task: PeriodicCleanupTask): void {
  const timer = setInterval(() => {
    try {
      task.run()
    } catch {
      /* non-fatal */
    }
  }, task.intervalMs)
  app.on('will-quit', () => clearInterval(timer))
}

function pruneEventsOnce(): void {
  pruneOldEvents(getDb(), getEventRetentionDays())
}

function pruneTaskChangesOnce(): void {
  const pruned = pruneOldChanges(PRUNE_CHANGES_DAYS)
  if (pruned > 0) logger.info(`Pruned ${pruned} old task change records`)
}

function pruneDiffSnapshotsOnce(): void {
  const pruned = pruneOldDiffSnapshots(DIFF_SNAPSHOT_RETENTION_DAYS)
  if (pruned > 0) {
    logger.info(
      `Cleared review_diff_snapshot on ${pruned} terminal tasks older than ${DIFF_SNAPSHOT_RETENTION_DAYS} days`
    )
  }
}

function cleanTestArtifactsOnce(): void {
  const cleaned = cleanTestArtifacts()
  if (cleaned > 0) logger.info(`Cleaned ${cleaned} test task artifacts`)
}

function runNonFatal(label: string, action: () => void): void {
  try {
    action()
  } catch (err) {
    logger.warn(`${label}: ${err}`)
  }
}

/**
 * Run initial cleanup tasks and schedule their periodic counterparts.
 *
 * Declarative: each cleanup task names its interval and body once; the
 * startup one-shot and the periodic timer both reuse the same body via
 * `schedulePeriodic`.
 */
export function setupCleanupTasks(): void {
  // One-shot sweeps at startup.
  pruneEventsOnce()
  runNonFatal('Failed to prune task changes', pruneTaskChangesOnce)
  runNonFatal('Failed to prune diff snapshots', pruneDiffSnapshotsOnce)
  runNonFatal('Failed to clean test artifacts', cleanTestArtifactsOnce)

  const periodicTasks: PeriodicCleanupTask[] = [
    { name: 'pruneEvents', intervalMs: DAILY_MS, run: pruneEventsOnce },
    { name: 'pruneTaskChanges', intervalMs: DAILY_MS, run: () => pruneOldChanges(30) },
    { name: 'pruneDiffSnapshots', intervalMs: DAILY_MS, run: pruneDiffSnapshotsOnce }
  ]
  for (const task of periodicTasks) schedulePeriodic(task)
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
