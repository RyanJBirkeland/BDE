import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useReviewPartnerStore } from './reviewPartner'
import type { ReviewResult, ChatChunk } from '../../../shared/types'

function freshResult(): ReviewResult {
  return {
    qualityScore: 90,
    issuesCount: 2,
    filesCount: 3,
    openingMessage: 'Nice work overall.',
    findings: { perFile: [] },
    model: 'claude-opus-4-6',
    createdAt: Date.now(),
  }
}

// Ambient mock for window.api.review — set per test
function mockApi(overrides: Partial<any> = {}) {
  const api: any = {
    review: {
      autoReview: vi.fn().mockResolvedValue(freshResult()),
      chatStream: vi.fn().mockResolvedValue({ streamId: 'stream-1' }),
      onChatChunk: vi.fn().mockReturnValue(() => {}),
      abortChat: vi.fn().mockResolvedValue(undefined),
      ...overrides.review,
    },
  }
  ;(window as any).api = api
  return api
}

describe('useReviewPartnerStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useReviewPartnerStore.setState({
      panelOpen: false,
      reviewByTask: {},
      messagesByTask: {},
      activeStreamByTask: {},
    })
  })

  describe('panel toggle', () => {
    it('flips panelOpen', () => {
      useReviewPartnerStore.getState().togglePanel()
      expect(useReviewPartnerStore.getState().panelOpen).toBe(true)
      useReviewPartnerStore.getState().togglePanel()
      expect(useReviewPartnerStore.getState().panelOpen).toBe(false)
    })
  })

  describe('autoReview', () => {
    it('transitions idle → loading → ready and stores the result', async () => {
      mockApi()
      const states: string[] = []
      const unsub = useReviewPartnerStore.subscribe((s) => {
        const st = s.reviewByTask['task-1']?.status
        if (st) states.push(st)
      })
      await useReviewPartnerStore.getState().autoReview('task-1')
      unsub()
      expect(states).toContain('loading')
      const final = useReviewPartnerStore.getState().reviewByTask['task-1']
      expect(final?.status).toBe('ready')
      expect(final?.result?.qualityScore).toBe(90)
    })

    it('sets status:error when autoReview rejects', async () => {
      mockApi({ review: { autoReview: vi.fn().mockRejectedValue(new Error('boom')) } })
      await useReviewPartnerStore.getState().autoReview('task-1')
      const final = useReviewPartnerStore.getState().reviewByTask['task-1']
      expect(final?.status).toBe('error')
      expect(final?.error).toContain('boom')
    })

    it('seeds messagesByTask with the opening message on first success', async () => {
      mockApi()
      await useReviewPartnerStore.getState().autoReview('task-1')
      const msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs).toHaveLength(1)
      expect(msgs[0]?.role).toBe('assistant')
      expect(msgs[0]?.content).toBe('Nice work overall.')
    })

    it('does not re-seed the opening message if user has already added messages', async () => {
      mockApi()
      useReviewPartnerStore.setState({
        messagesByTask: {
          'task-1': [
            { id: 'u1', role: 'user', content: 'Hi', timestamp: 0 },
            { id: 'a1', role: 'assistant', content: 'Hello', timestamp: 1 },
          ],
        },
      })
      await useReviewPartnerStore.getState().autoReview('task-1')
      const msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs).toHaveLength(2)
      expect(msgs[0]?.content).toBe('Hi')
    })

    // Note: after clearMessages(taskId), messagesByTask[taskId] becomes [],
    // so a subsequent autoReview (triggered by "Re-review") WILL re-seed the
    // opening message. This is intentional — "Clear thread" is meant to give
    // the user a fresh start, and seeding the new review is part of that.
    it('re-seeds opening message after clearMessages', async () => {
      mockApi()
      useReviewPartnerStore.setState({
        messagesByTask: {
          'task-1': [
            { id: 'u1', role: 'user', content: 'Old', timestamp: 0 },
          ],
        },
      })
      useReviewPartnerStore.getState().clearMessages('task-1')
      await useReviewPartnerStore.getState().autoReview('task-1')
      const msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs).toHaveLength(1)
      expect(msgs[0]?.role).toBe('assistant')
      expect(msgs[0]?.content).toBe('Nice work overall.')
    })
  })

  describe('sendMessage', () => {
    it('appends a user message and a streaming assistant message', async () => {
      const chunkListeners: Array<(e: unknown, c: ChatChunk) => void> = []
      mockApi({
        review: {
          autoReview: vi.fn().mockResolvedValue(freshResult()),
          chatStream: vi.fn().mockResolvedValue({ streamId: 's-1' }),
          onChatChunk: vi.fn((cb: any) => {
            chunkListeners.push(cb)
            return () => {}
          }),
          abortChat: vi.fn().mockResolvedValue(undefined),
        },
      })
      await useReviewPartnerStore.getState().sendMessage('task-1', 'What are the risks?')

      let msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs).toHaveLength(2)
      expect(msgs[0]?.role).toBe('user')
      expect(msgs[0]?.content).toBe('What are the risks?')
      expect(msgs[1]?.role).toBe('assistant')
      expect(msgs[1]?.streaming).toBe(true)

      // Simulate streamed chunks
      chunkListeners[0]?.({}, { streamId: 's-1', chunk: 'The ' })
      chunkListeners[0]?.({}, { streamId: 's-1', chunk: 'risks are…' })
      chunkListeners[0]?.({}, { streamId: 's-1', done: true, fullText: 'The risks are…' })

      msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs[1]?.content).toBe('The risks are…')
      expect(msgs[1]?.streaming).toBeFalsy()
    })

    it('sets error text on the streaming message when an error chunk arrives', async () => {
      const chunkListeners: Array<(e: unknown, c: ChatChunk) => void> = []
      mockApi({
        review: {
          autoReview: vi.fn(),
          chatStream: vi.fn().mockResolvedValue({ streamId: 's-2' }),
          onChatChunk: vi.fn((cb: any) => {
            chunkListeners.push(cb)
            return () => {}
          }),
          abortChat: vi.fn(),
        },
      })
      await useReviewPartnerStore.getState().sendMessage('task-1', 'Hi')
      chunkListeners[0]?.({}, { streamId: 's-2', error: 'Claude Code rate limit reached.' })
      const msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs[1]?.content).toContain('rate limit')
      expect(msgs[1]?.streaming).toBeFalsy()
    })

    it('ignores chunks with mismatched streamId', async () => {
      const chunkListeners: Array<(e: unknown, c: ChatChunk) => void> = []
      mockApi({
        review: {
          autoReview: vi.fn(),
          chatStream: vi.fn().mockResolvedValue({ streamId: 's-A' }),
          onChatChunk: vi.fn((cb: any) => {
            chunkListeners.push(cb)
            return () => {}
          }),
          abortChat: vi.fn().mockResolvedValue(undefined),
        },
      })
      await useReviewPartnerStore.getState().sendMessage('task-1', 'Hi')
      // Chunk from a different stream — should be dropped
      chunkListeners[0]?.({}, { streamId: 's-OTHER', chunk: 'contamination' })
      // Chunk from the correct stream — should be applied
      chunkListeners[0]?.({}, { streamId: 's-A', chunk: 'real ' })
      chunkListeners[0]?.({}, { streamId: 's-A', done: true, fullText: 'real answer' })

      const msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs[1]?.content).toBe('real answer')
      expect(msgs[1]?.content).not.toContain('contamination')
    })
  })

  describe('abortStream', () => {
    it('invokes the onChatChunk unsubscribe to prevent listener leak', async () => {
      const unsubscribe = vi.fn()
      mockApi({
        review: {
          autoReview: vi.fn(),
          chatStream: vi.fn().mockResolvedValue({ streamId: 's-A' }),
          onChatChunk: vi.fn(() => unsubscribe),
          abortChat: vi.fn().mockResolvedValue(undefined),
        },
      })
      await useReviewPartnerStore.getState().sendMessage('task-1', 'Hi')
      // Seed activeStreamByTask so abortStream sees an active stream
      useReviewPartnerStore.setState({ activeStreamByTask: { 'task-1': 's-A' } })
      await useReviewPartnerStore.getState().abortStream('task-1')
      expect(unsubscribe).toHaveBeenCalled()
    })
  })

  describe('clearMessages', () => {
    it('removes all messages for a task and persists the clear', () => {
      const setItem = vi.spyOn(globalThis.localStorage, 'setItem')
      useReviewPartnerStore.setState({
        messagesByTask: {
          'task-1': [{ id: '1', role: 'user', content: 'x', timestamp: 0 }],
        },
      })
      useReviewPartnerStore.getState().clearMessages('task-1')
      expect(useReviewPartnerStore.getState().messagesByTask['task-1']).toEqual([])
      // Verify localStorage was touched with the cleared state
      const calls = setItem.mock.calls.filter(
        ([key]) => key === 'bde:review-partner-messages'
      )
      expect(calls.length).toBeGreaterThan(0)
      setItem.mockRestore()
    })
  })
})
