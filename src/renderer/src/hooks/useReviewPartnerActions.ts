import { useRef } from 'react'
import { useReviewPartnerStore } from '../stores/reviewPartner'
import type { PartnerMessage, ChatChunk } from '../../../shared/types'

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function saveMessages(messagesByTask: Record<string, PartnerMessage[]>): void {
  const MESSAGES_STORAGE_KEY = 'bde:review-partner-messages'
  const MAX_MESSAGES_PER_TASK = 100
  const MAX_TASKS_IN_LOCAL_STORAGE = 20

  try {
    const lruOrder = Object.keys(messagesByTask)
    const trimmed: Record<string, PartnerMessage[]> = {}
    const keepIds = lruOrder.slice(-MAX_TASKS_IN_LOCAL_STORAGE)
    for (const id of keepIds) {
      const msgs = messagesByTask[id] ?? []
      trimmed[id] = msgs.slice(-MAX_MESSAGES_PER_TASK)
    }
    localStorage.setItem(
      MESSAGES_STORAGE_KEY,
      JSON.stringify({ messagesByTask: trimmed, lruOrder: keepIds })
    )
  } catch {
    // localStorage full or unavailable — swallow
  }
}

/**
 * Hook for Review Partner IPC actions.
 * Owns all window.api.review.* calls and subscription lifecycle.
 * Updates the reviewPartner store state; components read state from the store.
 */
export function useReviewPartnerActions(): {
  autoReview: (taskId: string, opts?: { force?: boolean }) => Promise<void>
  sendMessage: (taskId: string, content: string) => Promise<void>
  abortStream: (taskId: string) => Promise<void>
  appendQuickAction: (taskId: string, prompt: string) => Promise<void>
} {
  // Subscription map scoped to React lifecycle (not module-level)
  const chunkUnsubscribeByTask = useRef<Map<string, () => void>>(new Map())

  const autoReview = async (taskId: string, opts?: { force?: boolean }): Promise<void> => {
    const store = useReviewPartnerStore.getState()
    const prev = store.reviewByTask[taskId]
    if (prev?.status === 'loading') return

    useReviewPartnerStore.setState((s) => ({
      reviewByTask: { ...s.reviewByTask, [taskId]: { status: 'loading' } }
    }))

    try {
      const result = await window.api.review.autoReview(taskId, opts?.force ?? false)
      useReviewPartnerStore.setState((s) => {
        const existingMessages = s.messagesByTask[taskId] ?? []
        // Only seed if the user hasn't started a conversation yet
        const messages =
          existingMessages.length === 0
            ? [
                {
                  id: newId('seed'),
                  role: 'assistant' as const,
                  content: result.openingMessage,
                  timestamp: Date.now()
                }
              ]
            : existingMessages
        const nextMsgs = { ...s.messagesByTask, [taskId]: messages }
        saveMessages(nextMsgs)
        return {
          reviewByTask: { ...s.reviewByTask, [taskId]: { status: 'ready', result } },
          messagesByTask: nextMsgs
        }
      })
    } catch (err) {
      useReviewPartnerStore.setState((s) => ({
        reviewByTask: {
          ...s.reviewByTask,
          [taskId]: { status: 'error', error: (err as Error).message }
        }
      }))
    }
  }

  const sendMessage = async (taskId: string, content: string): Promise<void> => {
    const userMsg: PartnerMessage = {
      id: newId('u'),
      role: 'user',
      content,
      timestamp: Date.now()
    }
    const streamingMsg: PartnerMessage = {
      id: newId('a'),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true
    }

    useReviewPartnerStore.setState((s) => {
      const prior = s.messagesByTask[taskId] ?? []
      const next = [...prior, userMsg, streamingMsg]
      const nextMsgs = { ...s.messagesByTask, [taskId]: next }
      saveMessages(nextMsgs)
      return { messagesByTask: nextMsgs }
    })

    let unsubscribe: (() => void) | null = null
    try {
      // Subscribe BEFORE invoking chatStream so we don't miss early chunks.
      let streamId: string | null = null

      unsubscribe = window.api.review.onChatChunk((_e: unknown, chunk: ChatChunk) => {
        if (!streamId || chunk.streamId !== streamId) return
        useReviewPartnerStore.setState((s) => {
          const msgs = [...(s.messagesByTask[taskId] ?? [])]
          const last = msgs[msgs.length - 1]
          if (!last || last.id !== streamingMsg.id) return s

          if (chunk.error) {
            msgs[msgs.length - 1] = {
              ...last,
              content: (last.content ? last.content + '\n\n' : '') + `Error: ${chunk.error}`,
              streaming: false
            }
          } else if (chunk.done) {
            msgs[msgs.length - 1] = {
              ...last,
              content: chunk.fullText ?? last.content,
              streaming: false
            }
          } else if (chunk.chunk) {
            msgs[msgs.length - 1] = { ...last, content: last.content + chunk.chunk }
          }

          const nextMsgs = { ...s.messagesByTask, [taskId]: msgs }
          saveMessages(nextMsgs)

          let activeStreamByTask = s.activeStreamByTask
          if (chunk.done || chunk.error) {
            activeStreamByTask = { ...s.activeStreamByTask, [taskId]: null }
            unsubscribe?.()
            chunkUnsubscribeByTask.current.delete(taskId)
          }
          return { messagesByTask: nextMsgs, activeStreamByTask }
        })
      })
      chunkUnsubscribeByTask.current.set(taskId, () => unsubscribe?.())

      const messages = (useReviewPartnerStore.getState().messagesByTask[taskId] ?? []).slice(0, -1) // exclude the empty streaming msg
      const { streamId: sid } = await window.api.review.chatStream({ taskId, messages })
      streamId = sid
      useReviewPartnerStore.setState((s) => ({
        activeStreamByTask: { ...s.activeStreamByTask, [taskId]: streamId }
      }))
    } catch (err) {
      useReviewPartnerStore.setState((s) => {
        const msgs = [...(s.messagesByTask[taskId] ?? [])]
        const last = msgs[msgs.length - 1]
        if (last && last.id === streamingMsg.id) {
          msgs[msgs.length - 1] = {
            ...last,
            content: `Error: ${(err as Error).message}`,
            streaming: false
          }
        }
        return { messagesByTask: { ...s.messagesByTask, [taskId]: msgs } }
      })
      unsubscribe?.()
    }
  }

  const abortStream = async (taskId: string): Promise<void> => {
    const store = useReviewPartnerStore.getState()
    const streamId = store.activeStreamByTask[taskId]
    if (!streamId) return

    useReviewPartnerStore.setState((s) => {
      const msgs = [...(s.messagesByTask[taskId] ?? [])]
      const last = msgs[msgs.length - 1]
      if (last?.streaming) {
        msgs[msgs.length - 1] = { ...last, streaming: false }
      }
      return {
        messagesByTask: { ...s.messagesByTask, [taskId]: msgs },
        activeStreamByTask: { ...s.activeStreamByTask, [taskId]: null }
      }
    })

    const unsub = chunkUnsubscribeByTask.current.get(taskId)
    if (unsub) {
      unsub()
      chunkUnsubscribeByTask.current.delete(taskId)
    }
    await window.api.review.abortChat(streamId)
  }

  const appendQuickAction = async (taskId: string, prompt: string): Promise<void> => {
    await sendMessage(taskId, prompt)
  }

  return {
    autoReview,
    sendMessage,
    abortStream,
    appendQuickAction
  }
}
