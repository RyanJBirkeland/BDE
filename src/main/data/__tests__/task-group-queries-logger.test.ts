import { describe, it, expect, vi } from 'vitest'
import { setTaskGroupQueriesLogger } from '../task-group-queries'

describe('task-group-queries logger injection', () => {
  it('exports setTaskGroupQueriesLogger', () => {
    expect(typeof setTaskGroupQueriesLogger).toBe('function')
  })

  it('accepts a Logger object without throwing', () => {
    const mockLogger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()
    }
    expect(() => setTaskGroupQueriesLogger(mockLogger)).not.toThrow()
  })
})
