import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

/** Promise-based delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Promisified execFile — prefer this over execSync for shell safety. */
export const execFileAsync = promisify(execFile)

/**
 * Maximum byte length for task `notes` field values stored in SQLite.
 * Keeping this here (shared lib) avoids a circular dependency when callers
 * outside `agent-manager/` need to truncate notes.
 */
const NOTES_MAX_LENGTH = 500

/**
 * Truncates `text` to fit within the task notes field limit.
 * Appends `'...'` when truncation occurs so readers know the note is cut.
 */
export function truncateToNoteLimit(text: string): string {
  return text.length <= NOTES_MAX_LENGTH ? text : text.slice(0, NOTES_MAX_LENGTH - 3) + '...'
}
