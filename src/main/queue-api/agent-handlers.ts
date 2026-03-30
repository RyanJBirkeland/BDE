/**
 * Queue API handlers for agent runs and logs.
 */
import type http from 'node:http'
import { sendJson } from './helpers'
import { listAgentRunsByTaskId, readLog, getAgentMeta } from '../agent-history'
import { getTask } from '../data/sprint-queries'

const MAX_LOG_BYTES = 204800 // 200KB
const DEFAULT_LOG_BYTES = 50000

export async function handleListAgents(
  res: http.ServerResponse,
  query: URLSearchParams
): Promise<void> {
  const taskId = query.get('taskId') ?? undefined
  const limit = Math.min(Math.max(parseInt(query.get('limit') ?? '10', 10) || 10, 1), 100)
  const agents = await listAgentRunsByTaskId(taskId, limit)
  sendJson(
    res,
    200,
    agents.map((a) => ({
      id: a.id,
      status: a.status,
      model: a.model,
      task: a.task,
      repo: a.repo,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      exitCode: a.exitCode,
      costUsd: a.costUsd,
      tokensIn: a.tokensIn,
      tokensOut: a.tokensOut,
      source: a.source
    }))
  )
}

export async function handleAgentLog(
  res: http.ServerResponse,
  agentId: string,
  query: URLSearchParams
): Promise<void> {
  // QA-6: Validate agent exists and has a valid task reference
  const agent = await getAgentMeta(agentId)
  if (!agent) {
    sendJson(res, 404, { error: `Agent ${agentId} not found` })
    return
  }

  // QA-6: Verify the agent's task exists (task-level authorization)
  if (agent.task) {
    const task = getTask(agent.task)
    if (!task) {
      sendJson(res, 404, { error: `Agent ${agentId} references non-existent task ${agent.task}` })
      return
    }
  }

  const maxBytes = Math.min(
    parseInt(query.get('maxBytes') ?? String(DEFAULT_LOG_BYTES), 10) || DEFAULT_LOG_BYTES,
    MAX_LOG_BYTES
  )
  const fromByteParam = query.get('fromByte')

  let fromByte: number
  if (fromByteParam != null) {
    fromByte = Math.max(parseInt(fromByteParam, 10) || 0, 0)
  } else {
    // Tail mode — stat to get totalBytes, then compute offset
    const stat = await readLog(agentId, 0, 0)
    if (stat.totalBytes === 0) {
      sendJson(res, 404, { error: `Agent ${agentId} not found or has no log` })
      return
    }
    fromByte = Math.max(0, stat.totalBytes - maxBytes)
  }

  const result = await readLog(agentId, fromByte, maxBytes)
  sendJson(res, 200, {
    content: result.content,
    nextByte: result.nextByte,
    totalBytes: result.totalBytes
  })
}
