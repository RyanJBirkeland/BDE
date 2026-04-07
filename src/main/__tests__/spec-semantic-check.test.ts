import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock env-utils
vi.mock('../env-utils', () => ({
  buildAgentEnv: () => ({ ...process.env }),
  // spec-semantic-check now passes pathToClaudeCodeExecutable into the SDK
  // options. Without this mock export the named import resolves to undefined
  // and the runSdkQuery call throws "getClaudeCliPath is not a function".
  getClaudeCliPath: () => '/mock/path/to/claude-agent-sdk/cli.js'
}))

// Mock the SDK with an async iterable that can be controlled per test
let mockSdkResponse: string | Error = ''

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    const generator = (async function* () {
      if (mockSdkResponse instanceof Error) {
        throw mockSdkResponse
      }
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'text',
              text: mockSdkResponse
            }
          ]
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

// Import after mocks
const { checkSpecSemantic } = await import('../spec-semantic-check')

const validInput = {
  title: 'Fix login bug',
  repo: 'bde',
  spec: '## Problem\nLogin broken\n## Solution\nFix auth flow'
}

describe('checkSpecSemantic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSdkResponse = ''
  })

  it('returns passed: true when all checks pass', async () => {
    // Set mock SDK response
    mockSdkResponse = JSON.stringify({
      clarity: { status: 'pass', message: 'Clear and actionable' },
      scope: { status: 'pass', message: 'Good scope' },
      filesExist: { status: 'pass', message: 'Paths look valid' }
    })

    const result = await checkSpecSemantic(validInput)
    expect(result.passed).toBe(true)
    expect(result.hasFails).toBe(false)
    expect(result.failMessages).toEqual([])
  })

  it('returns passed: false when a check fails', async () => {
    mockSdkResponse = JSON.stringify({
      clarity: { status: 'fail', message: 'Too vague' },
      scope: { status: 'pass', message: 'Good scope' },
      filesExist: { status: 'pass', message: 'Paths look valid' }
    })

    const result = await checkSpecSemantic(validInput)
    expect(result.passed).toBe(false)
    expect(result.hasFails).toBe(true)
    expect(result.failMessages).toContainEqual(expect.stringContaining('clarity'))
  })

  it('returns passed: true with warnings when only warns present', async () => {
    mockSdkResponse = JSON.stringify({
      clarity: { status: 'warn', message: 'Could be clearer' },
      scope: { status: 'warn', message: 'Might be broad' },
      filesExist: { status: 'warn', message: 'No specific paths' }
    })

    const result = await checkSpecSemantic(validInput)
    expect(result.passed).toBe(true)
    expect(result.hasWarns).toBe(true)
    expect(result.warnMessages.length).toBe(3)
  })

  it('degrades gracefully when Claude SDK is unavailable', async () => {
    mockSdkResponse = new Error('SDK unavailable')

    const result = await checkSpecSemantic(validInput)
    expect(result.passed).toBe(true)
    expect(result.hasWarns).toBe(true)
    expect(result.warnMessages).toContainEqual(expect.stringContaining('Claude SDK unavailable'))
  })

  it('degrades gracefully when Claude SDK returns invalid JSON', async () => {
    mockSdkResponse = 'not valid json at all'

    const result = await checkSpecSemantic(validInput)
    // Invalid JSON should be caught and degrade gracefully
    expect(result.passed).toBe(true)
    expect(result.hasWarns).toBe(true)
  })
})
