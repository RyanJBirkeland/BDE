import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerSynthesizerHandlers } from '../synthesizer-handlers'
import * as specSynthesizer from '../../services/spec-synthesizer'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

vi.mock('../../services/spec-synthesizer')

describe('synthesizer-handlers', () => {
  let mockSender: { send: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    handlers.clear()
    mockSender = { send: vi.fn() }

    vi.mocked(specSynthesizer.synthesizeSpec).mockImplementation((req, onChunk, _streamId) => {
      onChunk('Generated spec content')
      return Promise.resolve({ spec: 'Full spec', filesAnalyzed: 5 })
    })
    vi.mocked(specSynthesizer.reviseSpec).mockImplementation((req, onChunk, _streamId) => {
      onChunk('Revised content')
      return Promise.resolve({ spec: 'Revised spec', filesAnalyzed: 3 })
    })
    vi.mocked(specSynthesizer.cancelSynthesis).mockReturnValue(true)

    registerSynthesizerHandlers()
  })

  it('should register all synthesizer handlers', () => {
    expect(handlers.has('synthesizer:generate')).toBe(true)
    expect(handlers.has('synthesizer:revise')).toBe(true)
    expect(handlers.has('synthesizer:cancel')).toBe(true)
  })

  const validGenerateRequest = {
    templateName: 'bug',
    repo: 'myrepo',
    repoPath: '/repos/myrepo',
    answers: {}
  }

  describe('synthesizer:generate', () => {
    it('should return streamId immediately', async () => {
      const handler = handlers.get('synthesizer:generate')!
      const result = await handler({ sender: mockSender }, validGenerateRequest)

      expect(result).toMatchObject({ streamId: expect.any(String) })
    })

    it('should call synthesizeSpec with request and callback', async () => {
      const handler = handlers.get('synthesizer:generate')!
      const req = { ...validGenerateRequest, templateName: 'feature', answers: { title: 'Test' } }

      await handler({ sender: mockSender }, req)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(specSynthesizer.synthesizeSpec).toHaveBeenCalledWith(
        req,
        expect.any(Function),
        expect.any(String)
      )
    })

    it('should stream chunks to renderer', async () => {
      const handler = handlers.get('synthesizer:generate')!
      await handler({ sender: mockSender }, validGenerateRequest)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSender.send).toHaveBeenCalledWith(
        'synthesizer:chunk',
        expect.objectContaining({
          chunk: 'Generated spec content',
          done: false
        })
      )
    })

    it('should send completion message with full text', async () => {
      const handler = handlers.get('synthesizer:generate')!
      await handler({ sender: mockSender }, validGenerateRequest)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSender.send).toHaveBeenCalledWith(
        'synthesizer:chunk',
        expect.objectContaining({
          done: true,
          fullText: 'Full spec',
          filesAnalyzed: 5
        })
      )
    })

    it('should handle synthesis errors', async () => {
      vi.mocked(specSynthesizer.synthesizeSpec).mockRejectedValue(new Error('Synthesis failed'))

      const handler = handlers.get('synthesizer:generate')!
      await handler({ sender: mockSender }, validGenerateRequest)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSender.send).toHaveBeenCalledWith(
        'synthesizer:chunk',
        expect.objectContaining({
          done: true,
          error: 'Synthesis failed'
        })
      )
    })
  })

  const validReviseRequest = {
    currentSpec: 'Old spec',
    instruction: 'Make it better',
    repo: 'myrepo',
    repoPath: '/repos/myrepo'
  }

  describe('synthesizer:revise', () => {
    it('should return streamId immediately', async () => {
      const handler = handlers.get('synthesizer:revise')!
      const result = await handler({ sender: mockSender }, validReviseRequest)

      expect(result).toMatchObject({ streamId: expect.any(String) })
    })

    it('should call reviseSpec with request', async () => {
      const handler = handlers.get('synthesizer:revise')!
      const req = { ...validReviseRequest, currentSpec: 'Old', instruction: 'Improve' }

      await handler({ sender: mockSender }, req)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(specSynthesizer.reviseSpec).toHaveBeenCalledWith(
        req,
        expect.any(Function),
        expect.any(String)
      )
    })

    it('should stream revised content', async () => {
      const handler = handlers.get('synthesizer:revise')!
      await handler({ sender: mockSender }, validReviseRequest)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSender.send).toHaveBeenCalledWith(
        'synthesizer:chunk',
        expect.objectContaining({
          chunk: 'Revised content',
          done: false
        })
      )
    })
  })

  describe('synthesizer:cancel', () => {
    it('should call cancelSynthesis', async () => {
      const handler = handlers.get('synthesizer:cancel')!

      await handler({}, 'stream-123')

      expect(specSynthesizer.cancelSynthesis).toHaveBeenCalledWith('stream-123')
    })
  })
})
