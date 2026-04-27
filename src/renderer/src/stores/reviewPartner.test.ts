import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useReviewPartnerStore } from './reviewPartner'

describe('useReviewPartnerStore', () => {
  const localStorageMock = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn()
  }

  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock)
    vi.clearAllMocks()
    // Reset store state between tests
    useReviewPartnerStore.setState({
      panelOpen: false,
      reviewByTask: {},
      messagesByTask: {},
      activeStreamByTask: {}
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
      useReviewPartnerStore.setState({
        messagesByTask: {
          'task-1': [{ id: '1', role: 'user', content: 'x', timestamp: 0 }]
        }
      })
      useReviewPartnerStore.getState().clearMessages('task-1')
      expect(useReviewPartnerStore.getState().messagesByTask['task-1']).toEqual([])
      // Verify localStorage was touched with the cleared state
      const calls = localStorageMock.setItem.mock.calls.filter(
        ([key]) => key === 'fleet:review-partner-messages'
      )
      expect(calls.length).toBeGreaterThan(0)
    })
  })
})
