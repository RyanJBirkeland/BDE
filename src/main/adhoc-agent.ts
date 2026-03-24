/**
 * Ad-hoc agent spawning — launches Claude sessions directly via SDK adapter.
 * Not tied to sprint tasks. Persists to agent_runs + agent_events for history.
 */
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { spawnAgent } from './agent-manager/sdk-adapter'
import type { AgentHandle } from './agent-manager/types'
import { importAgent, updateAgentMeta } from './agent-history'
import { appendEvent } from './data/event-queries'
import { getDb } from './db'
import { broadcast } from './broadcast'
import type { AgentEvent, SpawnLocalAgentResult } from '../shared/types'

/** Active ad-hoc agent handles, keyed by agent run ID */
const adhocAgents = new Map<string, AgentHandle>()

export function getAdhocHandle(agentId: string): AgentHandle | undefined {
  return adhocAgents.get(agentId)
}

export async function spawnAdhocAgent(args: {
  task: string
  repoPath: string
  model?: string
}): Promise<SpawnLocalAgentResult> {
  const model = args.model || 'claude-sonnet-4-5'

  // Spawn via SDK adapter (same path as Agent Manager)
  const handle = await spawnAgent({
    prompt: args.task,
    cwd: args.repoPath,
    model,
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
      source: 'adhoc',
    },
    '', // No initial log content
  )

  // Track for steering
  adhocAgents.set(meta.id, handle)

  // Consume messages in the background — do NOT await
  consumeMessages(meta.id, model, handle).catch(() => {})

  return {
    id: meta.id,
    pid: 0,
    logPath: meta.logPath ?? '',
    interactive: true,
  }
}

// ---- Background message consumer ----

async function consumeMessages(
  agentId: string,
  model: string,
  handle: AgentHandle,
): Promise<void> {
  const startedAt = Date.now()
  let costUsd = 0
  let tokensIn = 0
  let tokensOut = 0
  let exitCode = 0

  // Emit agent:started
  emitEvent(agentId, { type: 'agent:started', model, timestamp: Date.now() })

  try {
    for await (const raw of handle.messages) {
      const events = mapRawMessage(raw)
      for (const event of events) {
        emitEvent(agentId, event)
      }

      // Track cost/token fields if present
      if (typeof raw === 'object' && raw !== null) {
        const r = raw as Record<string, unknown>
        if (typeof r.cost_usd === 'number') costUsd = r.cost_usd
        if (typeof r.tokens_in === 'number') tokensIn = r.tokens_in
        if (typeof r.tokens_out === 'number') tokensOut = r.tokens_out
        if (typeof r.exit_code === 'number') exitCode = r.exit_code
      }
    }
  } catch (err) {
    emitEvent(agentId, {
      type: 'agent:error',
      message: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(),
    })
  }

  // Emit completion
  const durationMs = Date.now() - startedAt
  emitEvent(agentId, {
    type: 'agent:completed',
    exitCode,
    costUsd,
    tokensIn,
    tokensOut,
    durationMs,
    timestamp: Date.now(),
  })

  // Update agent_runs
  await updateAgentMeta(agentId, {
    status: 'done',
    finishedAt: new Date().toISOString(),
    exitCode,
  }).catch(() => {})

  // Cleanup
  adhocAgents.delete(agentId)
}

function emitEvent(agentId: string, event: AgentEvent): void {
  broadcast('agent:event', { agentId, event })
  try {
    appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
  } catch {
    // SQLite write failure is non-fatal
  }
}

// ---- Raw message → AgentEvent mapping ----

function mapRawMessage(raw: unknown): AgentEvent[] {
  if (typeof raw !== 'object' || raw === null) return []
  const msg = raw as Record<string, unknown>
  const now = Date.now()
  const events: AgentEvent[] = []

  const msgType = msg.type as string | undefined

  if (msgType === 'assistant') {
    // Extract text from message content
    const message = msg.message as Record<string, unknown> | undefined
    const content = message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'object' && block !== null) {
          const b = block as Record<string, unknown>
          if (b.type === 'text' && typeof b.text === 'string') {
            events.push({ type: 'agent:text', text: b.text, timestamp: now })
          } else if (b.type === 'tool_use') {
            events.push({
              type: 'agent:tool_call',
              tool: (b.name as string) ?? 'unknown',
              summary: (b.name as string) ?? '',
              input: b.input,
              timestamp: now,
            })
          }
        }
      }
    }
  } else if (msgType === 'tool_result' || msgType === 'result') {
    const content = msg.content ?? msg.output
    events.push({
      type: 'agent:tool_result',
      tool: (msg.tool_name as string) ?? (msg.name as string) ?? 'unknown',
      success: msg.is_error !== true,
      summary: typeof content === 'string' ? content.slice(0, 200) : '',
      output: content,
      timestamp: now,
    })
  }

  return events
}
