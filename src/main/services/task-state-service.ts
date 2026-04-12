/**
 * Task state transition validation service.
 * Extracts status transition business logic from the data layer.
 *
 * Created for audit finding F-t3-qcoh-1 (Score 9.0) — business logic in data layer.
 */

import { isValidTransition, VALID_TRANSITIONS } from '../../shared/task-state-machine'

/**
 * Validation result for a status transition.
 */
export type ValidationResult = { ok: true } | { ok: false; reason: string }

/**
 * Validates whether a status transition is allowed by the state machine.
 *
 * @param currentStatus - The task's current status
 * @param targetStatus - The desired new status
 * @returns Validation result with descriptive error reason on failure
 *
 * @example
 * const result = validateTransition('active', 'done')
 * if (!result.ok) {
 *   logger.warn(result.reason)
 *   return null
 * }
 */
export function validateTransition(
  currentStatus: string,
  targetStatus: string
): ValidationResult {
  if (!isValidTransition(currentStatus, targetStatus)) {
    const allowed = VALID_TRANSITIONS[currentStatus]
    const allowedArray = allowed ? Array.from(allowed) : []
    const allowedList = allowedArray.length > 0 ? allowedArray.join(', ') : 'none'
    return {
      ok: false,
      reason: `Invalid transition: ${currentStatus} → ${targetStatus}. Allowed: ${allowedList}`
    }
  }
  return { ok: true }
}
