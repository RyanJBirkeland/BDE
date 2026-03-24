/**
 * Agent history — persistent storage for agent metadata and logs.
 * Metadata stored in SQLite agent_runs table; log files stay on disk at ~/.bde/agent-logs/.
 * DB queries are delegated to data/agent-queries.ts.
 */
import { mkdir, writeFile, appendFile, open, rm, readdir, rename, stat } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getDb } from './db'
import { BDE_AGENTS_INDEX as AGENTS_INDEX, BDE_AGENT_LOGS_DIR as LOGS_DIR } from './paths'
import { clearSprintTaskFk } from './data/sprint-queries'
import {
  rowToMeta,
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
  listAgentRunsByTaskId as _listAgentRunsByTaskId,
} from './data/agent-queries'
import type { AgentRunRow } from './data/agent-queries'
import { pruneEventsByAgentIds } from './data/event-queries'
import type { AgentMeta } from '../shared/types'

export type { AgentMeta }

// --- One-time migration from agents.json ---

export async function migrateFromJson(): Promise<void> {
  try {
    if (!existsSync(AGENTS_INDEX)) return
    const db = getDb()
    const count = db.prepare('SELECT COUNT(*) as cnt FROM agent_runs').get() as { cnt: number }
    if (count.cnt > 0) return

    const raw = readFileSync(AGENTS_INDEX, 'utf-8')
    const agents: AgentMeta[] = JSON.parse(raw)
    if (!Array.isArray(agents) || agents.length === 0) return

    const insert = db.prepare(`
      INSERT OR IGNORE INTO agent_runs (id, pid, bin, task, repo, repo_path, model, status, log_path, started_at, finished_at, exit_code, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const tx = db.transaction(() => {
      for (const a of agents) {
        insert.run(
          a.id, a.pid, a.bin, a.task, a.repo, a.repoPath, a.model,
          a.status, a.logPath, a.startedAt, a.finishedAt, a.exitCode,
          a.source ?? 'external'
        )
      }
    })
    tx()

    await rename(AGENTS_INDEX, AGENTS_INDEX + '.bak')
    console.log(`[agent-history] Migrated ${agents.length} agents from agents.json to SQLite`)
  } catch (err) {
    console.error('[agent-history] Migration from agents.json failed:', err)
  }
}

// --- Initialization (call once at startup) ---

let _initialized = false

export function initAgentHistory(): void {
  if (_initialized) return
  _initialized = true
  // Fire-and-forget async migration
  migrateFromJson().catch(() => {})
}

// --- Public API ---

function datePrefix(iso: string): string {
  return iso.slice(0, 10)
}

export async function listAgents(limit = 100, status?: string): Promise<AgentMeta[]> {
  initAgentHistory()
  return _listAgents(getDb(), limit, status)
}

export async function createAgentRecord(
  meta: Omit<AgentMeta, 'logPath'>
): Promise<AgentMeta> {
  initAgentHistory()
  const date = datePrefix(meta.startedAt)
  const logDir = join(LOGS_DIR, date, meta.id)
  await mkdir(logDir, { recursive: true })

  const logPath = join(logDir, 'output.log')
  await writeFile(logPath, '', 'utf-8')

  const full: AgentMeta = { ...meta, logPath }
  await writeFile(join(logDir, 'meta.json'), JSON.stringify(full, null, 2), 'utf-8')

  insertAgentRecord(getDb(), full)

  return full
}

export async function appendLog(id: string, content: string): Promise<void> {
  initAgentHistory()
  const logPath = getAgentLogPath(getDb(), id)
  if (!logPath) return
  await appendFile(logPath, content, 'utf-8')
}

export async function readLog(
  id: string,
  fromByte = 0,
  maxBytes?: number
): Promise<{ content: string; nextByte: number; totalBytes: number }> {
  initAgentHistory()
  const logPath = getAgentLogPath(getDb(), id)
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

export async function getAgentMeta(id: string): Promise<AgentMeta | null> {
  initAgentHistory()
  return _getAgentMeta(getDb(), id)
}

export async function updateAgentMeta(
  id: string,
  patch: Partial<AgentMeta>
): Promise<void> {
  initAgentHistory()
  const row = _updateAgentMeta(getDb(), id, patch)

  // Also update per-agent meta.json on disk
  if (row?.log_path) {
    const metaPath = join(LOGS_DIR, datePrefix(row.started_at), row.id, 'meta.json')
    try {
      await writeFile(metaPath, JSON.stringify(rowToMeta(row as AgentRunRow), null, 2), 'utf-8')
    } catch {
      // Log dir may not exist for imported agents
    }
  }
}

export async function importAgent(
  meta: Partial<AgentMeta>,
  content: string
): Promise<AgentMeta> {
  const id = meta.id ?? randomUUID()
  const startedAt = meta.startedAt ?? new Date().toISOString()
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
    sprintTaskId: meta.sprintTaskId ?? null,
  }
  const record = await createAgentRecord(full)
  if (content) {
    await appendLog(id, content)
  }
  return record
}

export async function pruneOldAgents(maxCount = 500): Promise<void> {
  initAgentHistory()
  const db = getDb()

  const total = countAgents(db)
  if (total <= maxCount) return

  const toRemove = getAgentsToRemove(db, maxCount)
  if (toRemove.length === 0) return

  // Clear Supabase sprint task FKs first (async)
  for (const row of toRemove) {
    await clearSprintTaskFk(row.id)
  }

  // Prune associated events before removing agent records
  pruneEventsByAgentIds(db, toRemove.map((r) => r.id))

  // Then delete agents from local SQLite in a transaction
  const tx = db.transaction(() => {
    for (const row of toRemove) {
      deleteAgent(db, row.id)
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

export async function hasAgent(id: string): Promise<boolean> {
  initAgentHistory()
  return _hasAgent(getDb(), id)
}

export async function findAgentByPid(pid: number): Promise<AgentMeta | null> {
  initAgentHistory()
  return _findAgentByPid(getDb(), pid)
}

export async function listAgentRunsByTaskId(
  sprintTaskId?: string,
  limit?: number
): Promise<import('../shared/types').AgentMeta[]> {
  initAgentHistory()
  return _listAgentRunsByTaskId(getDb(), sprintTaskId, limit)
}
