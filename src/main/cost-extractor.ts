/**
 * Main-process-safe cost extractor — reads the final "result" event
 * from a Claude agent log file and returns structured cost data.
 */
import { readFileSync } from 'fs'

export interface AgentCostResult {
  costUsd: number
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cacheCreate: number
  durationMs: number
  numTurns: number
}

interface ResultEvent {
  type: 'result'
  total_cost_usd: number
  duration_ms: number
  num_turns: number
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
}

function isResultEvent(obj: unknown): obj is ResultEvent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as Record<string, unknown>).type === 'result'
  )
}

function tryParseJson(line: string): unknown | null {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function findLastResultEvent(lines: string[]): ResultEvent | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    const parsed = tryParseJson(trimmed)
    if (isResultEvent(parsed)) return parsed
  }
  return null
}

function toAgentCostResult(event: ResultEvent): AgentCostResult {
  return {
    costUsd: event.total_cost_usd,
    tokensIn: event.usage.input_tokens,
    tokensOut: event.usage.output_tokens,
    cacheRead: event.usage.cache_read_input_tokens,
    cacheCreate: event.usage.cache_creation_input_tokens,
    durationMs: event.duration_ms,
    numTurns: event.num_turns
  }
}

/**
 * Read an agent log file and extract cost data from the last result event.
 * Returns null if no result event is found (agent crashed before completion).
 */
export function extractAgentCost(logPath: string): AgentCostResult | null {
  const content = readFileSync(logPath, 'utf-8')
  const lines = content.split('\n')
  const event = findLastResultEvent(lines)
  if (!event) return null
  return toAgentCostResult(event)
}
