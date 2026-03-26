import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock env-utils
vi.mock('../env-utils', () => ({
  buildAgentEnv: () => ({ ...process.env })
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockChild = any

// Create mock child process factory
function createMockChild(): MockChild {
  const child = new EventEmitter()
  ;(child as MockChild).stdin = { write: vi.fn(), end: vi.fn() }
  ;(child as MockChild).stdout = new EventEmitter()
  ;(child as MockChild).stderr = new EventEmitter()
  ;(child as MockChild).kill = vi.fn()
  return child
}

let mockChild: MockChild

vi.mock('child_process', () => ({
  spawn: () => mockChild
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
    mockChild = createMockChild()
  })

  it('returns passed: true when all checks pass', async () => {
    const promise = checkSpecSemantic(validInput)

    // Simulate successful Claude CLI response
    const response = JSON.stringify({
      clarity: { status: 'pass', message: 'Clear and actionable' },
      scope: { status: 'pass', message: 'Good scope' },
      filesExist: { status: 'pass', message: 'Paths look valid' }
    })
    mockChild.stdout.emit('data', Buffer.from(response))
    mockChild.emit('close', 0)

    const result = await promise
    expect(result.passed).toBe(true)
    expect(result.hasFails).toBe(false)
    expect(result.failMessages).toEqual([])
  })

  it('returns passed: false when a check fails', async () => {
    const promise = checkSpecSemantic(validInput)

    const response = JSON.stringify({
      clarity: { status: 'fail', message: 'Too vague' },
      scope: { status: 'pass', message: 'Good scope' },
      filesExist: { status: 'pass', message: 'Paths look valid' }
    })
    mockChild.stdout.emit('data', Buffer.from(response))
    mockChild.emit('close', 0)

    const result = await promise
    expect(result.passed).toBe(false)
    expect(result.hasFails).toBe(true)
    expect(result.failMessages).toContainEqual(expect.stringContaining('clarity'))
  })

  it('returns passed: true with warnings when only warns present', async () => {
    const promise = checkSpecSemantic(validInput)

    const response = JSON.stringify({
      clarity: { status: 'warn', message: 'Could be clearer' },
      scope: { status: 'warn', message: 'Might be broad' },
      filesExist: { status: 'warn', message: 'No specific paths' }
    })
    mockChild.stdout.emit('data', Buffer.from(response))
    mockChild.emit('close', 0)

    const result = await promise
    expect(result.passed).toBe(true)
    expect(result.hasWarns).toBe(true)
    expect(result.warnMessages.length).toBe(3)
  })

  it('degrades gracefully when Claude CLI is unavailable (spawn error)', async () => {
    const promise = checkSpecSemantic(validInput)

    mockChild.emit('error', new Error('spawn ENOENT'))

    const result = await promise
    expect(result.passed).toBe(true)
    expect(result.hasWarns).toBe(true)
    expect(result.warnMessages).toContainEqual(expect.stringContaining('Claude CLI unavailable'))
  })

  it('degrades gracefully when Claude CLI returns invalid JSON', async () => {
    const promise = checkSpecSemantic(validInput)

    mockChild.stdout.emit('data', Buffer.from('not valid json at all'))
    mockChild.emit('close', 0)

    const result = await promise
    // Invalid JSON should be caught and degrade gracefully
    expect(result.passed).toBe(true)
    expect(result.hasWarns).toBe(true)
  })
})
