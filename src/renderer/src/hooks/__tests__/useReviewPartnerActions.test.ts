import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useReviewPartnerActions } from '../useReviewPartnerActions'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import type { ReviewResult, ChatChunk } from '../../../../shared/types'

describe('useReviewPartnerActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useReviewPartnerStore.setState({
      panelOpen: false,
      reviewByTask: {},
      messagesByTask: {},
      activeStreamByTask: {}
    })

    // Mock window.api.review
    ;(window as any).api = {
      review: {
        autoReview: vi.fn(),
        chatStream: vi.fn(),
        onChatChunk: vi.fn(),
        abortChat: vi.fn()
      }
    }
  })

  describe('autoReview', () => {
    it('should transition to loading then ready on success', async () => {
      const mockResult: ReviewResult = {
        openingMessage: 'Review complete',
        qualityScore: 85,
        issuesCount: 2,
        filesCount: 5,
        findings: { perFile: [] },
        model: 'claude-opus-4-6',
        createdAt: Date.now()
      }

      vi.mocked(window.api.review.autoReview).mockResolvedValue(mockResult)

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.autoReview('task-1')

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        expect(state.reviewByTask['task-1']?.status).toBe('ready')
        expect(state.reviewByTask['task-1']?.result).toEqual(mockResult)
      })
    })

    it('should transition to error on failure', async () => {
      vi.mocked(window.api.review.autoReview).mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.autoReview('task-1')

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        expect(state.reviewByTask['task-1']?.status).toBe('error')
        expect(state.reviewByTask['task-1']?.error).toBe('Network error')
      })
    })

    it('should not start review if already loading', async () => {
      useReviewPartnerStore.setState({
        reviewByTask: { 'task-1': { status: 'loading' } }
      })

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.autoReview('task-1')

      expect(window.api.review.autoReview).not.toHaveBeenCalled()
    })

    it('should seed opening message if no prior messages exist', async () => {
      const mockResult: ReviewResult = {
        openingMessage: 'Hello from AI',
        qualityScore: 90,
        issuesCount: 0,
        filesCount: 3,
        findings: { perFile: [] },
        model: 'claude-opus-4-6',
        createdAt: Date.now()
      }

      vi.mocked(window.api.review.autoReview).mockResolvedValue(mockResult)

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.autoReview('task-1')

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        const messages = state.messagesByTask['task-1']
        expect(messages).toHaveLength(1)
        expect(messages![0].role).toBe('assistant')
        expect(messages![0].content).toBe('Hello from AI')
      })
    })

    it('should not overwrite existing messages on re-review', async () => {
      useReviewPartnerStore.setState({
        messagesByTask: {
          'task-1': [{ id: 'msg-1', role: 'user', content: 'Prior chat', timestamp: Date.now() }]
        }
      })

      const mockResult: ReviewResult = {
        openingMessage: 'New review',
        qualityScore: 88,
        issuesCount: 1,
        filesCount: 2,
        findings: { perFile: [] },
        model: 'claude-opus-4-6',
        createdAt: Date.now()
      }

      vi.mocked(window.api.review.autoReview).mockResolvedValue(mockResult)

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.autoReview('task-1')

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        const messages = state.messagesByTask['task-1']
        expect(messages).toHaveLength(1)
        expect(messages![0].content).toBe('Prior chat')
      })
    })
  })

  describe('sendMessage', () => {
    it('should assemble user and streaming messages correctly', async () => {
      let capturedChunkHandler: ((e: unknown, chunk: ChatChunk) => void) | null = null

      vi.mocked(window.api.review.onChatChunk).mockImplementation((handler) => {
        capturedChunkHandler = handler
        return vi.fn() // unsubscribe function
      })

      vi.mocked(window.api.review.chatStream).mockResolvedValue({ streamId: 'stream-1' })

      const { result } = renderHook(() => useReviewPartnerActions())
      const sendPromise = result.current.sendMessage('task-1', 'What are the risks?')

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        const messages = state.messagesByTask['task-1']
        expect(messages).toHaveLength(2)
        expect(messages![0].role).toBe('user')
        expect(messages![0].content).toBe('What are the risks?')
        expect(messages![1].role).toBe('assistant')
        expect(messages![1].content).toBe('')
        expect(messages![1].streaming).toBe(true)
      })

      await sendPromise

      expect(capturedChunkHandler).toBeTruthy()
    })

    it('should update streaming message on chunk', async () => {
      let capturedChunkHandler: ((e: unknown, chunk: ChatChunk) => void) | null = null

      vi.mocked(window.api.review.onChatChunk).mockImplementation((handler) => {
        capturedChunkHandler = handler
        return vi.fn()
      })

      vi.mocked(window.api.review.chatStream).mockResolvedValue({ streamId: 'stream-1' })

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.sendMessage('task-1', 'Hi')

      capturedChunkHandler!(null, { streamId: 'stream-1', chunk: 'Hello' })

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        const updated = state.messagesByTask['task-1']![1]
        expect(updated.content).toBe('Hello')
        expect(updated.streaming).toBe(true)
      })

      capturedChunkHandler!(null, { streamId: 'stream-1', chunk: ' there' })

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        const updated = state.messagesByTask['task-1']![1]
        expect(updated.content).toBe('Hello there')
      })
    })

    it('should finalize streaming message on done', async () => {
      let capturedChunkHandler: ((e: unknown, chunk: ChatChunk) => void) | null = null

      vi.mocked(window.api.review.onChatChunk).mockImplementation((handler) => {
        capturedChunkHandler = handler
        return vi.fn()
      })

      vi.mocked(window.api.review.chatStream).mockResolvedValue({ streamId: 'stream-1' })

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.sendMessage('task-1', 'Hi')

      capturedChunkHandler!(null, {
        streamId: 'stream-1',
        done: true,
        fullText: 'Final answer'
      })

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        const msg = state.messagesByTask['task-1']![1]
        expect(msg.content).toBe('Final answer')
        expect(msg.streaming).toBe(false)
        expect(state.activeStreamByTask['task-1']).toBeNull()
      })
    })

    it('should handle stream errors gracefully', async () => {
      let capturedChunkHandler: ((e: unknown, chunk: ChatChunk) => void) | null = null

      vi.mocked(window.api.review.onChatChunk).mockImplementation((handler) => {
        capturedChunkHandler = handler
        return vi.fn()
      })

      vi.mocked(window.api.review.chatStream).mockResolvedValue({ streamId: 'stream-1' })

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.sendMessage('task-1', 'Hi')

      capturedChunkHandler!(null, {
        streamId: 'stream-1',
        error: 'Stream failed'
      })

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        const msg = state.messagesByTask['task-1']![1]
        expect(msg.content).toContain('Error: Stream failed')
        expect(msg.streaming).toBe(false)
      })
    })
  })

  describe('abortStream', () => {
    it('should call IPC abort and clear stream ID', async () => {
      useReviewPartnerStore.setState({
        activeStreamByTask: { 'task-1': 'stream-1' },
        messagesByTask: {
          'task-1': [
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Partial',
              timestamp: Date.now(),
              streaming: true
            }
          ]
        }
      })

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.abortStream('task-1')

      expect(window.api.review.abortChat).toHaveBeenCalledWith('stream-1')

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        expect(state.activeStreamByTask['task-1']).toBeNull()
        expect(state.messagesByTask['task-1']![0].streaming).toBe(false)
      })
    })

    it('should do nothing if no active stream', async () => {
      useReviewPartnerStore.setState({
        activeStreamByTask: { 'task-1': null }
      })

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.abortStream('task-1')

      expect(window.api.review.abortChat).not.toHaveBeenCalled()
    })
  })

  describe('appendQuickAction', () => {
    it('should delegate to sendMessage', async () => {
      vi.mocked(window.api.review.onChatChunk).mockReturnValue(vi.fn())
      vi.mocked(window.api.review.chatStream).mockResolvedValue({ streamId: 'stream-1' })

      const { result } = renderHook(() => useReviewPartnerActions())
      await result.current.appendQuickAction('task-1', 'Quick prompt')

      await waitFor(() => {
        const messages = useReviewPartnerStore.getState().messagesByTask['task-1']
        expect(messages![0].content).toBe('Quick prompt')
      })
    })
  })

  describe('concurrent stream cancellation', () => {
    it('should handle new taskId before previous stream completes', async () => {
      let handler1: ((e: unknown, chunk: ChatChunk) => void) | null = null
      let handler2: ((e: unknown, chunk: ChatChunk) => void) | null = null

      vi.mocked(window.api.review.onChatChunk)
        .mockImplementationOnce((h) => {
          handler1 = h
          return vi.fn()
        })
        .mockImplementationOnce((h) => {
          handler2 = h
          return vi.fn()
        })

      vi.mocked(window.api.review.chatStream)
        .mockResolvedValueOnce({ streamId: 'stream-1' })
        .mockResolvedValueOnce({ streamId: 'stream-2' })

      const { result } = renderHook(() => useReviewPartnerActions())

      await result.current.sendMessage('task-1', 'First message')
      await result.current.sendMessage('task-2', 'Second message')

      handler1!(null, { streamId: 'stream-1', chunk: 'Task 1 chunk' })
      handler2!(null, { streamId: 'stream-2', chunk: 'Task 2 chunk' })

      await waitFor(() => {
        const state = useReviewPartnerStore.getState()
        expect(state.messagesByTask['task-1']![1].content).toBe('Task 1 chunk')
        expect(state.messagesByTask['task-2']![1].content).toBe('Task 2 chunk')
      })
    })
  })
})
