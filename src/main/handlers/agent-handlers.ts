/**
 * Agent IPC handlers — manages agent lifecycle operations
 * and provides local history/log access from SQLite.
 */
import { safeHandle } from '../ipc-utils'
import { tailAgentLog, cleanupOldLogs } from '../agent-log-manager'
import type { TailLogArgs } from '../agent-log-manager'
import { listAgents, readLog, importAgent, pruneOldAgents, getAgentMeta } from '../agent-history'
import { getLatestAgentRunTurn } from '../data/agent-queries'
import { getDb } from '../db'
import type { AgentMeta } from '../agent-history'
import { spawnAdhocAgent, getAdhocHandle } from '../adhoc-agent'
import { createLogger, logError } from '../logger'
import type { AgentEvent, SpawnLocalAgentArgs } from '../../shared/types'
import type { AgentManager } from '../agent-manager'
import { createSprintTaskRepository } from '../data/sprint-task-repository'
import type { IDashboardRepository } from '../data/sprint-task-repository'
import { promoteAdhocToTask } from '../services/adhoc-promotion-service'

const log = createLogger('agent-handlers')

/**
 * Every AgentEvent type. Kept as a runtime Set so `isAgentEvent` can verify a
 * parsed payload against the union in `AgentEvent` without duplicating the
 * discriminator elsewhere. If `AgentEvent` gains a new member, add it here.
 */
const AGENT_EVENT_TYPES: ReadonlySet<AgentEvent['type']> = new Set([
  'agent:started',
  'agent:text',
  'agent:user_message',
  'agent:thinking',
  'agent:tool_call',
  'agent:tool_result',
  'agent:rate_limited',
  'agent:error',
  'agent:stderr',
  'agent:completed',
  'agent:playground'
])

/**
 * Shape guard for values parsed out of `agent_events.payload` before they
 * cross the IPC boundary to the renderer. Agent events are persisted as JSON
 * strings, so a corrupted row, schema drift, or hand-edited DB row can smuggle
 * arbitrary shapes through the typed channel. We only require the two fields
 * that every member of the `AgentEvent` union shares — a known `type` and a
 * numeric `timestamp`. Variant-specific fields are trusted once the
 * discriminator matches, matching how consumers already treat the union.
 */
function isAgentEvent(value: unknown): value is AgentEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { type?: unknown; timestamp?: unknown }
  if (typeof candidate.timestamp !== 'number') return false
  if (typeof candidate.type !== 'string') return false
  return AGENT_EVENT_TYPES.has(candidate.type as AgentEvent['type'])
}

/**
 * Parse a SQLite `agent_events.payload` row. Returns the parsed event only
 * when it passes the shape guard; otherwise logs a warn and returns null so
 * the caller can drop it without failing the whole history read.
 */
function parseHistoryRow(payload: string, agentId: string): AgentEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn(`agent:history: dropping malformed event (agent=${agentId}): ${message}`)
    return null
  }
  if (!isAgentEvent(parsed)) {
    log.warn(`agent:history: dropping malformed event (agent=${agentId})`)
    return null
  }
  return parsed
}

export interface PromoteToReviewResult {
  ok: boolean
  taskId?: string | undefined
  error?: string | undefined
}

