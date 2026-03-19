import { BrowserWindow } from 'electron'
import { getTaskRunnerConfig } from './config'

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

let abortController: AbortController | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0

export function startSprintSseClient(): void {
  connect()
}

export function stopSprintSseClient(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  reconnectAttempt = 0
}

async function connect(): Promise<void> {
  const config = getTaskRunnerConfig()
  if (!config) {
    console.warn('Task runner not configured — skipping SSE')
    return
  }

  abortController = new AbortController()
  const { signal } = abortController

  try {
    const res = await fetch(config.url + '/events', {
      signal,
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${config.apiKey}`
      }
    })

    if (!res.ok || !res.body) {
      notifyDisconnected()
      scheduleReconnect()
      return
    }

    // Successful connection — reset backoff
    reconnectAttempt = 0

    const decoder = new TextDecoder()
    const reader = res.body.getReader()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const { parsed, remainder } = parseSSE(buffer)
      buffer = remainder

      for (const event of parsed) {
        notifyRenderer(event)
      }
    }

    notifyDisconnected()
    scheduleReconnect()
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    notifyDisconnected()
    scheduleReconnect()
  }
}

function scheduleReconnect(): void {
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS)
  reconnectAttempt++
  reconnectTimer = setTimeout(connect, delay)
}

export function parseSSE(buffer: string): {
  parsed: { type: string; data: unknown }[]
  remainder: string
} {
  const parsed: { type: string; data: unknown }[] = []
  const blocks = buffer.split('\n\n')
  const remainder = blocks.pop() ?? ''

  for (const block of blocks) {
    let eventType = 'message'
    let dataLine: string | undefined

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLine = line.slice(5).trim()
      }
    }

    if (dataLine === undefined) continue

    try {
      parsed.push({ type: eventType, data: JSON.parse(dataLine) })
    } catch {
      // Unparseable events are silently skipped
    }
  }

  return { parsed, remainder }
}

function notifyRenderer(event: { type: string; data: unknown }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sprint:sseEvent', event)
  }
}

/**
 * Tell the renderer that the SSE connection dropped, so it can reset its
 * connected flag and re-subscribe when the connection comes back.
 */
function notifyDisconnected(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sprint:sseEvent', { type: '__sse-disconnected', data: null })
  }
}
