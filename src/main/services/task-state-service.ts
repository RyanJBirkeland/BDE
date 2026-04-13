/**
 * Task state transition validation service.
 * Extracts status transition business logic from the data layer.
 *
 * Created for audit finding F-t3-qcoh-1 (Score 9.0) — business logic in data layer.
 *
 * NOTE: This module now re-exports from shared/task-state-machine.ts.
 * The data layer imports directly from shared to avoid upward dependency.
 */

export type { ValidationResult } from '../../shared/task-state-machine'
export { validateTransition } from '../../shared/task-state-machine'
