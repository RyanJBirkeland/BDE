import { appendFile, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { stat, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { nowIso } from '../shared/time'

const BDE_DIR = join(homedir(), '.bde')
const LOG_PATH = join(BDE_DIR, 'bde.log')
const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * Mirror logger output to stdout/stderr only in development. In packaged
 * production builds console writes duplicate every file write (~397 per
 * startup) with no visible benefit — the user cannot see them, and
 * `~/.bde/bde.log` remains the authoritative source. `BDE_CONSOLE_LOG=1`
 * re-enables mirroring for targeted debugging of packaged builds.
 */
const CONSOLE_LOG_ENABLED =
  process.env.NODE_ENV !== 'production' || process.env.BDE_CONSOLE_LOG === '1'

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
  debug(msg: string): void
  event(name: string, fields: Record<string, unknown>): void
}

function ensureLogDir(): void {
  if (!existsSync(BDE_DIR)) {
    mkdirSync(BDE_DIR, { recursive: true, mode: 0o700 })
  }
  // Enforce restrictive permissions on the .bde directory on every startup.
  // mkdirSync mode is only respected on creation — chmod fixes existing installs
  // that were created without the mode parameter.
  try {
    chmodSync(BDE_DIR, 0o700)
  } catch (err) {
    // Non-fatal: log but continue — app can still function
    console.warn('[logger] Failed to enforce .bde directory permissions:', err)
  }
  // Tighten the log file permissions too. bde.log contains agent prompts,
  // task specs, and SDK errors that may echo tokens; under the default
  // umask it is world-readable (0644). Apply 0600 every startup and ignore
  // "file not found" — the first appendFileSync will create it with 0600.
  try {
    chmodSync(LOG_PATH, 0o600)
  } catch {
    /* file may not exist yet — that's fine */
  }
}

let _rotating = false

async function rotateIfNeededAsync(): Promise<void> {
  if (_rotating) return
  _rotating = true
  try {
    const stats = await stat(LOG_PATH)
    if (stats.size > MAX_LOG_SIZE) {
      const old1 = LOG_PATH + '.old'
      const old2 = LOG_PATH + '.old.2'
      const old3 = LOG_PATH + '.old.3'
      await rm(old3).catch(() => {})
      await rename(old2, old3).catch(() => {})
      await rename(old1, old2).catch(() => {})
      await rename(LOG_PATH, old1)
    }
  } catch {
    // File doesn't exist yet — fine
  } finally {
    _rotating = false
  }
}

let writeCount = 0
const ROTATION_CHECK_INTERVAL = 1000 // check every 1000 writes

function scheduleRotationCheck(): void {
  if (++writeCount >= ROTATION_CHECK_INTERVAL) {
    writeCount = 0
    void rotateIfNeededAsync()
  }
}

function fileEvent(name: string, eventName: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: nowIso(), level: 'INFO', module: name, event: eventName, ...fields })
  // Fire-and-forget: appendFile is non-blocking so the main thread never stalls
  // on disk I/O. Log ordering is preserved by libuv's sequential I/O queue.
  appendFile(LOG_PATH, line + '\n', { mode: 0o600 }, () => {})
  scheduleRotationCheck()
}

function fileLog(level: string, name: string, msg: string): void {
  // The `mode` option only applies when the file is newly created — existing
  // installs are covered by the chmod in ensureLogDir.
  appendFile(LOG_PATH, `${nowIso()} [${level}] [${name}] ${msg}\n`, { mode: 0o600 }, () => {})
  scheduleRotationCheck()
}

/** Create a named logger that writes to ~/.bde/bde.log */
export function createLogger(name: string): Logger {
  ensureLogDir()
  void rotateIfNeededAsync()
  return {
    info: (m: string) => {
      if (CONSOLE_LOG_ENABLED) console.log(`[${name}]`, m)
      fileLog('INFO', name, m)
    },
    warn: (m: string) => {
      if (CONSOLE_LOG_ENABLED) console.warn(`[${name}]`, m)
      fileLog('WARN', name, m)
    },
    error: (m: string) => {
      if (CONSOLE_LOG_ENABLED) console.error(`[${name}]`, m)
      fileLog('ERROR', name, m)
    },
    debug: (m: string) => {
      if (CONSOLE_LOG_ENABLED) console.debug(`[${name}]`, m)
      fileLog('DEBUG', name, m)
    },
    event: (eventName: string, fields: Record<string, unknown>) => {
      fileEvent(name, eventName, fields)
    }
  }
}

/**
 * Logs an error with full context including stack trace.
 * Logs message at error level and stack trace at debug level.
 */
export function logError(logger: Logger, context: string, err: unknown): void {
  if (err instanceof Error) {
    logger.error(`${context}: ${err.message}`)
    if (err.stack) {
      logger.debug(`Stack: ${err.stack.split('\n').slice(1, 4).join(' | ')}`)
    }
  } else {
    logger.error(`${context}: ${String(err)}`)
  }
}
