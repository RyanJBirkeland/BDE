/**
 * Memory search handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const mockExecFileAsync = vi.hoisted(() => vi.fn())

vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecFileAsync)
}))

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

vi.mock('../../paths', () => ({
  BDE_MEMORY_DIR: '/mock/memory/dir'
}))

import { registerMemorySearchHandler } from '../memory-search'
import { safeHandle } from '../../ipc-utils'

describe('Memory search handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the memory:search channel', () => {
    registerMemorySearchHandler()

    expect(safeHandle).toHaveBeenCalledTimes(1)
    expect(safeHandle).toHaveBeenCalledWith('memory:search', expect.any(Function))
  })

  it('returns search results with matching files and lines', async () => {
    let searchHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'memory:search') {
        searchHandler = handler
      }
    })

    const mockStdout = `MEMORY.md:1:This is a test line
MEMORY.md:5:Another test match
projects/foo.md:10:test result here
projects/foo.md:12:more test content`

    mockExecFileAsync.mockResolvedValue({ stdout: mockStdout })

    registerMemorySearchHandler()

    expect(searchHandler).toBeDefined()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await searchHandler(mockEvent, 'test')

    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'grep',
      ['-rni', '--', 'test', '.'],
      expect.objectContaining({
        cwd: '/mock/memory/dir',
        encoding: 'utf-8'
      })
    )

    expect(result).toEqual([
      {
        path: 'MEMORY.md',
        matches: [
          { line: 1, content: 'This is a test line' },
          { line: 5, content: 'Another test match' }
        ]
      },
      {
        path: 'projects/foo.md',
        matches: [
          { line: 10, content: 'test result here' },
          { line: 12, content: 'more test content' }
        ]
      }
    ])
  })

  it('returns empty array when no matches found', async () => {
    let searchHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'memory:search') {
        searchHandler = handler
      }
    })

    const error: any = new Error('grep exit code 1')
    error.code = 1
    mockExecFileAsync.mockRejectedValue(error)

    registerMemorySearchHandler()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await searchHandler(mockEvent, 'nonexistent')

    expect(result).toEqual([])
  })

  it('throws error for grep failures other than no matches', async () => {
    let searchHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'memory:search') {
        searchHandler = handler
      }
    })

    const error = new Error('grep permission denied')
    mockExecFileAsync.mockRejectedValue(error)

    registerMemorySearchHandler()

    const mockEvent = {} as IpcMainInvokeEvent
    await expect(searchHandler(mockEvent, 'query')).rejects.toThrow('grep permission denied')
  })

  it('handles empty query gracefully', async () => {
    let searchHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'memory:search') {
        searchHandler = handler
      }
    })

    mockExecFileAsync.mockResolvedValue({ stdout: '' })

    registerMemorySearchHandler()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await searchHandler(mockEvent, '')

    expect(result).toEqual([])
  })
})
