/**
 * Workbench handler integration tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import type { IpcMainInvokeEvent } from 'electron'
import { assertHandlersRegistered } from './__test-helpers__/handler-registration'

// Mock SDK response (can be controlled per test)
let mockSdkResponse: string | Error = 'Placeholder response'

// Captured runSdkStreaming calls for assertions on tool restrictions etc.
const runSdkStreamingCalls: Array<{
  prompt: string
  options: Record<string, unknown> | undefined
}> = []

// Mock the Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    const generator = (async function* () {
      if (mockSdkResponse instanceof Error) {
        throw mockSdkResponse
      }
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: mockSdkResponse }]
        }
      }
    })()

    return {
      [Symbol.asyncIterator]() {
        return generator
      },
      return: () => generator.return()
    }
  })
}))

// Mock dependencies
vi.mock('../../credential-store', () => ({
  checkAuthStatus: vi.fn().mockResolvedValue({
    cliFound: true,
    tokenFound: true,
    tokenExpired: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
  })
}))

// Underlying repo map is keyed by lowercased name (mirrors paths.ts behavior)
const mockRepoMap: Record<string, string> = {
  bde: '/Users/test/projects/BDE',
  testrepo: '/Users/test/projects/TestRepo'
}
vi.mock('../../git', () => ({
  getRepoPaths: vi.fn(() => mockRepoMap),
  getRepoPath: vi.fn((name: string) => (name ? mockRepoMap[name.toLowerCase()] : undefined))
}))

// Phase-5 audit: workbench.ts now imports getRepoPath from ../paths (canonical).
vi.mock('../../paths', async () => {
  const actual = await vi.importActual<typeof import('../../paths')>('../../paths')
  return {
    ...actual,
    getRepoPaths: vi.fn(() => mockRepoMap),
    getRepoPath: vi.fn((name: string) => (name ? mockRepoMap[name.toLowerCase()] : undefined))
  }
})

// Spy on runSdkStreaming so we can assert the options it receives.
vi.mock('../../sdk-streaming', async () => {
  const actual = await vi.importActual<typeof import('../../sdk-streaming')>('../../sdk-streaming')
  return {
    ...actual,
    runSdkStreaming: vi.fn(
      async (
        prompt: string,
        _onChunk: (chunk: string) => void,
        _activeStreams: Map<string, { close: () => void }>,
        _streamId: string,
        _timeoutMs?: number,
        options?: Record<string, unknown>
      ) => {
        runSdkStreamingCalls.push({ prompt, options })
        if (mockSdkResponse instanceof Error) throw mockSdkResponse
        return typeof mockSdkResponse === 'string' ? mockSdkResponse : ''
      }
    )
  }
})

vi.mock('../../env-utils', () => ({
  buildAgentEnv: () => ({ ...process.env }),
  buildAgentEnvWithAuth: () => ({ ...process.env }),
  getClaudeCliPath: () => 'claude'
}))

// Route the copilot's model through a deterministic test value so we can
// assert on it without colliding with the Sonnet fallback defaults baked
// into runSdkStreaming / DEFAULT_CONFIG / DEFAULT_SETTINGS. Haiku is the
// only agreed-upon non-default sentinel across the routing test suite.
vi.mock('../../agent-manager/backend-selector', () => ({
  resolveAgentRuntime: (type: import('../../agent-system/personality/types').AgentType) => ({
    backend: 'claude',
    model: type === 'copilot' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-5'
  })
}))

/** Helper: create a fake spawn child that writes `output` to stdout and exits 0. */
function _createFakeSpawnChild(output: string) {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { write: vi.fn(), end: vi.fn() }
  child.kill = vi.fn()

  // Emit data + close on next tick so the caller has time to attach listeners
  process.nextTick(() => {
    child.stdout.emit('data', Buffer.from(output))
    child.emit('close', 0)
  })
  return child
}

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], _opts: unknown, cb: Function) => {
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
    // Default: call back with empty result
    else {
      cb(null, { stdout: '', stderr: '' })
    }
  }),
  spawn: vi.fn((_cmd: string, _args: string[], _opts: unknown) => {
    // The actual prompt content is piped via stdin, so we capture it via stdin.write
    // and return a response based on it. We defer this by capturing the child and
    // using stdin.end to trigger the response.
    const child = new EventEmitter() as any
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()

    let writtenData = ''
    child.stdin = {
      write: vi.fn((data: string) => {
        writtenData += data
      }),
      end: vi.fn(() => {
        // Determine response based on the prompt that was piped in
        let output: string
        if (writtenData.includes('reviewing a coding agent spec')) {
          output = JSON.stringify({
            clarity: { status: 'warn', message: 'Placeholder clarity check' },
            scope: { status: 'warn', message: 'Placeholder scope check' },
            filesExist: { status: 'warn', message: 'Placeholder files check' }
          })
        } else if (
          writtenData.includes('writing a coding agent spec') ||
          writtenData.includes('Generate a')
        ) {
          output = `# Test Task\n\nPlaceholder spec generated by AI.`
        } else {
          output = `Placeholder response about "Test Task".`
        }
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from(output))
          child.emit('close', 0)
        })
      })
    }
    return child
  })
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

