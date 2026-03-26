import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs before import
vi.mock('node:fs', () => ({
  appendFileSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 100 })),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn()
}))

import { createLogger } from '../logger'
import { appendFileSync } from 'node:fs'

describe('createLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a logger with info/warn/error methods', () => {
    const logger = createLogger('test')
    expect(logger.info).toBeDefined()
    expect(logger.warn).toBeDefined()
    expect(logger.error).toBeDefined()
  })

  it('writes to log file with correct format', () => {
    const logger = createLogger('my-module')
    logger.info('hello world')
    expect(appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('bde.log'),
      expect.stringMatching(/\[INFO\] \[my-module\] hello world/)
    )
  })

  it('includes timestamp in log entries', () => {
    const logger = createLogger('test')
    logger.warn('warning message')
    const call = vi.mocked(appendFileSync).mock.calls[0]
    // Timestamp format: 2026-03-25T...
    expect(call[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
