/**
 * Agent record creation and tracking map registration.
 *
 * Wires stderr events, builds the ActiveAgent object, registers it in
 * the active-agents map, persists the agent_run_id on the task, and
 * fires the agent record + agent:started event.
 */
import type { ActiveAgent, AgentHandle } from './types'
import type { Logger } from '../logger'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { AgentRunClaim } from './run-agent'
import { randomUUID } from 'node:crypto'
import { createAgentRecord } from '../agent-history'
import { emitAgentEvent } from '../agent-event-mapper'
import { TurnTracker } from './turn-tracker'

const MIN_RUNTIME_MS = 60_000
const MAX_RUNTIME_MS = 24 * 60 * 60_000 // 24 hours

function clampMaxRuntimeMs(value: number | null | undefined): number | null {
  if (value == null || value <= 0) return null
  if (value < MIN_RUNTIME_MS) return MIN_RUNTIME_MS
  if (value > MAX_RUNTIME_MS) return MAX_RUNTIME_MS
  return value
}

/**
 * Wires stderr, builds the ActiveAgent, registers it in the map,
 * persists agent_run_id, fires the agent record, and emits agent:started.
 */
export function initializeAgentTracking(
  task: AgentRunClaim,
  handle: AgentHandle,
  effectiveModel: string,
  worktree: { worktreePath: string; branch: string },
  prompt: string,
  activeAgents: Map<string, ActiveAgent>,
  repo: IAgentTaskRepository,
  logger: Logger
): { agent: ActiveAgent; agentRunId: string; turnTracker: TurnTracker } {
  const agentRunId = randomUUID()

  handle.onStderr = (line: string) => {
    emitAgentEvent(agentRunId, { type: 'agent:stderr', text: line, timestamp: Date.now() })
  }

  const recordedModel = handle.resolvedModel ?? effectiveModel
  const recordedBin = handle.backend === 'local' ? 'rbt-coding-agent' : 'claude'

  const agent: ActiveAgent = {
    taskId: task.id,
    agentRunId,
    handle,
    model: recordedModel,
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    rateLimitCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    maxRuntimeMs: clampMaxRuntimeMs(task.max_runtime_ms),
    maxCostUsd: task.max_cost_usd ?? null,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch
  }
  activeAgents.set(task.id, agent)
  const turnTracker = new TurnTracker(agentRunId)

  // fire-and-forget: agent_run_id persistence is best-effort; the agent is already registered
  void repo.updateTask(task.id, { agent_run_id: agentRunId }).catch((err) => {
    logger.warn(`[agent-manager] Failed to persist agent_run_id for task ${task.id}: ${err}`)
  })

  createAgentRecord({
    id: agentRunId,
    pid: null,
    bin: recordedBin,
    model: recordedModel,
    repo: task.repo,
    repoPath: worktree.worktreePath,
    task: prompt,
    startedAt: new Date(agent.startedAt).toISOString(),
    finishedAt: null,
    exitCode: null,
    status: 'running',
    source: 'bde',
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    cacheRead: null,
    cacheCreate: null,
    sprintTaskId: task.id,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch
  }).catch((err) => {
    // createAgentRecord failure means this run is untracked in the audit trail (agent_runs table).
    // We cannot throw here: initializeAgentTracking is synchronous and has already registered the
    // agent in activeAgents. An unhandled rejection at this point would bypass the drain-loop
    // recovery path. Instead we log at error level so operators can investigate (e.g. DB
    // corruption, schema mismatch) while the agent still runs and its task status is preserved.
    logger.error(
      `[agent-manager] Failed to create agent record for ${agentRunId} — run is untracked: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    )
  })

  emitAgentEvent(agentRunId, {
    type: 'agent:started',
    model: recordedModel,
    timestamp: Date.now()
  })

  logger.info(JSON.stringify({
    event: 'agent.spawned',
    taskId: task.id,
    agentRunId,
    model: recordedModel,
    timestamp: new Date().toISOString()
  }))

  return { agent, agentRunId, turnTracker }
}
