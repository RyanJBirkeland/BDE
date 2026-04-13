/**
 * Sprint mutation observer — backward compatibility shim.
 * Re-exports from sprint-mutation-broadcaster to maintain existing import paths.
 *
 * The notification logic lives in the broadcaster module.
 * This file exists only to avoid breaking handlers/review.ts and tests
 * that import from here.
 */
export {
  onSprintMutation,
  notifySprintMutation,
  type SprintMutationEvent,
  type SprintMutationListener
} from '../services/sprint-mutation-broadcaster'
