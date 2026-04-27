/**
 * User-visible failure notes that flow into a task's `notes` column.
 *
 * Centralised here so the messages stay grep-able, audit-friendly, and free of
 * accidental drift between code paths that report the same underlying
 * condition. Treat the strings as part of the public contract — UI screens,
 * support docs, and error-routing rules pattern-match on them.
 */

export const FAST_FAIL_EXHAUSTED_NOTE =
  'Agent failed 3 times within 30s of starting. Common causes: expired OAuth token (~/.bde/oauth-token), missing npm dependencies, or invalid task spec. Check ~/.bde/bde.log for details. Use the Retry button in the Task Detail drawer to re-queue the task.'

export const NO_COMMITS_NOTE =
  'The agent ran to completion but did not create a commit. Any uncommitted changes in the worktree have been logged to ~/.bde/bde.log.'

export const NOOP_RUN_NOTE =
  'Agent exited cleanly but produced only scratch files (e.g. .aider* or Aider auto-gitignore). ' +
  'This is typically a token-limit or prompt-mismatch failure — the backend process ran but the ' +
  'model made no edits to source files.'
