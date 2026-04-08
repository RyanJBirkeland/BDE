import { getDb } from '../db'
import { insertAgentRunTurn } from '../data/agent-queries'

export class TurnTracker {
  private tokensIn = 0
  private tokensOut = 0
  private turnCount = 0
  private currentTurnToolCalls = 0

  constructor(
    private runId: string,
    private db?: import('better-sqlite3').Database
  ) {}

  observe(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return
    const m = msg as Record<string, unknown>

    // Accumulate from top-level fields (result/system messages)
    if (typeof m.tokens_in === 'number') this.tokensIn += m.tokens_in
    if (typeof m.tokens_out === 'number') this.tokensOut += m.tokens_out

    // Accumulate from nested usage object (assistant messages)
    if (typeof m.usage === 'object' && m.usage !== null) {
      const u = m.usage as Record<string, unknown>
      if (typeof u.input_tokens === 'number') this.tokensIn += u.input_tokens
      if (typeof u.output_tokens === 'number') this.tokensOut += u.output_tokens
    }

    // On assistant messages: count tool_use blocks, write turn record, reset per-turn counter
    if (m.type === 'assistant') {
      const message = m.message as Record<string, unknown> | undefined
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
        insertAgentRunTurn(this.db ?? getDb(), {
          runId: this.runId,
          turn: this.turnCount,
          tokensIn: this.tokensIn,
          tokensOut: this.tokensOut,
          toolCalls: this.currentTurnToolCalls
        })
      } catch (err) {
        // Non-fatal — must not interrupt the agent message loop, but log so migration failures are visible
        console.warn(`[turn-tracker] Failed to write turn record for run ${this.runId}:`, err)
      }
      this.currentTurnToolCalls = 0
    }
  }

  totals(): { tokensIn: number; tokensOut: number } {
    return { tokensIn: this.tokensIn, tokensOut: this.tokensOut }
  }
}
