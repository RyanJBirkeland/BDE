import {
  appendFileSync,
  statSync,
  mkdirSync,
  chmodSync,
  existsSync,
  renameSync,
  rmSync
} from 'node:fs'
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

function rotateIfNeeded(): void {
  try {
    const stats = statSync(LOG_PATH)
    if (stats.size > MAX_LOG_SIZE) {
      const old1 = LOG_PATH + '.old'
      const old2 = LOG_PATH + '.old.2'
      const old3 = LOG_PATH + '.old.3'
      try {
        rmSync(old3)
      } catch {
        /* may not exist */
      }
      try {
        renameSync(old2, old3)
      } catch {
        /* may not exist */
      }
      try {
        renameSync(old1, old2)
      } catch {
        /* may not exist */
      }
      renameSync(LOG_PATH, old1)
    }
  } catch {
    // File doesn't exist yet — fine
  }
}

let writeCount = 0
const ROTATION_CHECK_INTERVAL = 1000 // check every 1000 writes

// Disk-pressure meta-warning. The synchronous appendFileSync in fileLog blocks
// the main thread; if a single write exceeds this threshold the process is
// likely on a stalled or saturated disk. Warn once per process via console
// (not the logger itself — that would recurse on a slow disk and infinite loop).
const SLOW_WRITE_THRESHOLD_MS = 50
let slowWriteWarned = false

function fileLog(level: string, name: string, msg: string): void {
  try {
    const ts = nowIso()
    // The `mode` option only applies when the file is newly created — existing
    // installs are covered by the chmod in ensureLogDir. Keeping this here
    // means a fresh install (or post-rotation recreate) lands at 0600 directly.
    const startedAt = Date.now()
    appendFileSync(LOG_PATH, `${ts} [${level}] [${name}] ${msg}\n`, { mode: 0o600 })
    const elapsedMs = Date.now() - startedAt
    if (!slowWriteWarned && elapsedMs > SLOW_WRITE_THRESHOLD_MS) {
      slowWriteWarned = true
      console.warn(
        `[logger] slow log write: ${elapsedMs}ms (threshold ${SLOW_WRITE_THRESHOLD_MS}ms) — disk may be under pressure. Further slow writes will be silent.`
      )
    }
    if (++writeCount >= ROTATION_CHECK_INTERVAL) {
      writeCount = 0
      rotateIfNeeded()
    }
  } catch {
    // Logging should never crash the app
  }
}

/** Create a named logger that writes to ~/.bde/bde.log */
export function createLogger(name: string): Logger {
  ensureLogDir()
  rotateIfNeeded()
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