const mockAgentManager = {
  getStatus: vi.fn().mockReturnValue({
    running: true,
    concurrency: { maxSlots: 2, activeCount: 0 },
    activeAgents: []
  })
} as any

// Import handlers after mocks are set up
import { registerWorkbenchHandlers } from '../workbench'
import {
  COPILOT_ALLOWED_TOOLS,
  COPILOT_DISALLOWED_TOOLS,
  COPILOT_MAX_BUDGET_USD,
  COPILOT_MAX_TURNS,
  getCopilotSdkOptions,
  buildChatPrompt
} from '../../services/copilot-service'
import { safeHandle } from '../../ipc-utils'

describe('Workbench handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset safeHandle to a noop so prior `mockImplementation` calls don't leak.
    vi.mocked(safeHandle).mockImplementation(() => {})
    runSdkStreamingCalls.length = 0
    mockSdkResponse = 'Placeholder response'
  })

  it('registers exactly the 7 workbench handlers (chat removed)', () => {
    registerWorkbenchHandlers(mockAgentManager)

    assertHandlersRegistered(vi.mocked(safeHandle), [
      'workbench:checkOperational',
      'workbench:researchRepo',
      'workbench:chatStream',
      'workbench:cancelStream',
      'workbench:generateSpec',
      'workbench:checkSpec',
      'workbench:extractPlan'
    ])
  })

  it('does NOT register the legacy non-streaming workbench:chat handler', () => {
    // This is a regression guard for C1: the non-streaming path used to bypass
    // the copilot tool restrictions, granting full Edit/Write/Bash access.
    registerWorkbenchHandlers(mockAgentManager)
    const channels = vi.mocked(safeHandle).mock.calls.map((call) => call[0])
    expect(channels).not.toContain('workbench:chat')
  })

  it('checkOperational handler returns all expected fields', async () => {
    let checkOperationalHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'workbench:checkOperational') {
        checkOperationalHandler = handler
      }
    })

    registerWorkbenchHandlers(mockAgentManager)

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

    registerWorkbenchHandlers(mockAgentManager)

    expect(researchRepoHandler).toBeDefined()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await researchRepoHandler(mockEvent, { query: 'test', repo: 'BDE' })

    expect(result).toHaveProperty('content')
    expect(result).toHaveProperty('filesSearched')
    expect(result).toHaveProperty('totalMatches')
    expect(Array.isArray(result.filesSearched)).toBe(true)
  })

  describe('workbench:chatStream handler', () => {
    function getChatStreamHandler(): any {
      let chatStreamHandler: any
      vi.mocked(safeHandle).mockImplementation((channel, handler) => {
        if (channel === 'workbench:chatStream') chatStreamHandler = handler
      })
      registerWorkbenchHandlers(mockAgentManager)
      return chatStreamHandler
    }

    function makeMockEvent() {
      const sent: any[] = []
      return {
        sender: { send: vi.fn((_channel: string, payload: any) => sent.push(payload)) },
        sent
      }
    }

    it('passes restricted copilot SDK options to runSdkStreaming', async () => {
      const handler = getChatStreamHandler()
      const mockEvent = makeMockEvent()
      mockSdkResponse = 'ok'

      await handler(mockEvent, {
        messages: [{ role: 'user', content: 'where is auth?' }],
        // Renderer sends uppercase — handler must look up case-insensitively.
        formContext: { title: 'T', repo: 'BDE', spec: '' }
      })

      // Wait a microtask for the fire-and-forget runSdkStreaming to be invoked.
      await new Promise((r) => setTimeout(r, 0))

      expect(runSdkStreamingCalls.length).toBeGreaterThanOrEqual(1)
      const opts = runSdkStreamingCalls[0].options as any
      expect(opts).toBeDefined()
      // C2: cwd is the configured repo path, not undefined
      expect(opts.cwd).toBe('/Users/test/projects/BDE')
      // C1: tool restrictions actually flow through
      expect(opts.tools).toEqual([...COPILOT_ALLOWED_TOOLS])
      expect(opts.disallowedTools).toEqual([...COPILOT_DISALLOWED_TOOLS])
      expect(opts.disallowedTools).toContain('Edit')
      expect(opts.disallowedTools).toContain('Write')
      expect(opts.disallowedTools).toContain('Bash')
      // I1: budget ceiling
      expect(opts.maxBudgetUsd).toBe(COPILOT_MAX_BUDGET_USD)
      expect(opts.maxTurns).toBe(COPILOT_MAX_TURNS)
    })

    it('passes the copilot model from settings to runSdkStreaming', async () => {
      const handler = getChatStreamHandler()
      const mockEvent = makeMockEvent()
      mockSdkResponse = 'ok'

      await handler(mockEvent, {
        messages: [{ role: 'user', content: 'hi' }],
        formContext: { title: 't', repo: 'bde', spec: '' }
      })

      await new Promise((r) => setTimeout(r, 0))

      expect(runSdkStreamingCalls.length).toBeGreaterThanOrEqual(1)
      const opts = runSdkStreamingCalls[0].options as Record<string, unknown>
      // Sentinel chosen to be distinct from the Sonnet fallback defaults in
      // runSdkStreaming, DEFAULT_CONFIG.defaultModel, and DEFAULT_SETTINGS.
      expect(opts.model).toBe('claude-haiku-4-5-20251001')
    })

    it('returns an error chunk when the repo is not configured (N1)', async () => {
      const handler = getChatStreamHandler()
      const mockEvent = makeMockEvent()
      mockSdkResponse = 'ok'

      const result = await handler(mockEvent, {
        messages: [{ role: 'user', content: 'hi' }],
        formContext: { title: 'T', repo: 'NotARealRepo', spec: '' }
      })

      expect(result.streamId).toBeDefined()
      // Should NOT have invoked the SDK at all — we fail fast.
      expect(runSdkStreamingCalls.length).toBe(0)
      // Should have sent a done+error chunk to the renderer.
      expect(mockEvent.sender.send).toHaveBeenCalled()
      const lastPayload = mockEvent.sent.at(-1)
      expect(lastPayload.done).toBe(true)
      expect(lastPayload.error).toMatch(/not configured/i)
    })
  })

  describe('getCopilotSdkOptions helper', () => {
    it('produces the expected restricted option set', () => {
      const opts = getCopilotSdkOptions('/some/repo', 'claude-haiku-4-5-20251001')
      expect(opts.cwd).toBe('/some/repo')
      expect(opts.tools).toEqual([...COPILOT_ALLOWED_TOOLS])
      expect(opts.disallowedTools).toEqual([...COPILOT_DISALLOWED_TOOLS])
      expect(opts.maxTurns).toBe(COPILOT_MAX_TURNS)
      expect(opts.maxBudgetUsd).toBe(COPILOT_MAX_BUDGET_USD)
      expect(opts.model).toBe('claude-haiku-4-5-20251001')
    })

    it('forwards the optional onToolUse callback', () => {
      const cb = vi.fn()
      const opts = getCopilotSdkOptions('/some/repo', 'claude-haiku-4-5-20251001', {
        onToolUse: cb
      })
      expect(opts.onToolUse).toBe(cb)
    })
  })

  it('generateSpec stub returns placeholder', async () => {
    let generateSpecHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'workbench:generateSpec') {
        generateSpecHandler = handler
      }
    })

    registerWorkbenchHandlers(mockAgentManager)

    // Set SDK response for spec generation
    mockSdkResponse = '# Test Task\n\nPlaceholder spec generated by AI.'

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await generateSpecHandler(mockEvent, {
      title: 'Test Task',
      repo: 'BDE',
      templateHint: 'bugfix'
    })

    expect(result.spec).toContain('Test Task')
    expect(result.spec).toContain('Placeholder')
  })

  describe('copilot read-only tool restrictions', () => {
    it('COPILOT_ALLOWED_TOOLS exposes only read-only tools', () => {
      expect([...COPILOT_ALLOWED_TOOLS]).toEqual(['Read', 'Grep', 'Glob'])
    })

    it('COPILOT_DISALLOWED_TOOLS forbids every mutation/escape vector', () => {
      // Defense-in-depth: even if the SDK shifts defaults, these are blocked.
      const expected = [
        'Edit',
        'Write',
        'Bash',
        'KillBash',
        'BashOutput',
        'NotebookEdit',
        'WebFetch',
        'WebSearch',
        'Task',
        'ExitPlanMode',
        'TodoWrite',
        'SlashCommand'
      ]
      for (const tool of expected) {
        expect(COPILOT_DISALLOWED_TOOLS).toContain(tool)
      }
    })

    it('does not include any mutation tool in the allowed list', () => {
      const allowed = new Set<string>([...COPILOT_ALLOWED_TOOLS])
      for (const forbidden of ['Edit', 'Write', 'Bash', 'NotebookEdit', 'WebFetch']) {
        expect(allowed.has(forbidden)).toBe(false)
      }
    })
  })

  describe('buildChatPrompt for copilot', () => {
    it('includes spec-drafting mode framing', () => {
      const prompt = buildChatPrompt([{ role: 'user', content: 'help' }], {
        title: 'T',
        repo: 'BDE',
        spec: ''
      })
      expect(prompt).toContain('## Mode: Spec Drafting')
      expect(prompt).toContain('not execute the task')
    })

    it('includes target repository path when provided', () => {
      const prompt = buildChatPrompt(
        [{ role: 'user', content: 'where is auth?' }],
        { title: 'T', repo: 'BDE', spec: '' },
        '/Users/test/projects/BDE'
      )
      expect(prompt).toContain('## Target Repository')
      expect(prompt).toContain('/Users/test/projects/BDE')
    })

    it('omits target repository section when repoPath is undefined', () => {
      const prompt = buildChatPrompt([{ role: 'user', content: 'hi' }], {
        title: 'T',
        repo: 'BDE',
        spec: ''
      })
      expect(prompt).not.toContain('## Target Repository')
    })
  })

  it('checkSpec returns { clarity, scope, filesExist } shape from SpecQualityService', async () => {
    let checkSpecHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'workbench:checkSpec') {
        checkSpecHandler = handler
      }
    })

    registerWorkbenchHandlers(mockAgentManager)

    const mockEvent = {} as IpcMainInvokeEvent

    // A spec with no required sections fails structural validation immediately —
    // SpecQualityService returns errors for all four missing required sections,
    // and the prescriptiveness AI check is skipped (only runs when structural passes).
    const result = await checkSpecHandler(mockEvent, {
      title: 'Test Task',
      repo: 'BDE',
      spec: 'test spec content'
    })

    expect(result).toHaveProperty('clarity')
    expect(result).toHaveProperty('scope')
    expect(result).toHaveProperty('filesExist')
    // Structural errors → clarity is fail
    expect(result.clarity.status).toBe('fail')
    expect(result.clarity.message).toMatch(/Missing required section/i)
    // No scope or file-path issues in this plain text spec
    expect(result.scope.status).toBe('pass')
    expect(result.filesExist.status).toBe('pass')
  })

  it('checkSpec passes a well-formed spec with all required sections', async () => {
    let checkSpecHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'workbench:checkSpec') {
        checkSpecHandler = handler
      }
    })

    registerWorkbenchHandlers(mockAgentManager)

    // SDK mock returns no design-decision issues
    mockSdkResponse = JSON.stringify({ requiresDesignDecision: false, reason: '' })

    const mockEvent = {} as IpcMainInvokeEvent
    const wellFormedSpec = [
      '## Overview\nDo the thing.',
      '## Files to Change\n- src/main/foo.ts',
      '## Implementation Steps\n1. Add function bar() to src/main/foo.ts',
      '## How to Test\nRun npm test'
    ].join('\n\n')

    const result = await checkSpecHandler(mockEvent, {
      title: 'Test Task',
      repo: 'BDE',
      spec: wellFormedSpec
    })

    expect(result).toHaveProperty('clarity')
    expect(result).toHaveProperty('scope')
    expect(result).toHaveProperty('filesExist')
    expect(result.clarity.status).toBe('pass')
    expect(result.scope.status).toBe('pass')
    expect(result.filesExist.status).toBe('pass')
  })
})
