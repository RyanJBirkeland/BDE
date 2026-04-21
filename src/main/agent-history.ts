/**
 * Agent history — persistent storage for agent metadata and logs.
 * Metadata stored in SQLite agent_runs table; log files stay on disk at ~/.bde/agent-logs/.
 * DB queries are delegated to data/agent-queries.ts.
 */
import { mkdir, writeFile, appendFile, open, rm, readdir, rename, stat } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDb } from './db'
import { BDE_AGENTS_INDEX as AGENTS_INDEX, BDE_AGENT_LOGS_DIR as LOGS_DIR } from './paths'
import { clearSprintTaskFk } from './data/sprint-maintenance-facade'
import { getErrorMessage } from '../shared/errors'
import {
  listAgents as _listAgents,
  getAgentMeta as _getAgentMeta,
  insertAgentRecord,
  updateAgentMeta as _updateAgentMeta,
  findAgentByPid as _findAgentByPid,
  hasAgent as _hasAgent,
  countAgents,
  getAgentsToRemove,
  deleteAgent,
  getAgentLogPath,
  listAgentRunsByTaskId as _listAgentRunsByTaskId
} from './data/agent-queries'
import { pruneEventsByAgentIds } from './data/event-queries'
import type { AgentMeta } from '../shared/types'
import { createLogger } from './logger'
import { nowIso } from '../shared/time'

const logger = createLogger('agent-history')

export type { AgentMeta }

// --- One-time migration from agents.json ---

