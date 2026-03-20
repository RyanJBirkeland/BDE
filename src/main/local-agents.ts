/**
 * Local agent management — spawn, kill, steer, and tail agent processes.
 * Delegates to AgentProvider (SDK or CLI) via the provider factory.
 * Process scanning logic lives in agent-scanner.ts.
 */
import { randomUUID } from 'crypto'
import { readdir, stat, unlink, appendFile, open, readFile } from 'fs/promises'
import { join, basename as pathBasename } from 'path'
import { validateLogPath } from './fs'
import {
  createAgentRecord,
  updateAgentMeta,
} from './agent-history'
import { getTaskRunnerConfig } from './config'
import { getDb } from './db'
import { BDE_AGENT_TMP_DIR as LOG_DIR } from './paths'
import { createAgentProvider, type AgentHandle } from './agents'

// Re-export scanner types and functions for consumers
export type { LocalAgentProcess, PsCandidate } from './agent-scanner'
export {
  KNOWN_AGENT_BINS,
  scanAgentProcesses,
  resolveProcessDetails,
  evictStaleCwdCache,
  reconcileStaleAgents,
  getAgentProcesses,
  getProcessCwd,
  _resetReconcileThrottle,
  _resetProcessCache,
} from './agent-scanner'

const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// Track active agent handles for PID-based interactive messaging
const activeAgentProcesses = new Map<number, AgentHandle>()

// Track active agent handles by agent ID for steering from Sprint LogDrawer
const activeAgentsById = new Map<string, AgentHandle>()

// --- Cost extraction from agent log files ---

export interface AgentCost {
  costUsd: number
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cacheCreate: number
  durationMs: number
  numTurns: number
}

export async function extractAgentCost(logPath: string): Promise<AgentCost | null> {
  try {
    const content = await readFile(logPath, 'utf-8')
    const lines = content.split('\n')

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue

      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }

      // Unwrap stream_event wrapper if present
      if (parsed.type === 'stream_event' && parsed.event && typeof parsed.event === 'object') {
        parsed = parsed.event as Record<string, unknown>
      }

      // Support both legacy result events and new agent:completed events
      if (parsed.type === 'result') {
        const usage = parsed.usage as Record<string, number> | undefined
        return {
          costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : 0,
          tokensIn: usage?.input_tokens ?? 0,
          tokensOut: usage?.output_tokens ?? 0,
          cacheRead: usage?.cache_read_input_tokens ?? 0,
          cacheCreate: usage?.cache_creation_input_tokens ?? 0,
          durationMs: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : 0,
          numTurns: typeof parsed.num_turns === 'number' ? parsed.num_turns : 0,
        }
      }

      if (parsed.type === 'agent:completed') {
        return {
          costUsd: typeof parsed.costUsd === 'number' ? parsed.costUsd : 0,
          tokensIn: typeof parsed.tokensIn === 'number' ? parsed.tokensIn : 0,
          tokensOut: typeof parsed.tokensOut === 'number' ? parsed.tokensOut : 0,
          cacheRead: 0,
          cacheCreate: 0,
          durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
          numTurns: 0,
        }
      }
    }

    return null
  } catch {
    return null
  }
}

export function updateAgentRunCost(agentRunId: string, cost: AgentCost): void {
  getDb().prepare(`
    UPDATE agent_runs SET
      cost_usd = ?, tokens_in = ?, tokens_out = ?,
      cache_read = ?, cache_create = ?,
      duration_ms = ?, num_turns = ?
    WHERE id = ?
  `).run(
    cost.costUsd, cost.tokensIn, cost.tokensOut,
    cost.cacheRead, cost.cacheCreate,
    cost.durationMs, cost.numTurns,
    agentRunId
  )
}

// --- Spawn an agent via the provider factory ---

export type { SpawnLocalAgentArgs, SpawnLocalAgentResult } from '../shared/types'
import type { SpawnLocalAgentArgs, SpawnLocalAgentResult } from '../shared/types'
import { CLAUDE_MODELS, DEFAULT_MODEL } from '../shared/models'
import { getAgentBinary } from './settings'

function modelToFlag(model?: string): string {
  const entry = CLAUDE_MODELS.find((m) => m.id === model)
  return entry?.modelId ?? DEFAULT_MODEL.modelId
}

export async function spawnClaudeAgent(args: SpawnLocalAgentArgs): Promise<SpawnLocalAgentResult> {
  const bin = getAgentBinary()
  const id = randomUUID()

  // Create persistent agent record
  const meta = await createAgentRecord({
    id,
    pid: null,
    bin,
    model: modelToFlag(args.model),
    repo: pathBasename(args.repoPath),
    repoPath: args.repoPath,
    task: args.task,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    status: 'running',
    source: 'bde'
  })

  let handle: AgentHandle
  try {
    const provider = createAgentProvider()
    handle = await provider.spawn({
      prompt: args.task,
      workingDirectory: args.repoPath,
      model: args.model,
      agentId: id,
    })
  } catch (err) {
    console.error(`[local-agents] spawn failed for agent ${id}:`, err)
    await updateAgentMeta(id, {
      finishedAt: new Date().toISOString(),
      exitCode: null,
      status: 'failed'
    })
    return { pid: 0, logPath: meta.logPath, id, interactive: false }
  }

  const pid = handle.pid ?? 0

  // Track active handle
  if (pid) activeAgentProcesses.set(pid, handle)
  activeAgentsById.set(id, handle)

  // Update record with real PID
  await updateAgentMeta(id, { pid: pid || null })

  // Consume event stream in background for logging and completion
  consumeEvents(id, handle, meta.logPath).catch(() => {})

  return { pid, logPath: meta.logPath, id, interactive: true }
}

