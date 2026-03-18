/**
 * Local agent process detection — scans `ps` output for known AI agent
 * binaries (claude, codex, opencode, pi, aider, cursor) and resolves
 * their working directories via `lsof` on macOS.
 */
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { readdir, stat, unlink, appendFile, open, readFile } from 'fs/promises'
import { join, dirname, basename as pathBasename } from 'path'
import { validateLogPath } from './fs'
import {
  createAgentRecord,
  updateAgentMeta,
  listAgents
} from './agent-history'
import { getTaskRunnerConfig } from './config'
import { getDb } from './db'
import { BDE_AGENT_TMP_DIR as LOG_DIR } from './paths'

const execFileAsync = promisify(execFile)

const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

const AGENT_BINS = ['claude', 'codex', 'opencode', 'pi', 'aider', 'cursor']

// Electron's main process has a stripped PATH — augment it with common CLI install locations
const ELECTRON_PATH = [
  process.env.PATH,
  '/usr/local/bin',
  '/opt/homebrew/bin',
  `${process.env.HOME}/.local/bin`,
  `${dirname(process.execPath)}`,
].filter(Boolean).join(':')

export interface LocalAgentProcess {
  pid: number
  bin: string
  args: string
  cwd: string | null
  startedAt: number
  cpuPct: number
  memMb: number
}

// Track active child processes for interactive stdin messaging
const activeAgentProcesses = new Map<number, import('child_process').ChildProcess>()

// Track active child processes by agent ID for steering from Sprint LogDrawer
const activeAgentsById = new Map<string, import('child_process').ChildProcess>()

// Full result cache — avoids repeated ps + lsof on every poll
let _processCache: LocalAgentProcess[] = []
let _processCachedAt = 0
const PROCESS_CACHE_TTL = 5_000

// CWD doesn't change for a given PID — cache it
const cwdCache = new Map<number, string | null>()

async function getProcessCwd(pid: number): Promise<string | null> {
  if (cwdCache.has(pid)) return cwdCache.get(pid)!
  try {
    const { stdout } = await execFileAsync('lsof', ['-p', String(pid), '-a', '-d', 'cwd', '-F', 'n'])
    const lines = stdout.split('\n')
    const nLine = lines.find((l) => l.startsWith('n') && l !== 'ncwd')
    const cwd = nLine ? nLine.slice(1) : null
    cwdCache.set(pid, cwd)
    return cwd
  } catch {
    cwdCache.set(pid, null)
    return null
  }
}

function parseElapsedToMs(elapsed: string): number {
  // etime format: [[DD-]HH:]MM:SS
  const trimmed = elapsed.trim()
  const dayParts = trimmed.split('-')
  let days = 0
  let timePart = trimmed
  if (dayParts.length === 2) {
    days = parseInt(dayParts[0])
    timePart = dayParts[1]
  }
  const segments = timePart.split(':').map((s) => parseInt(s))
  let seconds = 0
  if (segments.length === 3) {
    seconds = segments[0] * 3600 + segments[1] * 60 + segments[2]
  } else if (segments.length === 2) {
    seconds = segments[0] * 60 + segments[1]
  } else if (segments.length === 1) {
    seconds = segments[0]
  }
  return (days * 86400 + seconds) * 1000
}

function matchAgentBin(command: string): string | null {
  const parts = command.split(/\s+/)
  // Only check the first token (the executable itself)
  const execPath = parts[0] ?? ''
  // Exclude macOS .app bundles (e.g. Claude.app, Cursor.app) — we only want CLI tools
  if (execPath.includes('.app/Contents')) return null
  const binName = (execPath.split('/').pop() ?? '').toLowerCase()
  return AGENT_BINS.find((b) => binName === b) ?? null
}

export interface PsCandidate {
  pid: number
  cpuPct: number
  rss: number
  elapsed: string
  command: string
  bin: string
}

