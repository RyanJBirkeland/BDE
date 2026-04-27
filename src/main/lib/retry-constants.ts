/**
 * Shared retry timing constants for service-layer dispatch operations.
 *
 * A single 200 ms window is wide enough to survive a transient batch-queue
 * race (the setTimeout(0) batch in TaskTerminalService) while short enough
 * to remain imperceptible on the happy path.
 */
export const DISPATCH_RETRY_DELAY_MS = 200