/** Background event consumer — writes events to log and updates DB on completion. */
async function consumeEvents(id: string, handle: AgentHandle, logPath: string): Promise<void> {
  try {
    for await (const event of handle.events) {
      appendFile(logPath, JSON.stringify(event) + '\n', 'utf-8').catch(() => {})

      if (event.type === 'agent:completed') {
        activeAgentsById.delete(id)
        if (handle.pid) activeAgentProcesses.delete(handle.pid)
        const status = event.exitCode === 0 ? 'done' : 'failed'
        await updateAgentMeta(id, {
          finishedAt: new Date().toISOString(),
          exitCode: event.exitCode,
          status,
        })
        updateAgentRunCost(id, {
          costUsd: event.costUsd,
          tokensIn: event.tokensIn,
          tokensOut: event.tokensOut,
          cacheRead: 0,
          cacheCreate: 0,
          durationMs: event.durationMs,
          numTurns: 0,
        })
        break
      }
    }
  } catch {
    activeAgentsById.delete(id)
    if (handle.pid) activeAgentProcesses.delete(handle.pid)
    await updateAgentMeta(id, {
      finishedAt: new Date().toISOString(),
      exitCode: null,
      status: 'failed',
    })
  }
}

// --- Kill a running agent by ID ---

export async function killAgent(agentId: string): Promise<{ ok: boolean; error?: string }> {
  const handle = activeAgentsById.get(agentId)
  if (!handle) {
    return { ok: false, error: 'Agent not found — may have already exited' }
  }
  try {
    await handle.stop()
  } catch {
    return { ok: false, error: 'Failed to stop agent' }
  }
  return { ok: true }
}

// --- Send follow-up message to a running interactive agent ---

export function sendToAgent(pid: number, message: string): { ok: boolean; error?: string } {
  const handle = activeAgentProcesses.get(pid)
  if (!handle) {
    return { ok: false, error: 'Process not found or stdin closed' }
  }
  handle.steer(message).catch(() => {})
  return { ok: true }
}

// --- Steer a running agent by agent ID (UUID) ---

export async function steerAgent(agentId: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const handle = activeAgentsById.get(agentId)
  if (handle) {
    try {
      await handle.steer(message)
      return { ok: true }
    } catch {
      return { ok: false, error: 'Failed to steer agent' }
    }
  }

  return steerViaTaskRunner(agentId, message)
}

async function steerViaTaskRunner(agentId: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const config = getTaskRunnerConfig()
  if (!config) {
    return { ok: false, error: 'Agent not found locally and task-runner config unavailable' }
  }

  try {
    const res = await fetch(`${config.url}/agents/${agentId}/steer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({ message })
    })

    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: `Task-runner returned ${res.status}: ${body}` }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Task-runner request failed: ${(err as Error).message}` }
  }
}

// --- Tail agent log file ---

export interface TailLogArgs {
  logPath: string
  fromByte?: number
}

export interface TailLogResult {
  content: string
  nextByte: number
}

export async function tailAgentLog(args: TailLogArgs): Promise<TailLogResult> {
  const safePath = validateLogPath(args.logPath)
  const fromByte = args.fromByte ?? 0
  let fh: import('fs/promises').FileHandle | undefined
  try {
    fh = await open(safePath, 'r')
    const stats = await fh.stat()
    const size = stats.size
    if (fromByte >= size) return { content: '', nextByte: fromByte }
    const buf = Buffer.alloc(size - fromByte)
    await fh.read(buf, 0, buf.length, fromByte)
    return { content: buf.toString('utf-8'), nextByte: size }
  } catch {
    return { content: '', nextByte: fromByte }
  } finally {
    await fh?.close()
  }
}

// --- Cleanup old log files on startup ---

export async function cleanupOldLogs(): Promise<void> {
  try {
    const entries = await readdir(LOG_DIR)
    const now = Date.now()
    await Promise.all(
      entries
        .filter((f) => f.endsWith('.log'))
        .map(async (f) => {
          const fullPath = join(LOG_DIR, f)
          const s = await stat(fullPath)
          if (now - s.mtimeMs > LOG_MAX_AGE_MS) await unlink(fullPath)
        })
    )
  } catch {
    // Dir may not exist yet — that's fine
  }
}

// --- Check if a PID has an interactive agent handle ---

export function isAgentInteractive(pid: number): boolean {
  return activeAgentProcesses.has(pid)
}

/** Returns true if the given PID belongs to a BDE-spawned agent process. */
export function isKnownAgentPid(pid: number): boolean {
  return activeAgentProcesses.has(pid)
}