export async function testLocalEndpoint(
  endpoint: string
): Promise<{ ok: true; latencyMs: number; modelCount: number } | { ok: false; error: string }> {
  const started = Date.now()
  try {
    const trimmed = endpoint.replace(/\/$/, '')
    const response = await fetch(`${trimmed}/models`, {
      signal: AbortSignal.timeout(2000)
    })
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` }
    }
    const body = (await response.json()) as unknown
    if (
      typeof body !== 'object' ||
      body === null ||
      !Array.isArray((body as { data?: unknown }).data)
    ) {
      return { ok: false, error: 'Unexpected response shape — no data array' }
    }
    return {
      ok: true,
      latencyMs: Date.now() - started,
      modelCount: (body as { data: unknown[] }).data.length
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'timeout after 2s' }
    }
    const cause = (err as { cause?: { code?: string | undefined } })?.cause
    if (cause?.code) {
      return { ok: false, error: cause.code }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

export function registerAgentHandlers(am?: AgentManager, repo?: IDashboardRepository): void {
  const effectiveRepo = repo ?? createSprintTaskRepository()

  safeHandle('local:getAgentProcesses', async () => {
    return []
  })
  safeHandle('local:spawnClaudeAgent', async (_e, args: SpawnLocalAgentArgs) => {
    return spawnAdhocAgent({
      task: args.task,
      repoPath: args.repoPath,
      assistant: args.assistant,
      repo: effectiveRepo
    })
  })
  safeHandle('local:tailAgentLog', (_e, args: TailLogArgs) => tailAgentLog(args))
  type SteerArgs = {
    agentId: string
    message: string
    images?: Array<{ data: string; mimeType: string }> | undefined
  }
  safeHandle('agent:steer', async (_e, { agentId, message, images }: SteerArgs) => {
    // Try ad-hoc agents first
    const adhocHandle = getAdhocHandle(agentId)
    if (adhocHandle) {
      try {
        await adhocHandle.send(message, images)
        return { ok: true }
      } catch (err) {
        logError(log, '[agents:send] adhoc send failed', err)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
    // Try local AgentManager
    if (am) {
      const result = await am.steerAgent(agentId, message)
      if (result.delivered) return { ok: true }
      return { ok: false, error: result.error }
    }
    return { ok: false, error: 'No agent manager available' }
  })
  safeHandle('agent:kill', async (_e, agentId: string) => {
    // Try ad-hoc agents first
    const adhocHandle = getAdhocHandle(agentId)
    if (adhocHandle) {
      adhocHandle.close()
      return { ok: true }
    }
    if (am) {
      try {
        am.killAgent(agentId)
        return { ok: true }
      } catch (err) {
        logError(log, `[killAgent] exception for ${agentId}`, err)
        /* fall through */
      }
    }
    return { ok: false, error: 'Agent not found' }
  })
  safeHandle('agent:history', async (_e, agentId: string) => {
    // Event history from local SQLite — kept for viewing historical runs.
    // Rows are parsed and shape-guarded before crossing the IPC boundary so
    // corrupted / drifted payloads can't pose as typed AgentEvents downstream.
    const { getEventHistory } = await import('../data/event-queries')
    const { getDb } = await import('../db')
    const rows = getEventHistory(getDb(), agentId)
    const events: AgentEvent[] = []
    for (const row of rows) {
      const event = parseHistoryRow(row.payload, agentId)
      if (event) events.push(event)
    }
    return events
  })
  cleanupOldLogs()

  // --- Agent history IPC ---
  type ListAgentsArgs = { limit?: number | undefined; status?: string | undefined }
  safeHandle('agents:list', (_e, args: ListAgentsArgs) => listAgents(args.limit, args.status))
  type ReadLogArgs = { id: string; fromByte?: number | undefined }
  safeHandle('agents:readLog', (_e, args: ReadLogArgs) => readLog(args.id, args.fromByte))
  safeHandle('agents:import', (_e, args: { meta: Partial<AgentMeta>; content: string }) =>
    importAgent(args.meta, args.content)
  )

  /**
   * Promote a completed adhoc agent's worktree into the Code Review queue.
   *
   * Adhoc agents are scratchpads — they don't participate in the sprint task
   * lifecycle. When the user is happy with an adhoc agent's work and wants it
   * reviewed/merged, they click "Promote to Code Review" which calls this
   * handler. We:
   *  1. Look up the agent and verify it has a worktree with at least one commit
   *  2. Create a NEW sprint task in `review` status pointing at that worktree
   *  3. Return the new task id so the UI can switch to Code Review and select it
   */
  type PromoteHandler = (
    _e: Electron.IpcMainInvokeEvent,
    agentId: string
  ) => Promise<PromoteToReviewResult>
  const promoteToReview: PromoteHandler = async (_e, agentId) => {
    try {
      const agent = await getAgentMeta(agentId)
      if (!agent) {
        return { ok: false, error: `Agent ${agentId} not found` }
      }
      return await promoteAdhocToTask(agentId, agent)
    } catch (err) {
      logError(log, '[agents:promoteToReview] failed', err)
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    }
  }
  safeHandle('agents:promoteToReview', promoteToReview)

  safeHandle('agents:testLocalEndpoint', (_e, args: { endpoint: string }) =>
    testLocalEndpoint(args.endpoint)
  )

  safeHandle('agent:latestCacheTokens', async (_e, runId: string) => {
    return getLatestAgentRunTurn(getDb(), runId)
  })

  pruneOldAgents()
}
