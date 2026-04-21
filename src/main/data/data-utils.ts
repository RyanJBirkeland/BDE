import { getErrorMessage } from '../../shared/errors'
import type { Logger } from '../logger'

/**
 * Wraps a data-layer operation with standardized error logging and fallback.
 * Replaces the repetitive try/catch blocks scattered across query files.
 *
 * Only use for catch blocks that log-and-return a fallback. Do NOT use when
 * the catch block re-throws, applies recovery logic, or has intentional
 * semantics (e.g. fail-closed Infinity for WIP limit).
 */
export function withDataLayerError<T>(op: () => T, label: string, fallback: T, logger: Logger): T {
  try {
    return op()
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[data] ${label} failed: ${msg}`)
    return fallback
  }
}
