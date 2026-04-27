/**
 * Typed sentinel thrown by Phase 1 and Phase 2 helpers in runAgent to signal
 * an already-handled abort.
 *
 * runAgent catch blocks check `instanceof PipelineAbortError` to distinguish
 * an expected early exit (helper completed its own recovery) from an unexpected
 * error that requires runAgent to perform claim-release and terminal notification.
 */
export class PipelineAbortError extends Error {
  override readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'PipelineAbortError'
    this.cause = cause
  }
}
