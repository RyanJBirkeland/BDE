/**
 * Maintenance facade — stable re-export path for callers that need internal
 * sprint-task maintenance utilities (snapshot pruning, FK cleanup, update allowlist).
 *
 * These are intentionally NOT on the ISprintTaskRepository interface because they
 * are operational/maintenance concerns, not domain query methods.
 */
export { UPDATE_ALLOWLIST } from './sprint-task-types'
export {
  pruneOldDiffSnapshots,
  DIFF_SNAPSHOT_RETENTION_DAYS,
  cleanTestArtifacts
} from './sprint-maintenance'
export { clearSprintTaskFk } from './sprint-agent-queries'
