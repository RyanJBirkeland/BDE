/**
 * Local agent management — spawn, kill, steer, and tail agent processes.
 * Process scanning logic lives in agent-scanner.ts.
 */
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { readdir, stat, unlink, appendFile, open, readFile } from 'fs/promises'
import { join, dirname, basename as pathBasename } from 'path'
import { validateLogPath } from './fs'
import {
  createAgentRecord,
  updateAgentMeta,
} from './agent-history'
import { getTaskRunnerConfig } from './config'
import { getDb } from './db'
import { BDE_AGENT_TMP_DIR as LOG_DIR } from './paths'

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

const execFileAsync = promisify(execFile)

const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// Electron's main process has a stripped PATH — augment it with common CLI install locations
const ELECTRON_PATH = [
  process.env.PATH,
  '/usr/local/bin',
  '/opt/homebrew/bin',
  `${process.env.HOME}/.local/bin`,
  `${dirname(process.execPath)}`,
].filter(Boolean).join(':')

// Track active child processes for interactive stdin messaging
const activeAgentProcesses = new Map<number, import('child_process').ChildProcess>()

// Track active child processes by agent ID for steering from Sprint LogDrawer
const activeAgentsById = new Map<string, import('child_process').ChildProcess>()

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

      if (parsed.type !== 'result') continue

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

// --- Spawn a Claude CLI agent on the Max plan ---

export type { SpawnLocalAgentArgs, SpawnLocalAgentResult } from '../shared/types'
import type { SpawnLocalAgentArgs, SpawnLocalAgentResult } from '../shared/types'
import { CLAUDE_MODELS, DEFAULT_MODEL } from '../shared/models'
import { getAgentBinary, getAgentPermissionMode } from './settings'

function modelToFlag(model?: string): string {
  const entry = CLAUDE_MODELS.find((m) => m.id === model)
  return entry?.modelId ?? DEFAULT_MODEL.modelId
}

/**
 * Verify the agent binary exists on PATH before attempting to spawn.
 * Throws a descriptive error if the binary is not found.
 */
async function assertBinaryExists(binary: string): Promise<void> {
  try {
    await execFileAsync('which', [binary], {
      env: { ...process.env, PATH: ELECTRON_PATH }
    })
  } catch {
    throw new Error(
      `Agent binary "${binary}" not found on PATH. ` +
      `Install it or update the binary name in Settings > Agent Runtime.`
    )
  }
}

export async function spawnClaudeAgent(args: SpawnLocalAgentArgs): Promise<SpawnLocalAgentResult> {
  const bin = getAgentBinary()
  const permissionMode = getAgentPermissionMode()

  // Pre-flight: ensure the binary exists before creating any DB records
  await assertBinaryExists(bin)

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

  const child = spawn(bin, [
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--input-format', 'stream-json',
    '--model', modelToFlag(args.model),
    '--permission-mode', permissionMode
  ], {
    cwd: args.repoPath,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PATH: ELECTRON_PATH }
  })

  // Send the initial task as the first user message via stdin
  const initialMessage = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: args.task }
  }) + '\n'
  child.stdin?.write(initialMessage)

  // Track active process for interactive messaging
  if (child.pid) activeAgentProcesses.set(child.pid, child)
  activeAgentsById.set(id, child)

  // Update record with real PID
  await updateAgentMeta(id, { pid: child.pid ?? null })

  // Stream output to persistent log — cache logPath to avoid a SQLite lookup per chunk
  const logPath = meta.logPath
  child.stdout?.on('data', (chunk: Buffer) => {
    appendFile(logPath, chunk.toString(), 'utf-8').catch(() => {})
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    appendFile(logPath, chunk.toString(), 'utf-8').catch(() => {})
  })

  child.on('close', async (code, signal) => {
    activeAgentsById.delete(id)
    if (child.pid) activeAgentProcesses.delete(child.pid)
    const status = signal === 'SIGTERM' ? 'cancelled' : code === 0 ? 'done' : 'failed'
    await updateAgentMeta(id, {
      finishedAt: new Date().toISOString(),
      exitCode: code,
      status
    })
    const cost = await extractAgentCost(logPath)
    if (cost) {
      await updateAgentRunCost(id, cost)
    }
  })

  child.unref()

  if (!child.pid) {
    console.error(`[local-agents] spawn failed for agent ${id} — child.pid is undefined`)
    activeAgentsById.delete(id)
    await updateAgentMeta(id, {
      finishedAt: new Date().toISOString(),
      exitCode: null,
      status: 'failed'
    })
    return { pid: 0, logPath: meta.logPath, id, interactive: false }
  }

  return { pid: child.pid, logPath: meta.logPath, id, interactive: true }
}

// --- Kill a running agent by ID ---

export async function killAgent(agentId: string): Promise<{ ok: boolean; error?: string }> {
  const child = activeAgentsById.get(agentId)
  if (!child) {
    return { ok: false, error: 'Agent not found — may have already exited' }
  }
  try {
    child.kill('SIGTERM')
  } catch {
    return { ok: false, error: 'Failed to send SIGTERM' }
  }
  return { ok: true }
}

// --- Send follow-up message to a running interactive agent ---

export function sendToAgent(pid: number, message: string): { ok: boolean; error?: string } {
  const child = activeAgentProcesses.get(pid)
  if (!child || !child.stdin || child.stdin.destroyed) {
    return { ok: false, error: 'Process not found or stdin closed' }
  }
  const event = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: message }
  }) + '\n'
  child.stdin.write(event)
  return { ok: true }
}

// --- Steer a running agent by agent ID (UUID) ---

export async function steerAgent(agentId: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const child = activeAgentsById.get(agentId)
  if (child?.stdin && !child.stdin.destroyed) {
    const event = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message }
    }) + '\n'
    child.stdin.write(event)
    return { ok: true }
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

// --- Check if a PID has an interactive stdin handle ---

export function isAgentInteractive(pid: number): boolean {
  const child = activeAgentProcesses.get(pid)
  return !!(child && child.stdin && !child.stdin.destroyed)
}

/** Returns true if the given PID belongs to a BDE-spawned agent process. */
export function isKnownAgentPid(pid: number): boolean {
  return activeAgentProcesses.has(pid)
}
