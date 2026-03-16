/**
 * Stream-JSON parser for Claude agent log output.
 * Parses newline-delimited JSON events from --output-format stream-json.
 */

export interface ChatItemText {
  kind: 'text'
  text: string
}

export interface ChatItemToolUse {
  kind: 'tool_use'
  id: string
  name: string
  input: string
}

export interface ChatItemToolResult {
  kind: 'tool_result'
  toolUseId: string
  content: string
}

export interface ChatItemResult {
  kind: 'result'
  subtype: string
  result: string
  costUsd: number | null
}

export interface ChatItemPlain {
  kind: 'plain'
  text: string
}

export type ChatItem = ChatItemText | ChatItemToolUse | ChatItemToolResult | ChatItemResult | ChatItemPlain

export function parseStreamJson(raw: string): { items: ChatItem[]; isStreaming: boolean } {
  const lines = raw.split('\n')
  const items: ChatItem[] = []
  let currentText = ''
  let hasMessageStop = false
  let hasResult = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let outer: Record<string, unknown>
    try {
      outer = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      // Not valid JSON — render as plain text fallback
      items.push({ kind: 'plain', text: trimmed })
      continue
    }

    // --output-format stream-json wraps each SDK event in { type: "stream_event", event: {...} }
    // Unwrap to get the inner event for unified handling
    const parsed: Record<string, unknown> =
      outer.type === 'stream_event' && outer.event && typeof outer.event === 'object'
        ? (outer.event as Record<string, unknown>)
        : outer

    const type = parsed.type as string | undefined

    switch (type) {
      case 'content_block_delta': {
        const delta = parsed.delta as Record<string, unknown> | undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          currentText += delta.text
        }
        break
      }

      case 'content_block_stop': {
        if (currentText) {
          items.push({ kind: 'text', text: currentText })
          currentText = ''
        }
        break
      }

      case 'tool_use': {
        // Flush any accumulated text before a tool call
        if (currentText) {
          items.push({ kind: 'text', text: currentText })
          currentText = ''
        }
        const inputRaw = parsed.input
        let inputStr: string
        if (typeof inputRaw === 'string') {
          inputStr = inputRaw
        } else if (inputRaw && typeof inputRaw === 'object') {
          inputStr = JSON.stringify(inputRaw, null, 2)
        } else {
          inputStr = ''
        }
        items.push({
          kind: 'tool_use',
          id: String(parsed.id ?? ''),
          name: String(parsed.name ?? 'tool'),
          input: inputStr
        })
        break
      }

      case 'tool_result': {
        const content = parsed.content
        items.push({
          kind: 'tool_result',
          toolUseId: String(parsed.tool_use_id ?? ''),
          content: typeof content === 'string' ? content : JSON.stringify(content ?? '')
        })
        break
      }

      case 'result': {
        // Flush text
        if (currentText) {
          items.push({ kind: 'text', text: currentText })
          currentText = ''
        }
        const costRaw = parsed.cost_usd
        items.push({
          kind: 'result',
          subtype: String(parsed.subtype ?? ''),
          result: String(parsed.result ?? ''),
          costUsd: typeof costRaw === 'number' ? costRaw : null
        })
        hasResult = true
        break
      }

      case 'message_stop':
        hasMessageStop = true
        break

      case 'content_block_start': {
        // Tool use blocks announced here in stream-json format
        const block = parsed.content_block as Record<string, unknown> | undefined
        if (block?.type === 'tool_use') {
          if (currentText) {
            items.push({ kind: 'text', text: currentText })
            currentText = ''
          }
          const inputRaw = block.input
          const inputStr = inputRaw && typeof inputRaw === 'object'
            ? JSON.stringify(inputRaw, null, 2)
            : typeof inputRaw === 'string' ? inputRaw : ''
          // Only push if input is non-empty (it often fills in via input_json_delta)
          items.push({
            kind: 'tool_use',
            id: String(block.id ?? ''),
            name: String(block.name ?? 'tool'),
            input: inputStr
          })
        }
        break
      }

      // message_start — no-op
      default:
        break
    }
  }

  // Flush any trailing accumulated text (still streaming)
  if (currentText) {
    items.push({ kind: 'text', text: currentText })
  }

  const isStreaming = !hasMessageStop && !hasResult && items.length > 0

  return { items, isStreaming }
}
