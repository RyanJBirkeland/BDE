/**
 * Agent run query functions — extracted from agent-history.ts.
 * All functions take `db: Database.Database` as first parameter for testability.
 * File I/O operations (appendLog, readLog, etc.) remain in agent-history.ts.
 */
import type Database from 'better-sqlite3'
import type { AgentMeta } from '../../shared/types'

// --- Column mapping between snake_case DB rows and camelCase AgentMeta ---

export interface AgentRunRow {
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
  cost_usd: number | null
  tokens_in: number | null
  tokens_out: number | null
  sprint_task_id: string | null
}

export function rowToMeta(row: AgentRunRow): AgentMeta {
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
    source: (row.source as AgentMeta['source']) ?? 'external',
    costUsd: row.cost_usd ?? null,
    tokensIn: row.tokens_in ?? null,
    tokensOut: row.tokens_out ?? null,
    sprintTaskId: row.sprint_task_id ?? null
  }
}

export function listAgents(db: Database.Database, limit = 100, status?: string): AgentMeta[] {
  if (status) {
    return (
      db
        .prepare('SELECT * FROM agent_runs WHERE status = ? ORDER BY started_at DESC LIMIT ?')
        .all(status, limit) as AgentRunRow[]
    ).map(rowToMeta)
  }
  return (
    db
      .prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as AgentRunRow[]
  ).map(rowToMeta)
}

export function getAgentMeta(db: Database.Database, id: string): AgentMeta | null {
  const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow | undefined
  return row ? rowToMeta(row) : null
}

export function insertAgentRecord(
  db: Database.Database,
  meta: Omit<AgentMeta, 'logPath'> & { logPath: string }
): void {
  db.prepare(
    `INSERT OR REPLACE INTO agent_runs (id, pid, bin, task, repo, repo_path, model, status, log_path, started_at, finished_at, exit_code, source, sprint_task_id, cost_usd, tokens_in, tokens_out)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    meta.id,
    meta.pid,
    meta.bin,
    meta.task,
    meta.repo,
    meta.repoPath,
    meta.model,
    meta.status,
    meta.logPath,
    meta.startedAt,
    meta.finishedAt,
    meta.exitCode,
    meta.source ?? 'external',
    meta.sprintTaskId ?? null,
    meta.costUsd ?? null,
    meta.tokensIn ?? null,
    meta.tokensOut ?? null
  )
}

const AGENT_COLUMN_MAP: Record<string, string> = {
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
  source: 'source',
  costUsd: 'cost_usd',
  tokensIn: 'tokens_in',
  tokensOut: 'tokens_out',
  sprintTaskId: 'sprint_task_id'
}

// DL-33: Return mapped AgentMeta for consistency with other query functions
export function updateAgentMeta(
  db: Database.Database,
  id: string,
  patch: Partial<AgentMeta>
): AgentMeta | null {
  const setClauses: string[] = []
  const values: unknown[] = []

  for (const [key, value] of Object.entries(patch)) {
    const col = AGENT_COLUMN_MAP[key]
    if (col) {
      // QA-18: Defense-in-depth regex assertion for SQL column names
      if (!/^[a-z_]+$/.test(col)) {
        throw new Error(`Invalid column name: ${col}`)
      }
      setClauses.push(`${col} = ?`)
      values.push(value)
    }
  }

  if (setClauses.length === 0) return null
  values.push(id)

  db.prepare(`UPDATE agent_runs SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)

  // Return the updated row mapped to AgentMeta (consistent with getAgentMeta)
  const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow | null
  return row ? rowToMeta(row) : null
}

export function findAgentByPid(db: Database.Database, pid: number): AgentMeta | null {
  const row = db
    .prepare("SELECT * FROM agent_runs WHERE pid = ? AND status = 'running' LIMIT 1")
    .get(pid) as AgentRunRow | undefined
  return row ? rowToMeta(row) : null
}

export function hasAgent(db: Database.Database, id: string): boolean {
  const row = db.prepare('SELECT 1 FROM agent_runs WHERE id = ?').get(id)
  return !!row
}

export function countAgents(db: Database.Database): number {
  return (
    db.prepare('SELECT COUNT(*) as cnt FROM agent_runs').get() as {
      cnt: number
    }
  ).cnt
}

export function getAgentsToRemove(
  db: Database.Database,
  maxCount: number
): { id: string; started_at: string; log_path: string | null }[] {
  return db
    .prepare(
      'SELECT id, started_at, log_path FROM agent_runs ORDER BY started_at DESC LIMIT -1 OFFSET ?'
    )
    .all(maxCount) as { id: string; started_at: string; log_path: string | null }[]
}

export function deleteAgent(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agent_runs WHERE id = ?').run(id)
}

export function getAgentLogPath(db: Database.Database, id: string): string | null {
  const row = db.prepare('SELECT log_path FROM agent_runs WHERE id = ?').get(id) as
    | { log_path: string }
    | undefined
  return row?.log_path ?? null
}

export function getAgentLogInfo(
  db: Database.Database,
  id: string
): { logPath: string; status: string } | null {
  const row = db.prepare('SELECT log_path, status FROM agent_runs WHERE id = ?').get(id) as
    | { log_path: string; status: string }
    | undefined
  if (!row?.log_path) return null
  return { logPath: row.log_path, status: row.status }
}

export function updateAgentRunCost(
  db: Database.Database,
  agentRunId: string,
  cost: {
    costUsd: number
    tokensIn: number
    tokensOut: number
    cacheRead: number
    cacheCreate: number
    durationMs: number
    numTurns: number
  }
): void {
  db.prepare(
    `UPDATE agent_runs SET
      cost_usd = ?, tokens_in = ?, tokens_out = ?,
      cache_read = ?, cache_create = ?,
      duration_ms = ?, num_turns = ?
    WHERE id = ?`
  ).run(
    cost.costUsd,
    cost.tokensIn,
    cost.tokensOut,
    cost.cacheRead,
    cost.cacheCreate,
    cost.durationMs,
    cost.numTurns,
    agentRunId
  )
}

export function listAgentRunsByTaskId(
  db: Database.Database,
  sprintTaskId?: string,
  limit = 10
): AgentMeta[] {
  if (sprintTaskId) {
    return (
      db
        .prepare(
          'SELECT * FROM agent_runs WHERE sprint_task_id = ? ORDER BY started_at DESC LIMIT ?'
        )
        .all(sprintTaskId, limit) as AgentRunRow[]
    ).map(rowToMeta)
  }
  return (
    db
      .prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as AgentRunRow[]
  ).map(rowToMeta)
}