export async function migrateFromJson(db?: Database.Database): Promise<void> {
  try {
    if (!existsSync(AGENTS_INDEX)) return
    const conn = db ?? getDb()
    const count = conn.prepare('SELECT COUNT(*) as cnt FROM agent_runs').get() as { cnt: number }
    if (count.cnt > 0) return

    const raw = readFileSync(AGENTS_INDEX, 'utf-8')
    const agents: AgentMeta[] = JSON.parse(raw)
    if (!Array.isArray(agents) || agents.length === 0) return

    const insert = conn.prepare(`
      INSERT OR IGNORE INTO agent_runs (id, pid, bin, task, repo, repo_path, model, status, log_path, started_at, finished_at, exit_code, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const tx = conn.transaction(() => {
      for (const a of agents) {
        insert.run(
          a.id,
          a.pid,
          a.bin,
          a.task,
          a.repo,
          a.repoPath,
          a.model,
          a.status,
          a.logPath,
          a.startedAt,
          a.finishedAt,
          a.exitCode,
          a.source ?? 'external'
        )
      }
    })
    tx()

    await rename(AGENTS_INDEX, AGENTS_INDEX + '.bak')
    logger.info(`Migrated ${agents.length} agents from agents.json to SQLite`)
  } catch (err) {
    logger.error(`Migration from agents.json failed: ${err}`)
  }
}

// --- Initialization (call once at startup) ---

let _initialized = false

export function initAgentHistory(): void {
  if (_initialized) return
  _initialized = true

  // Finalize any agent_runs left as 'running' from a previous session —
  // no agents can be alive when the app process is just starting.
  try {
    const cleaned = finalizeAllRunningAgentRuns()
    if (cleaned > 0) {
      logger.info(`Finalized ${cleaned} stale agent_runs from previous session`)
    }
  } catch {
    // DB may not be ready yet — orphan recovery will catch these later
  }

  // One-time cleanup of finished_at values written without a timezone marker.
  // See backfillUtcTimestamps() docs for the full story.
  try {
    const fixed = backfillUtcTimestamps()
    if (fixed > 0) {
      logger.info(`Backfilled ${fixed} agent_runs.finished_at values to ISO-with-Z`)
    }
  } catch {
    // Non-fatal — broken timestamps just keep displaying wrong durations
  }

  // Fire-and-forget async migration
  migrateFromJson().catch((err) => {
    logger.warn(`[agent-history] Failed to migrate from agents.json: ${getErrorMessage(err)}`)
  })
}

// --- Public API ---

function datePrefix(iso: string): string {
  return iso.slice(0, 10)
}

export async function listAgents(
  limit = 100,
  status?: string,
  db?: Database.Database
): Promise<AgentMeta[]> {
  initAgentHistory()
  return _listAgents(db ?? getDb(), limit, status)
}

export async function createAgentRecord(
  meta: Omit<AgentMeta, 'logPath'>,
  db?: Database.Database
): Promise<AgentMeta> {
  initAgentHistory()
  const date = datePrefix(meta.startedAt)
  const logDir = join(LOGS_DIR, date, meta.id)
  await mkdir(logDir, { recursive: true })

  const logPath = join(logDir, 'output.log')
  await writeFile(logPath, '', 'utf-8')

  const full: AgentMeta = { ...meta, logPath }
  await writeFile(join(logDir, 'meta.json'), JSON.stringify(full, null, 2), 'utf-8')

  insertAgentRecord(db ?? getDb(), full)

  return full
}

export async function appendLog(
  id: string,
  content: string,
  db?: Database.Database
): Promise<void> {
  initAgentHistory()
  const logPath = getAgentLogPath(db ?? getDb(), id)
  if (!logPath) return
  await appendFile(logPath, content, 'utf-8')
}

export async function readLog(
  id: string,
  fromByte = 0,
  maxBytes?: number,
  db?: Database.Database
): Promise<{ content: string; nextByte: number; totalBytes: number }> {
  initAgentHistory()
  const logPath = getAgentLogPath(db ?? getDb(), id)
  if (!logPath) return { content: '', nextByte: fromByte, totalBytes: 0 }
  let fh: import('fs/promises').FileHandle | undefined
  try {
    fh = await open(logPath, 'r')
    const stats = await fh.stat()
    const totalBytes = stats.size
    if (fromByte >= totalBytes) return { content: '', nextByte: fromByte, totalBytes }
    const available = totalBytes - fromByte
    const readSize = maxBytes != null ? Math.min(available, maxBytes) : available
    if (readSize === 0) return { content: '', nextByte: fromByte, totalBytes }
    const buf = Buffer.alloc(readSize)
    await fh.read(buf, 0, readSize, fromByte)
    return { content: buf.toString('utf-8'), nextByte: fromByte + readSize, totalBytes }
  } catch {
    return { content: '', nextByte: fromByte, totalBytes: 0 }
  } finally {
    await fh?.close()
  }
}

export async function getAgentMeta(id: string, db?: Database.Database): Promise<AgentMeta | null> {
  initAgentHistory()
  return _getAgentMeta(db ?? getDb(), id)
}

export async function updateAgentMeta(
  id: string,
  patch: Partial<AgentMeta>,
  db?: Database.Database
): Promise<void> {
  initAgentHistory()
  const meta = _updateAgentMeta(db ?? getDb(), id, patch)

  // Also update per-agent meta.json on disk
  // DL-33: updateAgentMeta now returns AgentMeta (not AgentRunRow), so use camelCase properties
  if (meta?.logPath) {
    const metaPath = join(LOGS_DIR, datePrefix(meta.startedAt), meta.id, 'meta.json')
    try {
      await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch {
      // Log dir may not exist for imported agents
    }
  }
}

export async function importAgent(meta: Partial<AgentMeta>, content: string): Promise<AgentMeta> {
  const id = meta.id ?? randomUUID()
  const startedAt = meta.startedAt ?? nowIso()
  const full: Omit<AgentMeta, 'logPath'> = {
    id,
    pid: meta.pid ?? null,
    bin: meta.bin ?? 'claude',
    model: meta.model ?? 'unknown',
    repo: meta.repo ?? 'unknown',
    repoPath: meta.repoPath ?? '',
    task: meta.task ?? '',
    startedAt,
    finishedAt: meta.finishedAt ?? null,
    exitCode: meta.exitCode ?? null,
    status: meta.status ?? 'unknown',
    source: meta.source ?? 'external',
    costUsd: meta.costUsd ?? null,
    tokensIn: meta.tokensIn ?? null,
    tokensOut: meta.tokensOut ?? null,
    cacheRead: meta.cacheRead ?? null,
    cacheCreate: meta.cacheCreate ?? null,
    sprintTaskId: meta.sprintTaskId ?? null,
    worktreePath: meta.worktreePath ?? null,
    branch: meta.branch ?? null
  }
  const record = await createAgentRecord(full)
  if (content) {
    await appendLog(id, content)
  }
  return record
}

export async function pruneOldAgents(maxCount = 500, db?: Database.Database): Promise<void> {
  initAgentHistory()
  const conn = db ?? getDb()

  const total = countAgents(conn)
  if (total <= maxCount) return

  const toRemove = getAgentsToRemove(conn, maxCount)
  if (toRemove.length === 0) return

  // Clear sprint task FK references first
  for (const row of toRemove) {
    clearSprintTaskFk(row.id)
  }

  // Prune associated events before removing agent records
  pruneEventsByAgentIds(
    conn,
    toRemove.map((r) => r.id)
  )

  // Then delete agents from local SQLite in a transaction
  const tx = conn.transaction(() => {
    for (const row of toRemove) {
      deleteAgent(conn, row.id)
    }
  })
  tx()

  // Clean up log directories for pruned agents
  for (const row of toRemove) {
    const date = datePrefix(row.started_at)
    const logDir = join(LOGS_DIR, date, row.id)
    try {
      await rm(logDir, { recursive: true, force: true })
    } catch {
      // Already gone
    }
  }

  // Clean up empty date directories
  try {
    const dateDirs = await readdir(LOGS_DIR)
    for (const d of dateDirs) {
      const dirPath = join(LOGS_DIR, d)
      try {
        const s = await stat(dirPath)
        if (!s.isDirectory()) continue
        const entries = await readdir(dirPath)
        if (entries.length === 0) {
          await rm(dirPath, { recursive: true, force: true })
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Logs dir may not exist
  }
}

export async function hasAgent(id: string, db?: Database.Database): Promise<boolean> {
  initAgentHistory()
  return _hasAgent(db ?? getDb(), id)
}

export async function findAgentByPid(
  pid: number,
  db?: Database.Database
): Promise<AgentMeta | null> {
  initAgentHistory()
  return _findAgentByPid(db ?? getDb(), pid)
}

export async function listAgentRunsByTaskId(
  sprintTaskId?: string,
  limit?: number,
  db?: Database.Database
): Promise<import('../shared/types').AgentMeta[]> {
  initAgentHistory()
  return _listAgentRunsByTaskId(db ?? getDb(), sprintTaskId, limit)
}

/** Mark all agent_runs stuck in 'running' older than maxAgeMs as 'failed'. */
export function finalizeStaleAgentRuns(
  maxAgeMs: number = 2 * 60 * 60 * 1000,
  db?: Database.Database
): number {
  const conn = db ?? getDb()
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
  const now = nowIso()
  const stmt = conn.prepare(
    `UPDATE agent_runs SET status = 'failed', finished_at = ?
     WHERE status = 'running' AND started_at < ?`
  )
  const result = stmt.run(now, cutoff)
  return result.changes
}

/**
 * Reconcile agent_runs marked 'running' in the DB against the actual in-memory active set.
 * Any sprint-task agent record whose sprint_task_id is not in the active set gets
 * finalized as 'failed'. Called periodically by orphan recovery to catch agents that
 * died without clean shutdown.
 *
 * Adhoc/assistant agents have a null sprint_task_id and are managed by the
 * adhocSessions map (not by agent-manager), so they are skipped here. Their
 * lifecycle is finalized either by completeSession() during normal close or
 * by finalizeAllRunningAgentRuns() at the next app startup.
 */
export function reconcileRunningAgentRuns(
  isAgentActive: (taskId: string) => boolean,
  db?: Database.Database
): number {
  const conn = db ?? getDb()
  const rows = conn
    .prepare(`SELECT id, sprint_task_id FROM agent_runs WHERE status = 'running'`)
    .all() as Array<{ id: string; sprint_task_id: string | null }>

  let cleaned = 0
  const now = nowIso()
  const finalize = conn.prepare(
    `UPDATE agent_runs SET status = 'failed', finished_at = ? WHERE id = ?`
  )

  for (const row of rows) {
    // Skip rows without a sprint_task_id — those are adhoc/assistant agents
    // owned by the adhocSessions map, not by sprint-task orphan recovery.
    if (!row.sprint_task_id) continue
    // Sprint-task agent: keep alive only if its task is still in the active set.
    if (isAgentActive(row.sprint_task_id)) continue
    finalize.run(now, row.id)
    cleaned++
  }
  return cleaned
}

/**
 * Finalize ALL agent_runs still marked 'running'.
 * Called at app startup — no agents can actually be running when the process starts fresh.
 */
export function finalizeAllRunningAgentRuns(db?: Database.Database): number {
  const conn = db ?? getDb()
  const now = nowIso()
  const stmt = conn.prepare(
    `UPDATE agent_runs SET status = 'failed', finished_at = ?
     WHERE status = 'running'`
  )
  const result = stmt.run(now)
  return result.changes
}

/**
 * One-time cleanup of finished_at values written by the older code path that
 * used SQLite's `datetime('now')`. That function returns local-time text without
 * a `Z` suffix (e.g. `2026-04-07 02:30:01`). When the renderer parses such a
 * string with `new Date(...)`, JavaScript treats it as LOCAL time, shifting
 * the duration display by the user's timezone offset (causing the famous
 * "7h 0m" duration on a session that just started).
 *
 * This pass finds rows in the broken format and rewrites them to canonical
 * ISO-with-Z, interpreting the original value as UTC (which is what SQLite's
 * `datetime('now')` actually meant — it produces UTC text, just without the
 * marker). Idempotent: the LIKE clause only matches the broken shape, so a
 * second invocation is a no-op.
 */
export function backfillUtcTimestamps(db?: Database.Database): number {
  const conn = db ?? getDb()
  // Match rows whose finished_at looks like '2026-04-07 02:30:01' (no T, no Z).
  // SQLite's `||` concatenates; replace ' ' with 'T' and append 'Z' to produce
  // canonical ISO 8601 UTC.
  const stmt = conn.prepare(
    `UPDATE agent_runs
        SET finished_at = REPLACE(finished_at, ' ', 'T') || 'Z'
      WHERE finished_at IS NOT NULL
        AND finished_at LIKE '____-__-__ __:__:__'`
  )
  const result = stmt.run()
  return result.changes
}
