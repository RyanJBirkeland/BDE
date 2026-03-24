/**
 * Ad-hoc agent spawning — launches interactive Claude sessions via SDK query API
 * with AsyncIterable prompt for multi-turn conversations.
 *
 * Uses query() with streamInput() for follow-up messages — the session stays alive
 * until explicitly closed, unlike a string prompt which is single-turn.
 */
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { importAgent, updateAgentMeta } from './agent-history'
import { appendEvent } from './data/event-queries'
import { getDb } from './db'
import { broadcast } from './broadcast'
import type { AgentEvent, SpawnLocalAgentResult } from '../shared/types'

/** Wrapper around an SDK Query for ad-hoc agent management */
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
}): Promise<SpawnLocalAgentResult> {
  const model = args.model || 'claude-sonnet-4-5'

  // Build env with OAuth token (same approach as sdk-adapter.ts)
  const env: Record<string, string | undefined> = { ...process.env }
  const tokenPath = join(homedir(), '.bde', 'oauth-token')
  try {
    if (existsSync(tokenPath)) {
      env.ANTHROPIC_API_KEY = readFileSync(tokenPath, 'utf8').trim()
    }
  } catch { /* token read failure is non-fatal */ }

  const extraPaths = ['/usr/local/bin', '/opt/homebrew/bin', `${process.env.HOME}/.local/bin`]
  const currentPath = env.PATH ?? ''
  env.PATH = [...extraPaths, ...currentPath.split(':')].filter(Boolean).join(':')

  // Create multi-turn query with an async iterable prompt.
  // The initial message is yielded immediately; follow-ups come via streamInput().
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const sessionId = randomUUID()

  // Create the initial user message
  const initialMessage: import('@anthropic-ai/claude-agent-sdk').SDKUserMessage = {
    type: 'user',
    message: { role: 'user', content: args.task },
    parent_tool_use_id: null,
    session_id: sessionId,
  }

  // Use an async generator that yields the first message then stays open
  async function* initialPrompt() {
    yield initialMessage
    // Generator stays open — query() keeps the session alive
    // Follow-up messages go through queryHandle.streamInput()
    await new Promise<void>(() => {}) // Never resolves — keeps generator alive
  }

  const queryHandle = sdk.query({
    prompt: initialPrompt(),
    options: {
      model,
      cwd: args.repoPath,
      env: env as Record<string, string>,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    },
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
    '',
  )

  // Track for steering / kill
  adhocSessions.set(meta.id, {
    async send(message: string) {
      const userMsg: import('@anthropic-ai/claude-agent-sdk').SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content: message },
        parent_tool_use_id: null,
        session_id: sessionId,
      }
      await queryHandle.streamInput((async function* () { yield userMsg })())
    },
    close() {
      queryHandle.close()
    },
  })

  // Consume messages in the background — do NOT await
  consumeStream(meta.id, model, queryHandle).catch(() => {})

  return {
    id: meta.id,
    pid: 0,
    logPath: meta.logPath ?? '',
    interactive: true,
  }
}

// ---- Background stream consumer ----

async function consumeStream(
  agentId: string,
  model: string,
  queryHandle: AsyncIterable<unknown> & { close(): void },
): Promise<void> {
  const startedAt = Date.now()
  let costUsd = 0
  let tokensIn = 0
  let tokensOut = 0
  let exitCode = 0

  emitEvent(agentId, { type: 'agent:started', model, timestamp: Date.now() })

  try {
    for await (const raw of queryHandle) {
      const events = mapRawMessage(raw)
      for (const event of events) {
        emitEvent(agentId, event)
      }

      // Track cost/token fields if present
      if (typeof raw === 'object' && raw !== null) {
        const r = raw as Record<string, unknown>
        if (typeof r.cost_usd === 'number') costUsd = r.cost_usd
        if (typeof r.total_cost_usd === 'number') costUsd = r.total_cost_usd
        if (typeof r.tokens_in === 'number') tokensIn = r.tokens_in
        if (typeof r.tokens_out === 'number') tokensOut = r.tokens_out
        if (typeof r.exit_code === 'number') exitCode = r.exit_code
        if (typeof r.usage === 'object' && r.usage !== null) {
          const u = r.usage as Record<string, unknown>
          if (typeof u.input_tokens === 'number') tokensIn = u.input_tokens
          if (typeof u.output_tokens === 'number') tokensOut = u.output_tokens
        }
      }
    }
  } catch (err) {
    emitEvent(agentId, {
      type: 'agent:error',
      message: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(),
    })
  }

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

  await updateAgentMeta(agentId, {
    status: 'done',
    finishedAt: new Date().toISOString(),
    exitCode,
  }).catch(() => {})

  adhocSessions.delete(agentId)
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
