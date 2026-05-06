/**
 * Encapsulates the streaming IPC protocol used by PlAssistantColumn.
 *
 * The hook owns:
 *   - subscribing to workbench.onChatChunk
 *   - buffering incoming chunks with RAF-throttled flush
 *   - calling workbench.chatStream and surfacing the result
 *   - cleanup on unmount
 *
 * The component depends only on the returned `stream` function and the
 * `isStreaming` flag — it never touches window.api.workbench directly.
 */
import { useRef, useState, useCallback, useEffect } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface FormContext {
  title: string
  repo: string
  spec: string
}

interface StreamOptions {
  messages: ChatMessage[]
  formContext: FormContext
  onChunk: (text: string) => void
  onDone: (fullText: string) => void
  onError: () => void
}

export interface UseWorkbenchChatResult {
  isStreaming: boolean
  stream: (options: StreamOptions) => Promise<void>
}

export function useWorkbenchChat(): UseWorkbenchChatResult {
  const [isStreaming, setIsStreaming] = useState(false)

  const unsubRef = useRef<(() => void) | null>(null)
  const bufferRef = useRef('')
  const rafRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      unsubRef.current?.()
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    },
    []
  )

  const stream = useCallback(async (options: StreamOptions): Promise<void> => {
    const { messages, formContext, onChunk, onDone, onError } = options

    setIsStreaming(true)
    bufferRef.current = ''
    unsubRef.current?.()

    const flushBuffer = (): void => {
      onChunk(bufferRef.current)
    }

    const unsub = window.api.workbench.onChatChunk((data) => {
      if (data.done) {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        onDone(bufferRef.current)
        setIsStreaming(false)
        unsubRef.current = null
        unsub()
        return
      }
      if (data.chunk) {
        bufferRef.current += data.chunk
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            flushBuffer()
          })
        }
      }
    })
    unsubRef.current = unsub

    try {
      await window.api.workbench.chatStream({ messages, formContext })
    } catch {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      onError()
      setIsStreaming(false)
      unsubRef.current = null
      unsub()
    }
  }, [])

  return { isStreaming, stream }
}
