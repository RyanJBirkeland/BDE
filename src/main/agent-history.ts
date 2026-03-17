/**
 * Agent history — persistent storage for agent metadata and logs.
 * Metadata stored in SQLite agent_runs table; log files stay on disk at ~/.bde/agent-logs/.
 */
import { mkdir, writeFile, appendFile, open, rm, readdir, rename, stat } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { getDb } from './db'
import type { AgentMeta } from '../shared/types'

export type { AgentMeta }

const BDE_DIR = join(homedir(), '.bde')
const AGENTS_INDEX = join(BDE_DIR, 'agents.json')
const LOGS_DIR = join(BDE_DIR, 'agent-logs')

// --- Column mapping between snake_case DB rows and camelCase AgentMeta ---

interface AgentRunRow {
  id: string
  pid: number | null
  bin: string
  task: string | null
  repo: string | null
  repo_path: string | null
  model: string | null
  status: string
  log_path: string | null
  started_at: string
  finished_at: string | null
  exit_code: number | null
  source: string | null
}

function rowToMeta(row: AgentRunRow): AgentMeta {
  return {
    id: row.id,
    pid: row.pid,
    bin: row.bin,
    model: row.model ?? 'unknown',
    repo: row.repo ?? 'unknown',
    repoPath: row.repo_path ?? '',
    task: row.task ?? '',
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    status: row.status as AgentMeta['status'],
    logPath: row.log_path ?? '',
    source: (row.source as AgentMeta['source']) ?? 'external'
  }
}

// --- Schema migration: add source column if missing ---

function ensureSourceColumn(): void {
  const db = getDb()
  const columns = db.prepare("PRAGMA table_info('agent_runs')").all() as { name: string }[]
  if (!columns.some((c) => c.name === 'source')) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN source TEXT DEFAULT 'external'")
  }
}

function ensureCostColumns(): void {
  const db = getDb()
  const columns = db.prepare("PRAGMA table_info('agent_runs')").all() as { name: string }[]
  if (!columns.some((c) => c.name === 'cost_usd')) {
    db.exec(`
      ALTER TABLE agent_runs ADD COLUMN cost_usd REAL;
      ALTER TABLE agent_runs ADD COLUMN tokens_in INTEGER;
      ALTER TABLE agent_runs ADD COLUMN tokens_out INTEGER;
      ALTER TABLE agent_runs ADD COLUMN cache_read INTEGER;
      ALTER TABLE agent_runs ADD COLUMN cache_create INTEGER;
      ALTER TABLE agent_runs ADD COLUMN duration_ms INTEGER;
      ALTER TABLE agent_runs ADD COLUMN num_turns INTEGER;
    `)
  }
}

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
  ensureSourceColumn()
  ensureCostColumns()
  // Fire-and-forget async migration
  migrateFromJson().catch(() => {})
}

// --- Public API ---

function datePrefix(iso: string): string {
  return iso.slice(0, 10)
}

export async function listAgents(limit = 100, status?: string): Promise<AgentMeta[]> {
  initAgentHistory()
  const db = getDb()
  if (status) {
    return (db.prepare('SELECT * FROM agent_runs WHERE status = ? ORDER BY started_at DESC LIMIT ?')
      .all(status, limit) as AgentRunRow[]).map(rowToMeta)
  }
  return (db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?')
    .all(limit) as AgentRunRow[]).map(rowToMeta)
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

  getDb().prepare(`
    INSERT OR REPLACE INTO agent_runs (id, pid, bin, task, repo, repo_path, model, status, log_path, started_at, finished_at, exit_code, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    meta.id, meta.pid, meta.bin, meta.task, meta.repo, meta.repoPath,
    meta.model, meta.status, logPath, meta.startedAt, meta.finishedAt,
    meta.exitCode, meta.source ?? 'external'
  )

  return full
}

export async function appendLog(id: string, content: string): Promise<void> {
  initAgentHistory()
  const row = getDb().prepare('SELECT log_path FROM agent_runs WHERE id = ?').get(id) as { log_path: string } | undefined
  if (!row?.log_path) return
  await appendFile(row.log_path, content, 'utf-8')
}

export async function readLog(
  id: string,
  fromByte = 0
): Promise<{ content: string; nextByte: number }> {
  initAgentHistory()
  const row = getDb().prepare('SELECT log_path FROM agent_runs WHERE id = ?').get(id) as { log_path: string } | undefined
  if (!row?.log_path) return { content: '', nextByte: fromByte }
  try {
    const fh = await open(row.log_path, 'r')
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

export async function getAgentMeta(id: string): Promise<AgentMeta | null> {
  initAgentHistory()
  const row = getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow | undefined
  return row ? rowToMeta(row) : null
}

export async function updateAgentMeta(
  id: string,
  patch: Partial<AgentMeta>
): Promise<void> {
  initAgentHistory()
  const db = getDb()

  const columnMap: Record<string, string> = {
    pid: 'pid',
    bin: 'bin',
    task: 'task',
    repo: 'repo',
    repoPath: 'repo_path',
    model: 'model',
    status: 'status',
    logPath: 'log_path',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
    exitCode: 'exit_code',
    source: 'source'
  }

  const setClauses: string[] = []
  const values: unknown[] = []

  for (const [key, value] of Object.entries(patch)) {
    const col = columnMap[key]
    if (col) {
      setClauses.push(`${col} = ?`)
      values.push(value)
    }
  }

  if (setClauses.length === 0) return
  values.push(id)

  db.prepare(`UPDATE agent_runs SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)

  // Also update per-agent meta.json on disk
  const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow | undefined
  if (row?.log_path) {
    const metaPath = join(LOGS_DIR, datePrefix(row.started_at), row.id, 'meta.json')
    try {
      await writeFile(metaPath, JSON.stringify(rowToMeta(row), null, 2), 'utf-8')
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
    source: meta.source ?? 'external'
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

  const total = db.prepare('SELECT COUNT(*) as cnt FROM agent_runs').get() as { cnt: number }
  if (total.cnt <= maxCount) return

  // Get the IDs of agents to prune (oldest beyond maxCount)
  const toRemove = db.prepare(
    'SELECT id, started_at, log_path FROM agent_runs ORDER BY started_at DESC LIMIT -1 OFFSET ?'
  ).all(maxCount) as { id: string; started_at: string; log_path: string | null }[]

  if (toRemove.length === 0) return

  const deleteStmt = db.prepare('DELETE FROM agent_runs WHERE id = ?')
  const tx = db.transaction(() => {
    for (const row of toRemove) {
      deleteStmt.run(row.id)
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
  const row = getDb().prepare('SELECT 1 FROM agent_runs WHERE id = ?').get(id)
  return !!row
}

export async function findAgentByPid(pid: number): Promise<AgentMeta | null> {
  initAgentHistory()
  const row = getDb().prepare(
    "SELECT * FROM agent_runs WHERE pid = ? AND status = 'running' LIMIT 1"
  ).get(pid) as AgentRunRow | undefined
  return row ? rowToMeta(row) : null
}