export async function scanAgentProcesses(): Promise<PsCandidate[]> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid,%cpu,rss,etime,args'])
  const lines = stdout.trim().split('\n').slice(1)
  const candidates: PsCandidate[] = []
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    if (!match) continue
    const bin = matchAgentBin(match[5]!)
    if (!bin) continue
    candidates.push({
      pid: parseInt(match[1]!),
      cpuPct: parseFloat(match[2]!),
      rss: parseInt(match[3]!),
      elapsed: match[4]!,
      command: match[5]!,
      bin
    })
  }
  return candidates
}

export async function resolveProcessDetails(candidates: PsCandidate[]): Promise<LocalAgentProcess[]> {
  return Promise.all(
    candidates.map(async (c) => {
      const cwd = await getProcessCwd(c.pid)
      const args = c.command.split(/\s+/).slice(1).join(' ')
      return {
        pid: c.pid,
        bin: c.bin,
        args,
        cwd,
        startedAt: Date.now() - parseElapsedToMs(c.elapsed),
        cpuPct: c.cpuPct,
        memMb: Math.round(c.rss / 1024)
      }
    })
  )
}

export function evictStaleCwdCache(livePids: Set<number>): void {
  for (const pid of cwdCache.keys()) {
    if (!livePids.has(pid)) cwdCache.delete(pid)
  }
}

export async function reconcileStaleAgents(livePids: Set<number>): Promise<void> {
  const running = await listAgents(500, 'running')
  for (const agent of running) {
    if (agent.pid && !livePids.has(agent.pid)) {
      await updateAgentMeta(agent.id, {
        finishedAt: new Date().toISOString(),
        status: 'unknown',
        exitCode: null
      })
    }
  }
}

const RECONCILE_INTERVAL_MS = 30_000
let _lastReconcileAt = 0

async function maybeReconcileStaleAgents(livePids: Set<number>): Promise<void> {
  const now = Date.now()
  if (now - _lastReconcileAt < RECONCILE_INTERVAL_MS) return
  _lastReconcileAt = now
  await reconcileStaleAgents(livePids)
}

/** @internal — reset throttle state for testing only */
export function _resetReconcileThrottle(): void {
  _lastReconcileAt = 0
}

/** @internal — reset process cache for testing only */
export function _resetProcessCache(): void {
  _processCache = []
  _processCachedAt = 0
}

export async function getAgentProcesses(): Promise<LocalAgentProcess[]> {
  const now = Date.now()
  if (now - _processCachedAt < PROCESS_CACHE_TTL) {
    return _processCache
  }

  try {
    const candidates = await scanAgentProcesses()
    const results = await resolveProcessDetails(candidates)
    const livePids = new Set(results.map((r) => r.pid))

    evictStaleCwdCache(livePids)
    maybeReconcileStaleAgents(livePids).catch(() => {})

    _processCache = results
    _processCachedAt = now
    return results
  } catch {
    return _processCache
  }
}

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

function modelToFlag(model?: string): string {
  if (model === 'haiku') return 'claude-haiku-4-5'
  if (model === 'opus') return 'claude-opus-4-5'
  return 'claude-sonnet-4-5'
}

export async function spawnClaudeAgent(args: SpawnLocalAgentArgs): Promise<SpawnLocalAgentResult> {
  const id = randomUUID()

  // Create persistent agent record
  const meta = await createAgentRecord({
    id,
    pid: null,
    bin: 'claude',
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

  const child = spawn('claude', [
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--input-format', 'stream-json',
    '--model', modelToFlag(args.model),
    '--permission-mode', 'bypassPermissions'
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
  try {
    const fh = await open(safePath, 'r')
    const stats = await fh.stat()
    const size = stats.size
    if (fromByte >= size) { await fh.close(); return { content: '', nextByte: fromByte } }
    const buf = Buffer.alloc(size - fromByte)
    await fh.read(buf, 0, buf.length, fromByte)
    await fh.close()
    return { content: buf.toString('utf-8'), nextByte: size }
  } catch {
    return { content: '', nextByte: fromByte }
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
