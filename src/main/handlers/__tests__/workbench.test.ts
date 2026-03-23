/**
 * Workbench handler integration tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// Mock dependencies
vi.mock('../../auth-guard', () => ({
  checkAuthStatus: vi.fn().mockResolvedValue({
    cliFound: true,
    tokenFound: true,
    tokenExpired: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  }),
}))

vi.mock('../../git', () => ({
  getRepoPaths: vi.fn().mockReturnValue({
    BDE: '/Users/test/projects/BDE',
    TestRepo: '/Users/test/projects/TestRepo',
  }),
}))

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, _opts, cb) => {
    // Mock git status - clean repo
    if (cmd === 'git' && args[0] === 'status') {
      cb(null, { stdout: '', stderr: '' })
    }
    // Mock grep - no results
    else if (cmd === 'grep') {
      const err: any = new Error('No matches')
      err.code = 1
      cb(err)
    }
  }),
}))

vi.mock('../../data/supabase-client', () => ({
  getSupabaseClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
  }),
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn(),
}))

// Mock global agent manager
beforeEach(() => {
  ;(global as any).__agentManager = {
    getStatus: vi.fn().mockReturnValue({
      running: true,
      concurrency: { maxSlots: 2, activeCount: 0 },
      activeAgents: [],
    }),
  }
})

// Import handlers after mocks are set up
import { registerWorkbenchHandlers } from '../workbench'
import { safeHandle } from '../../ipc-utils'

describe('Workbench handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 5 workbench handlers', () => {
    registerWorkbenchHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(5)
    expect(safeHandle).toHaveBeenCalledWith('workbench:checkOperational', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('workbench:researchRepo', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('workbench:chat', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('workbench:generateSpec', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('workbench:checkSpec', expect.any(Function))
  })

  it('checkOperational handler returns all expected fields', async () => {
    let checkOperationalHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'workbench:checkOperational') {
        checkOperationalHandler = handler
      }
    })

    registerWorkbenchHandlers()

    expect(checkOperationalHandler).toBeDefined()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await checkOperationalHandler(mockEvent, { repo: 'BDE' })

    expect(result).toHaveProperty('auth')
    expect(result).toHaveProperty('repoPath')
    expect(result).toHaveProperty('gitClean')
    expect(result).toHaveProperty('noConflict')
    expect(result).toHaveProperty('slotsAvailable')

    expect(result.auth.status).toBe('pass')
    expect(result.repoPath.status).toBe('pass')
    expect(result.repoPath.path).toBe('/Users/test/projects/BDE')
  })

  it('researchRepo handler returns expected structure', async () => {
    let researchRepoHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'workbench:researchRepo') {
        researchRepoHandler = handler
      }
    })

    registerWorkbenchHandlers()

    expect(researchRepoHandler).toBeDefined()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await researchRepoHandler(mockEvent, { query: 'test', repo: 'BDE' })

    expect(result).toHaveProperty('content')
    expect(result).toHaveProperty('filesSearched')
    expect(result).toHaveProperty('totalMatches')
    expect(Array.isArray(result.filesSearched)).toBe(true)
  })

  it('chat stub returns placeholder', async () => {
    let chatHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'workbench:chat') {
        chatHandler = handler
      }
    })

    registerWorkbenchHandlers()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await chatHandler(mockEvent, {
      messages: [{ role: 'user', content: 'test' }],
      formContext: { title: 'Test Task', repo: 'BDE', spec: 'test spec' },
    })

    expect(result.content).toContain('Placeholder')
    expect(result.content).toContain('Test Task')
  })

  it('generateSpec stub returns placeholder', async () => {
    let generateSpecHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'workbench:generateSpec') {
        generateSpecHandler = handler
      }
    })

    registerWorkbenchHandlers()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await generateSpecHandler(mockEvent, {
      title: 'Test Task',
      repo: 'BDE',
      templateHint: 'bugfix',
    })

    expect(result.spec).toContain('Test Task')
    expect(result.spec).toContain('Placeholder')
  })

  it('checkSpec stub returns all expected fields', async () => {
    let checkSpecHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'workbench:checkSpec') {
        checkSpecHandler = handler
      }
    })

    registerWorkbenchHandlers()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await checkSpecHandler(mockEvent, {
      title: 'Test Task',
      repo: 'BDE',
      spec: 'test spec content',
    })

    expect(result).toHaveProperty('clarity')
    expect(result).toHaveProperty('scope')
    expect(result).toHaveProperty('filesExist')
    expect(result.clarity.status).toBe('warn')
    expect(result.scope.status).toBe('warn')
    expect(result.filesExist.status).toBe('warn')
  })
})
