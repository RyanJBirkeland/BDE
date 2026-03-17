/**
 * Local agent process detection — scans `ps` output for known AI agent
 * binaries (claude, codex, opencode, pi, aider, cursor) and resolves
 * their working directories via `lsof` on macOS.
 */
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { readdir, stat, unlink, readFile } from 'fs/promises'
import { join, dirname, basename as pathBasename } from 'path'
import { validateLogPath } from './fs'
import {
  createAgentRecord,
  updateAgentMeta,
  appendLog as appendAgentLog,
  listAgents
} from './agent-history'

const execFileAsync = promisify(execFile)

const LOG_DIR = '/tmp/bde-agents'
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

export async function getAgentProcesses(): Promise<LocalAgentProcess[]> {
  try {
    const candidates = await scanAgentProcesses()
    const results = await resolveProcessDetails(candidates)
    const livePids = new Set(results.map((r) => r.pid))

    evictStaleCwdCache(livePids)
    maybeReconcileStaleAgents(livePids).catch(() => {})

    return results
  } catch {
    return []
  }
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

  // Stream output to persistent log
  child.stdout?.on('data', (chunk: Buffer) => {
    appendAgentLog(id, chunk.toString())
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    appendAgentLog(id, chunk.toString())
  })

  child.on('exit', async (code) => {
    if (child.pid) activeAgentProcesses.delete(child.pid)
    activeAgentsById.delete(id)
    await updateAgentMeta(id, {
      finishedAt: new Date().toISOString(),
      exitCode: code,
      status: code === 0 ? 'done' : 'failed'
    })
  })

  child.unref()
  return { pid: child.pid!, logPath: meta.logPath, id, interactive: true }
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

export function steerAgent(agentId: string, message: string): { ok: boolean; error?: string } {
  const child = activeAgentsById.get(agentId)
  if (!child || !child.stdin || child.stdin.destroyed) {
    return { ok: false, error: 'Agent not found or stdin closed' }
  }
  const event = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: message }
  }) + '\n'
  child.stdin.write(event)
  return { ok: true }
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
    const buf = await readFile(safePath)
    const slice = buf.subarray(fromByte)
    return { content: slice.toString('utf-8'), nextByte: buf.length }
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
