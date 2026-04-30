import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSpecGenerationPrompt, generateSpec } from '../spec-generation-service'

vi.mock('../../sdk-streaming', () => ({
  runSdkStreaming: vi.fn()
}))

vi.mock('../../agent-manager/backend-selector', () => ({
  resolveAgentRuntime: vi.fn().mockReturnValue({ model: 'claude-haiku-4-5' })
}))

import { runSdkStreaming } from '../../sdk-streaming'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildSpecGenerationPrompt', () => {
  it('includes the task title in the prompt', () => {
    const prompt = buildSpecGenerationPrompt({
      title: 'Add retry logic',
      repo: 'fleet',
      templateHint: 'feature'
    })
    expect(prompt).toContain('Add retry logic')
  })

  it('includes the repo in the prompt', () => {
    const prompt = buildSpecGenerationPrompt({ title: 'T', repo: 'myapp', templateHint: 'bugfix' })
    expect(prompt).toContain('myapp')
  })

  it('includes scaffold sections derived from the template hint', () => {
    const prompt = buildSpecGenerationPrompt({ title: 'T', repo: 'r', templateHint: 'bugfix' })
    expect(prompt).toContain('Bug Description')
  })
})

describe('generateSpec — happy path', () => {
  it('returns the generated spec text from runSdkStreaming', async () => {
    vi.mocked(runSdkStreaming).mockResolvedValue('## Overview\n\nGenerated spec content')

    const result = await generateSpec({ title: 'Add feature', repo: 'fleet', templateHint: 'feature' })

    expect(result).toBe('## Overview\n\nGenerated spec content')
  })

  it('calls runSdkStreaming with tools:[] and bypassPermissions', async () => {
    vi.mocked(runSdkStreaming).mockResolvedValue('spec')

    await generateSpec({ title: 'T', repo: 'r', templateHint: 'feature' })

    expect(runSdkStreaming).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      expect.any(Map),
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({
        tools: [],
        permissionMode: 'bypassPermissions'
      })
    )
  })
})

describe('generateSpec — fallback on empty response', () => {
  it('returns a fallback spec when runSdkStreaming returns empty string', async () => {
    vi.mocked(runSdkStreaming).mockResolvedValue('')

    const result = await generateSpec({ title: 'My task', repo: 'fleet', templateHint: 'feature' })

    expect(result).toContain('My task')
    expect(result).toContain('No spec generated')
  })
})

describe('generateSpec — malformed agent response', () => {
  it('returns an error spec when runSdkStreaming throws', async () => {
    vi.mocked(runSdkStreaming).mockRejectedValue(new Error('SDK timed out'))

    const result = await generateSpec({ title: 'My task', repo: 'fleet', templateHint: 'feature' })

    expect(result).toContain('My task')
    expect(result).toContain('Error generating spec')
    expect(result).toContain('SDK timed out')
  })
})
