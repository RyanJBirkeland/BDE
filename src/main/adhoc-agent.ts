/**
 * Ad-hoc agent spawning — launches interactive Claude sessions via SDK v2 Session API.
 *
 * Uses unstable_v2_createSession() for multi-turn conversations. The key insight:
 * session.stream() yields messages for ONE turn, then returns on 'result' message.
 * For multi-turn, we call stream() again after each send(). The queryIterator is
 * preserved across calls so messages continue from where the previous turn left off.
 */
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { importAgent, updateAgentMeta } from './agent-history'
import { buildAgentEnvWithAuth } from './env-utils'
import { mapRawMessage, emitAgentEvent } from './agent-event-mapper'
import type { SpawnLocalAgentResult } from '../shared/types'
import { buildAgentPrompt } from './agent-manager/prompt-composer'
import { createLogger } from './logger'

const log = createLogger('adhoc-agent')

/** Wrapper around an SDK Session for ad-hoc agent management */
interface AdhocSession {
  send(message: string): Promise<void>
  close(): void
}

/** Active ad-hoc sessions, keyed by agent run ID */
const adhocSessions = new Map<string, AdhocSession>()

export function getAdhocHandle(agentId: string): AdhocSession | undefined {
  return adhocSessions.get(agentId)
}

export async function spawnAdhocAgent(args: {
  task: string
  repoPath: string
  model?: string
  assistant?: boolean
}): Promise<SpawnLocalAgentResult> {
  const model = args.model || 'claude-sonnet-4-5'
  const env = buildAgentEnvWithAuth()

  const sdk = await import('@anthropic-ai/claude-agent-sdk')

  // Build composed prompt with preamble
  const prompt = buildAgentPrompt({
    agentType: args.assistant ? 'assistant' : 'adhoc',
    taskContent: args.task
  })

  // Create a persistent session (v2 API) for multi-turn conversations
  const session = sdk.unstable_v2_createSession({
    model,
    env: env as Record<string, string>,
    permissionMode: 'default',
    canUseTool: async () => ({ behavior: 'allow' as const })
  })

  // Record in agent_runs
  const repo = basename(args.repoPath).toLowerCase()
  const meta = await importAgent(
    {
      id: randomUUID(),
      pid: null,
      bin: 'claude',
      model,
      repo,
      repoPath: args.repoPath,
      task: args.task,
      status: 'running',
      source: 'adhoc'
    },
    ''
  )

  // Shared state for the conversation loop
  let closed = false
  const startedAt = Date.now()
  let costUsd = 0
  let tokensIn = 0
  let tokensOut = 0

  // Process one turn's stream output — call after each send()
  async function consumeTurn(): Promise<void> {
    try {
      for await (const raw of session.stream()) {
        const events = mapRawMessage(raw)
        for (const event of events) {
          emitAgentEvent(meta.id, event)
        }
        // Track cost/token fields
        if (typeof raw === 'object' && raw !== null) {
          const r = raw as Record<string, unknown>
          if (typeof r.cost_usd === 'number') costUsd = r.cost_usd
          if (typeof r.total_cost_usd === 'number') costUsd = r.total_cost_usd
          if (typeof r.tokens_in === 'number') tokensIn = r.tokens_in
          if (typeof r.tokens_out === 'number') tokensOut = r.tokens_out
          if (typeof r.usage === 'object' && r.usage !== null) {
            const u = r.usage as Record<string, unknown>
            if (typeof u.input_tokens === 'number') tokensIn = u.input_tokens
            if (typeof u.output_tokens === 'number') tokensOut = u.output_tokens
          }
        }
      }
      log.info(`[adhoc] ${meta.id} turn complete, session still alive`)
    } catch (err) {
      log.error(`[adhoc] ${meta.id} turn error: ${err instanceof Error ? err.message : String(err)}`)
      emitAgentEvent(meta.id, {
        type: 'agent:error',
        message: err instanceof Error ? err.message : String(err),
        timestamp: Date.now()
      })
    }
  }

  // Complete the session — emit completed event and clean up
  function completeSession(): void {
    if (closed) return
    closed = true

    const durationMs = Date.now() - startedAt
    emitAgentEvent(meta.id, {
      type: 'agent:completed',
      exitCode: 0,
      costUsd,
      tokensIn,
      tokensOut,
      durationMs,
      timestamp: Date.now()
    })

    updateAgentMeta(meta.id, {
      status: 'done',
      finishedAt: new Date().toISOString(),
      exitCode: 0
    }).catch(() => {})

    adhocSessions.delete(meta.id)
    session.close()
    log.info(`[adhoc] ${meta.id} session completed after ${Math.round(durationMs / 1000)}s`)
  }

  // Track for steering / kill
  adhocSessions.set(meta.id, {
    async send(message: string) {
      if (closed) return

      // Emit user message event so it appears in the console UI
      emitAgentEvent(meta.id, {
        type: 'agent:user_message',
        text: message,
        timestamp: Date.now()
      })

      // Send the message and consume the turn's response
      await session.send(message)
      await consumeTurn()
    },
    close() {
      completeSession()
    }
  })

  // Start: send initial prompt and consume first turn
  emitAgentEvent(meta.id, { type: 'agent:started', model, timestamp: Date.now() })
  log.info(`[adhoc] ${meta.id} starting session`)

  session.send(prompt).then(() => consumeTurn()).catch((err) => {
    log.error(`[adhoc] ${meta.id} initial prompt failed: ${err}`)
    completeSession()
  })

  return {
    id: meta.id,
    pid: 0,
    logPath: meta.logPath ?? '',
    interactive: true
  }
}
