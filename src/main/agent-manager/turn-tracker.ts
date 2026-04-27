import { getDb } from '../db'
import { insertAgentRunTurn, type TurnRecord } from '../data/agent-queries'
import { createLogger, type Logger } from '../logger'

/**
 * Writes one `agent_run_turns` row. Injecting this instead of a raw `Database`
 * handle lets tests verify the payload without mocking better-sqlite3.
 */
export type InsertTurnFn = (record: TurnRecord) => void

export interface TurnTrackerDeps {
  insertTurn: InsertTurnFn
  logger?: Logger
}

const defaultTurnTrackerDeps: TurnTrackerDeps = {
  insertTurn: (record) => insertAgentRunTurn(getDb(), record)
}

export class TurnTracker {
  private tokensIn = 0
  private tokensOut = 0
  private cacheTokensCreated = 0
  private cacheTokensRead = 0
  private turnCount = 0
  private currentTurnToolCalls = 0
  private readonly insertTurn: InsertTurnFn
  private readonly logger: Logger

  constructor(
    private runId: string,
    deps: TurnTrackerDeps = defaultTurnTrackerDeps
  ) {
    this.insertTurn = deps.insertTurn
    this.logger = deps.logger ?? createLogger('turn-tracker')
  }

  processMessage(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return
    const m = msg as Record<string, unknown>

    // On assistant messages: extract per-turn usage, count tool_use blocks, write turn record.
    // SDK format: usage is at msg.message.usage (not msg.usage — that field is absent or stale).
    // Fallback to msg.usage for forward-compat with CLI or future SDK changes.
    // Cache fields (cache_creation_input_tokens, cache_read_input_tokens) reveal the true
    // context window size — input_tokens alone only counts the non-cached portion.
    if (m.type === 'assistant') {
      const message = m.message as Record<string, unknown> | undefined
      const usage = (message?.usage ?? m.usage) as Record<string, unknown> | null | undefined
      if (usage != null) {
        if (typeof usage.input_tokens === 'number') this.tokensIn += usage.input_tokens
        if (typeof usage.output_tokens === 'number') this.tokensOut += usage.output_tokens
        if (typeof usage.cache_creation_input_tokens === 'number')
          this.cacheTokensCreated += usage.cache_creation_input_tokens
        if (typeof usage.cache_read_input_tokens === 'number')
          this.cacheTokensRead += usage.cache_read_input_tokens
      }

      const content = message?.content ?? m.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === 'object' && block !== null) {
            const b = block as Record<string, unknown>
            if (b.type === 'tool_use') this.currentTurnToolCalls++
          }
        }
      }

      this.turnCount++
      try {
        this.insertTurn({
          runId: this.runId,
          turn: this.turnCount,
          tokensIn: this.tokensIn,
          tokensOut: this.tokensOut,
          toolCalls: this.currentTurnToolCalls,
          cacheTokensCreated: this.cacheTokensCreated,
          cacheTokensRead: this.cacheTokensRead
        })
      } catch (err) {
        // Non-fatal — must not interrupt the agent message loop, but log so migration failures are visible
        this.logger.warn(`Failed to write turn record for run ${this.runId}: ${err}`)
      }
      this.currentTurnToolCalls = 0
    }
  }

  totals(): {
    tokensIn: number
    tokensOut: number
    cacheTokensCreated: number
    cacheTokensRead: number
    turnCount: number
  } {
    return {
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      cacheTokensCreated: this.cacheTokensCreated,
      cacheTokensRead: this.cacheTokensRead,
      turnCount: this.turnCount
    }
  }
}
