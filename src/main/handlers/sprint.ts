import { readFile } from 'fs/promises'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'

const SPECS_ROOT = resolve(homedir(), 'Documents', 'Repositories', 'BDE', 'docs', 'specs')

function validateSpecPath(relativePath: string): string {
  const resolved = resolve(SPECS_ROOT, relativePath)
  if (!resolved.startsWith(SPECS_ROOT + '/') && resolved !== SPECS_ROOT) {
    throw new Error(`Path traversal blocked: "${relativePath}" resolves outside ${SPECS_ROOT}`)
  }
  return resolved
}

// --- Types ---

export interface CreateTaskInput {
  title: string
  repo: string
  prompt?: string
  description?: string
  spec?: string
  priority?: number
  status?: string
}

// --- One-time Supabase → SQLite migration ---

function migrateFromSupabase(): void {
  const db = getDb()
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM sprint_tasks').get() as { cnt: number }
  if (count.cnt > 0) return // Already have data, skip migration

  let url = ''
  let serviceKey = ''
  try {
    const envPath = join(homedir(), 'Documents', 'Repositories', 'life-os', '.env')
    const raw = readFileSync(envPath, 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const eqIdx = trimmed.indexOf('=')
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (key === 'VITE_SUPABASE_URL') url = val
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') serviceKey = val
    }
  } catch {
    // No .env file — nothing to migrate
    return
  }

  if (!url || !serviceKey) {
    console.warn('[sprint] Supabase env not found — skipping one-time migration')
    return
  }

  // Fetch in background — don't block startup
  fetch(`${url}/rest/v1/sprint_tasks?order=priority.asc,created_at.desc&limit=500&select=*`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`)
      return res.json()
    })
    .then((rows: Record<string, unknown>[]) => {
      if (!Array.isArray(rows) || rows.length === 0) return

      // Re-check inside transaction in case another process inserted
      const db = getDb()
      const recheck = db.prepare('SELECT COUNT(*) AS cnt FROM sprint_tasks').get() as {
        cnt: number
      }
      if (recheck.cnt > 0) return

      const insert = db.prepare(`
        INSERT OR IGNORE INTO sprint_tasks
          (id, title, prompt, repo, status, priority, spec, notes, pr_url, pr_number, pr_status,
           agent_run_id, started_at, completed_at, created_at, updated_at)
        VALUES
          (@id, @title, @prompt, @repo, @status, @priority, @spec, @notes, @pr_url, @pr_number,
           @pr_status, @agent_run_id, @started_at, @completed_at, @created_at, @updated_at)
      `)

      const migrate = db.transaction((tasks: Record<string, unknown>[]) => {
        for (const t of tasks) {
          insert.run({
            id: t['id'] ?? null,
            title: t['title'] ?? '',
            prompt: t['prompt'] ?? '',
            repo: t['repo'] ?? 'bde',
            status: t['status'] ?? 'backlog',
            priority: t['priority'] ?? 1,
            spec: t['spec'] ?? null,
            notes: t['notes'] ?? null,
            pr_url: t['pr_url'] ?? null,
            pr_number: t['pr_number'] ?? null,
            pr_status: t['pr_status'] ?? null,
            agent_run_id: t['agent_run_id'] ?? t['agent_session_id'] ?? null,
            started_at: t['started_at'] ?? null,
            completed_at: t['completed_at'] ?? null,
            created_at: t['created_at'] ?? new Date().toISOString(),
            updated_at: t['updated_at'] ?? new Date().toISOString(),
          })
        }
      })

      migrate(rows)
      console.log(`[sprint] Migrated ${rows.length} tasks from Supabase to SQLite`)
    })
    .catch((err) => {
      console.warn('[sprint] Supabase migration failed (non-fatal):', err)
    })
}

// --- IPC Registration ---

export function registerSprintHandlers(): void {
  // One-time migration from Supabase (non-blocking, graceful)
  migrateFromSupabase()

  safeHandle('sprint:list', () => {
    const db = getDb()
    return db
      .prepare('SELECT * FROM sprint_tasks ORDER BY priority ASC, created_at DESC')
      .all()
  })

  safeHandle('sprint:create', (_e, task: CreateTaskInput) => {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO sprint_tasks (title, repo, prompt, spec, priority, status)
      VALUES (@title, @repo, @prompt, @spec, @priority, @status)
      RETURNING *
    `)
    return stmt.get({
      title: task.title,
      repo: task.repo,
      prompt: task.prompt ?? task.spec ?? task.title,
      spec: task.spec ?? null,
      priority: task.priority ?? 0,
      status: task.status ?? 'backlog',
    })
  })

  safeHandle('sprint:update', (_e, id: string, patch: Record<string, unknown>) => {
    const db = getDb()
    const allowed = [
      'title', 'prompt', 'repo', 'status', 'priority', 'spec', 'notes',
      'pr_url', 'pr_number', 'pr_status', 'agent_run_id', 'started_at', 'completed_at',
    ]
    const entries = Object.entries(patch).filter(([k]) => allowed.includes(k))
    if (entries.length === 0) return null

    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
    const values = entries.map(([, v]) => v)
    return db
      .prepare(`UPDATE sprint_tasks SET ${setClauses} WHERE id = ? RETURNING *`)
      .get(...values, id)
  })

  safeHandle('sprint:delete', (_e, id: string) => {
    const db = getDb()
    db.prepare('DELETE FROM sprint_tasks WHERE id = ?').run(id)
    return { ok: true }
  })

  safeHandle('sprint:read-spec-file', async (_e, filePath: string) => {
    const safePath = validateSpecPath(filePath)
    return readFile(safePath, 'utf-8')
  })

  safeHandle('sprint:readLog', async (_e, agentId: string) => {
    const db = getDb()
    const agent = db.prepare('SELECT log_path, status FROM agent_runs WHERE id = ?').get(agentId) as
      | { log_path: string | null; status: string }
      | undefined

    if (!agent?.log_path) return { content: '', status: agent?.status ?? 'unknown' }

    const content = await readFile(agent.log_path, 'utf-8').catch(() => '')
    return { content, status: agent.status }
  })
}
