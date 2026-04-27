import type { Logger } from '../logger'
import { createLogger } from '../logger'
import { getErrorMessage } from '../../shared/errors'

// Module-level logger — defaults to file logger, injectable for testing/structured logging
let logger: Logger = createLogger('sprint-queries')

export function setSprintQueriesLogger(l: Logger): void {
  logger = l
}

export function getSprintQueriesLogger(): Logger {
  return logger
}

/**
 * Error handling wrapper for query operations.
 * Logs errors with operation context and returns fallback value.
 */
export function withErrorLogging<T>(operation: () => T, fallback: T, operationName: string): T {
  try {
    return operation()
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-queries] ${operationName} failed: ${msg}`)
    return fallback
  }
}
