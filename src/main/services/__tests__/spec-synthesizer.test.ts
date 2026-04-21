import { describe, it, expect, vi } from 'vitest'
import type { SdkStreamingOptions } from '../../sdk-streaming'

const runSdkStreamingMock =
  vi.fn<
    (
      prompt: string,
      onChunk: (c: string) => void,
      streams: Map<string, { close: () => void }>,
      id: string,
      timeout?: number,
      opts?: SdkStreamingOptions
    ) => Promise<string>
  >()
vi.mock('../../sdk-streaming', () => ({
  runSdkStreaming: (...args: Parameters<typeof runSdkStreamingMock>) => runSdkStreamingMock(...args)
}))
vi.mock('../../agent-manager/backend-selector', () => ({
  resolveAgentRuntime: () => ({ backend: 'claude', model: 'claude-haiku-4-5-20251001' })
}))

import { synthesizeSpec, reviseSpec } from '../spec-synthesizer'

describe('spec-synthesizer — model routing', () => {
  it('passes the synthesizer model to runSdkStreaming on synthesize', async () => {
    runSdkStreamingMock.mockResolvedValue('## Spec\nBody')
    await synthesizeSpec(
      {
        templateName: 'Feature',
        answers: { goal: 'ship it' },
        repo: 'bde',
        repoPath: '/tmp/nonexistent-fake'
      } as never,
      () => {},
      'stream-synth-1'
    )
    const options = runSdkStreamingMock.mock.calls[0]?.[5]
    expect(options?.model).toBe('claude-haiku-4-5-20251001')
  })

  it('passes the synthesizer model to runSdkStreaming on revise', async () => {
    runSdkStreamingMock.mockResolvedValue('## Revised\nBody')
    await reviseSpec(
      {
        currentSpec: '## Current',
        instruction: 'add tests',
        repo: 'bde'
      } as never,
      () => {},
      'stream-revise-1'
    )
    const options = runSdkStreamingMock.mock.calls[0]?.[5]
    expect(options?.model).toBe('claude-haiku-4-5-20251001')
  })
})
