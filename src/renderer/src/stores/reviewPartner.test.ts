import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useReviewPartnerStore } from './reviewPartner'

describe('useReviewPartnerStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useReviewPartnerStore.setState({
      panelOpen: false,
      reviewByTask: {},
      messagesByTask: {},
      activeStreamByTask: {}
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

  describe('clearMessages', () => {
    it('removes all messages for a task and persists the clear', () => {
      const setItem = vi.spyOn(globalThis.localStorage, 'setItem')
      useReviewPartnerStore.setState({
        messagesByTask: {
          'task-1': [{ id: '1', role: 'user', content: 'x', timestamp: 0 }]
        }
      })
      useReviewPartnerStore.getState().clearMessages('task-1')
      expect(useReviewPartnerStore.getState().messagesByTask['task-1']).toEqual([])
      // Verify localStorage was touched with the cleared state
      const calls = setItem.mock.calls.filter(([key]) => key === 'bde:review-partner-messages')
      expect(calls.length).toBeGreaterThan(0)
      setItem.mockRestore()
    })
  })
})
