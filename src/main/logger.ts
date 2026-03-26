import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, existsSync } from 'node:fs'

const BDE_DIR = join(homedir(), '.bde')
const LOG_PATH = join(BDE_DIR, 'bde.log')
const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

function ensureLogDir(): void {
  if (!existsSync(BDE_DIR)) {
    mkdirSync(BDE_DIR, { recursive: true })
  }
}

function rotateIfNeeded(): void {
  try {
    const stats = statSync(LOG_PATH)
    if (stats.size > MAX_LOG_SIZE) {
      writeFileSync(LOG_PATH, '') // truncate
    }
  } catch {
    // File doesn't exist yet — fine
  }
}

function fileLog(level: string, name: string, msg: string): void {
  try {
    const ts = new Date().toISOString()
    appendFileSync(LOG_PATH, `${ts} [${level}] [${name}] ${msg}\n`)
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
      console.log(`[${name}]`, m)
      fileLog('INFO', name, m)
    },
    warn: (m: string) => {
      console.warn(`[${name}]`, m)
      fileLog('WARN', name, m)
    },
    error: (m: string) => {
      console.error(`[${name}]`, m)
      fileLog('ERROR', name, m)
    }
  }
}
