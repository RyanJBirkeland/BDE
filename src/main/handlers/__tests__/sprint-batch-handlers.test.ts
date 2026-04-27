/**
 * Sprint batch handler tests — validates repo field against configured repos
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock settings
vi.mock('../../settings', () => ({
  getSettingJson: vi.fn()
}))

// Mock ipc-utils
vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn((channel, handler) => {
    // Store handlers for later invocation
    if (!global.__handlers) global.__handlers = new Map()
    global.__handlers.set(channel, handler)
  })
}))

// Mock sprint-task-repository
vi.mock('../../data/sprint-task-repository', () => ({
  createSprintTaskRepository: vi.fn()
}))

// Mock lib/patch-validation
vi.mock('../../lib/patch-validation', () => ({
  validateAndFilterPatch: vi.fn((patch) => patch)
}))

import { registerSprintBatchHandlers } from '../sprint-batch-handlers'
import { getSettingJson } from '../../settings'

declare global {
  var __handlers: Map<string, Function>
}

describe('sprint:batchImport handler', () => {
  const mockRepo = {
    createTask: vi.fn((input) => ({ id: `id-${Date.now()}`, ...input }))
  }

  const mockDeps = {
    onStatusTerminal: vi.fn(),
    repo: mockRepo as never
  }

  beforeEach(() => {
    vi.clearAllMocks()
    global.__handlers = new Map()
  })

  it('rejects tasks with unconfigured repo when repos are set', async () => {
    // Configure repos
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'fleet', localPath: '/path/to/fleet' },
      { name: 'life-os', localPath: '/path/to/life-os' }
    ])

    registerSprintBatchHandlers(mockDeps)
    const handler = global.__handlers.get('sprint:batchImport')
    expect(handler).toBeDefined()

    const result = await handler(null, [
      { title: 'Valid Task', repo: 'fleet', spec: 'Do something' },
      { title: 'Invalid Task', repo: 'unknown-repo', spec: 'Do something else' }
    ])

    expect(result.created).toHaveLength(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/unknown-repo.*not configured/i)
  })

  it('rejects all tasks when no repos are configured', async () => {
    // Empty repos config
    vi.mocked(getSettingJson).mockReturnValue([])

    registerSprintBatchHandlers(mockDeps)
    const handler = global.__handlers.get('sprint:batchImport')
    expect(handler).toBeDefined()

    const result = await handler(null, [{ title: 'Task A', repo: 'fleet', spec: 'Do something' }])

    expect(result.created).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/not configured.*No repos are configured/i)
  })

  it('validates repo case-insensitively', async () => {
    vi.mocked(getSettingJson).mockReturnValue([{ name: 'FLEET', localPath: '/path/to/fleet' }])

    registerSprintBatchHandlers(mockDeps)
    const handler = global.__handlers.get('sprint:batchImport')
    expect(handler).toBeDefined()

    const result = await handler(null, [
      { title: 'Task A', repo: 'fleet', spec: 'Do something' },
      { title: 'Task B', repo: 'FLEET', spec: 'Do something' },
      { title: 'Task C', repo: 'Fleet', spec: 'Do something' }
    ])

    expect(result.created).toHaveLength(3)
    expect(result.errors).toHaveLength(0)
  })

  it('accepts valid repos from configured list', async () => {
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'fleet', localPath: '/path/to/fleet' },
      { name: 'life-os', localPath: '/path/to/life-os' }
    ])

    registerSprintBatchHandlers(mockDeps)
    const handler = global.__handlers.get('sprint:batchImport')
    expect(handler).toBeDefined()

    const result = await handler(null, [
      { title: 'Task A', repo: 'fleet', spec: 'Do something' },
      { title: 'Task B', repo: 'life-os', spec: 'Do something else' }
    ])

    expect(result.created).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
  })
})
