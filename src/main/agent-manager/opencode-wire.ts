/**
 * Pure translation layer: opencode `--format json` stdout lines → Anthropic SDK wire message objects.
 *
 * opencode emits one JSON object per line. Each line describes one event in the agent's
 * execution: a text chunk, a tool call with its result, a step completion, or an error.
 *
 * The Anthropic SDK wire format that `agent-event-mapper.mapRawMessage()` already understands
 * uses three top-level types: `assistant` (text + tool_use blocks), `user` (tool_result blocks),
 * and `result` (cost tracking). We translate into those shapes so the rest of the pipeline
 * needs no changes.
 *
 * This module is intentionally pure — no I/O, no Node.js built-ins, no side effects.
 * Every function takes a value and returns a value.
 */

import { SDKWireMessage } from './sdk-message-protocol'

interface OpencodeTextPart {
  type: 'text'
  text: string
}

interface OpencodeToolState {
  status: string
  input?: Record<string, unknown>
  output?: string
}

interface OpencodeToolPart {
  type: 'tool'
  tool: string
  callID: string
  state: OpencodeToolState
}

interface OpencodeStepFinishPart {
  reason: string
  cost?: number
}

interface OpencodeErrorData {
  message?: string
}

interface OpencodeError {
  data?: OpencodeErrorData
}

interface OpencodeEvent {
  type: string
  part?: OpencodeTextPart | OpencodeToolPart | OpencodeStepFinishPart
  error?: OpencodeError
  sessionID?: string
}

function parseOpencodeEvent(line: string): OpencodeEvent | undefined {
  const trimmed = line.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed) as OpencodeEvent
  } catch {
    return undefined
  }
}

function buildAssistantTextMessage(text: string): SDKWireMessage {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }]
    }
  }
}

function buildAssistantToolUseMessage(
  name: string,
  id: string,
  input: Record<string, unknown>
): SDKWireMessage {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name, id, input }]
    }
  }
}

function buildUserToolResultMessage(
  toolUseId: string,
  content: string,
  isError: boolean
): SDKWireMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }]
    }
  }
}

function translateTextEvent(part: OpencodeTextPart): SDKWireMessage[] {
  if (typeof part?.text !== 'string') return []
  return [buildAssistantTextMessage(part.text)]
}

function translateToolUseEvent(part: OpencodeToolPart): SDKWireMessage[] {
  if (!part?.tool || !part?.callID || !part?.state) return []
  const input = part.state.input ?? {}
  const output = part.state.output ?? ''
  const isError = part.state.status !== 'completed'

  return [
    buildAssistantToolUseMessage(part.tool, part.callID, input),
    buildUserToolResultMessage(part.callID, output, isError)
  ]
}

function translateStepFinishEvent(part: OpencodeStepFinishPart): SDKWireMessage[] {
  if (!part) return []
  if (part.reason !== 'stop') return []
  return [{ type: 'result', cost_usd: part.cost ?? 0, stop_reason: 'end_turn' }]
}

function translateErrorEvent(error: OpencodeError): SDKWireMessage[] {
  const message = error.data?.message ?? 'Unknown error'
  return [buildAssistantTextMessage(`Error: ${message}`)]
}

/**
 * Translates one line of `opencode run --format json` stdout into zero or more
 * Anthropic SDK wire message objects that `agent-event-mapper.mapRawMessage()` can consume.
 *
 * Returns an empty array for unrecognized event types, invalid JSON, and empty lines.
 */
export function translateOpencodeEvent(line: string): SDKWireMessage[] {
  const event = parseOpencodeEvent(line)
  if (event === undefined) return []

  switch (event.type) {
    case 'text':
      return translateTextEvent(event.part as OpencodeTextPart)
    case 'tool':
      return translateToolUseEvent(event.part as OpencodeToolPart)
    case 'step_finish':
      return translateStepFinishEvent(event.part as OpencodeStepFinishPart)
    case 'error':
      return event.error !== undefined ? translateErrorEvent(event.error) : []
    default:
      return []
  }
}

/**
 * Extracts the `sessionID` string from one line of opencode JSON output.
 * Returns `undefined` if the line is invalid JSON or if `sessionID` is absent.
 */
export function extractOpencodeSessionId(line: string): string | undefined {
  const event = parseOpencodeEvent(line)
  if (event === undefined) return undefined
  const sessionId = event.sessionID
  return typeof sessionId === 'string' ? sessionId : undefined
}
