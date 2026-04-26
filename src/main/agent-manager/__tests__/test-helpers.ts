/**
 * Shared mock factories for agent-manager tests.
 *
 * Extracted from duplicated `makeLogger` and `makeMetrics` definitions
 * scattered across 10+ test files. Centralizing them keeps the spy
 * surface area consistent — adding a new logger method requires only
 * one change here, not a sweep across the test suite.
 */
import { vi } from 'vitest'

export function makeLogger(): {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
  event: ReturnType<typeof vi.fn>
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn()
  }
}

export function makeMetrics(): {
  increment: ReturnType<typeof vi.fn>
  setLastDrainDuration: ReturnType<typeof vi.fn>
  recordWatchdogVerdict: ReturnType<typeof vi.fn>
} {
  return {
    increment: vi.fn(),
    setLastDrainDuration: vi.fn(),
    recordWatchdogVerdict: vi.fn()
  }
}
