import { describe, it, expect, vi } from 'vitest'

// Minimal mocks so workbench.ts can be imported
vi.mock('node:crypto', () => ({ randomUUID: vi.fn().mockReturnValue('test-uuid') }))
vi.mock('../../ipc-utils', () => ({ safeHandle: vi.fn() }))
vi.mock('../../paths', () => ({ getRepoPath: vi.fn() }))
vi.mock('../../services/repo-search-service', () => ({ searchRepo: vi.fn() }))
vi.mock('../../services/spec-quality/factory', () => ({
  createSpecQualityService: vi.fn().mockReturnValue({})
}))
vi.mock('../../sdk-streaming', () => ({ runSdkStreaming: vi.fn() }))
vi.mock('../../services/plan-extractor', () => ({ extractTasksFromPlan: vi.fn() }))
vi.mock('../../services/copilot-service', () => ({
  buildChatPrompt: vi.fn(),
  getCopilotSdkOptions: vi.fn()
}))
vi.mock('../../services/spec-generation-service', () => ({ generateSpec: vi.fn() }))
vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() })
}))
vi.mock('../../shared/errors', () => ({ getErrorMessage: (e: unknown) => String(e) }))
vi.mock('../../services/operational-checks-service', () => ({ runOperationalChecks: vi.fn() }))
vi.mock('../../agent-manager/backend-selector', () => ({
  resolveAgentRuntime: vi.fn().mockReturnValue({ model: 'claude-3-5-haiku-latest' })
}))
vi.mock('../../../shared/ipc-channels', () => ({ IpcChannelMap: {} }))

import { parseResearchRepoArgs, parseChatStreamArgs } from '../workbench'

describe('parseResearchRepoArgs', () => {
  it('accepts valid query and repo', () => {
    const result = parseResearchRepoArgs([{ query: 'findByTaskId', repo: 'bde' }])
    expect(result[0]).toEqual({ query: 'findByTaskId', repo: 'bde' })
  })

  it('throws when input is not an object', () => {
    expect(() => parseResearchRepoArgs(['not-an-object'])).toThrow('plain object')
    expect(() => parseResearchRepoArgs([null])).toThrow('plain object')
  })

  it('throws when query is empty string', () => {
    expect(() => parseResearchRepoArgs([{ query: '', repo: 'bde' }])).toThrow('query')
  })

  it('throws when query is whitespace-only', () => {
    expect(() => parseResearchRepoArgs([{ query: '   ', repo: 'bde' }])).toThrow('query')
  })

  it('throws when query is missing', () => {
    expect(() => parseResearchRepoArgs([{ repo: 'bde' }])).toThrow('query')
  })

  it('throws when repo is empty string', () => {
    expect(() => parseResearchRepoArgs([{ query: 'foo', repo: '' }])).toThrow('repo')
  })

  it('throws when repo is missing', () => {
    expect(() => parseResearchRepoArgs([{ query: 'foo' }])).toThrow('repo')
  })
})

describe('parseChatStreamArgs', () => {
  const validInput = {
    messages: [{ role: 'user', content: 'Hello' }],
    formContext: { title: 'My Task', repo: 'bde', spec: '## Spec\nDo the thing.' }
  }

  it('accepts a valid input object', () => {
    const result = parseChatStreamArgs([validInput])
    expect(result[0]).toBe(validInput)
  })

  it('throws when input is not an object', () => {
    expect(() => parseChatStreamArgs([null])).toThrow('plain object')
    expect(() => parseChatStreamArgs(['string'])).toThrow('plain object')
  })

  it('throws when messages is not an array', () => {
    expect(() =>
      parseChatStreamArgs([{ ...validInput, messages: 'not-an-array' }])
    ).toThrow('messages')
  })

  it('throws when formContext is missing', () => {
    const { formContext: _, ...withoutCtx } = validInput
    expect(() => parseChatStreamArgs([withoutCtx])).toThrow('formContext')
  })

  it('throws when formContext.repo is empty', () => {
    expect(() =>
      parseChatStreamArgs([{ ...validInput, formContext: { ...validInput.formContext, repo: '' } }])
    ).toThrow('repo')
  })

  it('throws when formContext.repo is missing', () => {
    const { repo: _, ...noRepo } = validInput.formContext
    expect(() =>
      parseChatStreamArgs([{ ...validInput, formContext: noRepo }])
    ).toThrow('repo')
  })
})
