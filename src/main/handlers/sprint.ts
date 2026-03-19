import { readFile, open } from 'fs/promises'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'
import { getGatewayConfig } from '../config'
import { SPECS_ROOT, LIFE_OS_ENV_PATH } from '../paths'

function validateSpecPath(relativePath: string): string {
  const resolved = resolve(SPECS_ROOT, relativePath)
  if (!resolved.startsWith(SPECS_ROOT + '/') && resolved !== SPECS_ROOT) {
    throw new Error(`Path traversal blocked: "${relativePath}" resolves outside ${SPECS_ROOT}`)
  }
  return resolved
}

// --- Types ---

interface GeneratePromptRequest {
  taskId: string
  title: string
  repo: string
  templateHint: string
}

interface GeneratePromptResponse {
  taskId: string
  spec: string
  prompt: string
}

export interface CreateTaskInput {
  title: string
  repo: string
  prompt?: string
  notes?: string
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
    const envPath = LIFE_OS_ENV_PATH
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

  // TODO: AX-S1 — add 'sprint:list', 'sprint:create', 'sprint:update', 'sprint:delete', 'sprint:readLog' to IpcChannelMap
  safeHandle('sprint:list', () => {
    const db = getDb()
    return db
      .prepare('SELECT * FROM sprint_tasks ORDER BY priority ASC, created_at DESC')
      .all()
  })

  safeHandle('sprint:create', (_e, task: CreateTaskInput) => {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO sprint_tasks (title, repo, prompt, spec, notes, priority, status)
      VALUES (@title, @repo, @prompt, @spec, @notes, @priority, @status)
      RETURNING *
    `)
    return stmt.get({
      title: task.title,
      repo: task.repo,
      prompt: task.prompt ?? task.spec ?? task.title,
      spec: task.spec ?? null,
      notes: task.notes ?? null,
      priority: task.priority ?? 0,
      status: task.status ?? 'backlog',
    })
  })

  safeHandle('sprint:update', (_e, id: string, patch: Record<string, unknown>) => {
    const db = getDb()
    const allowed = [
      'title', 'prompt', 'repo', 'status', 'priority', 'spec', 'notes',
      'pr_url', 'pr_number', 'pr_status', 'pr_mergeable_state',
      'agent_run_id', 'started_at', 'completed_at',
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

  safeHandle('sprint:readSpecFile', async (_e, filePath: string) => {
    const safePath = validateSpecPath(filePath)
    return readFile(safePath, 'utf-8')
  })

  safeHandle(
    'sprint:generatePrompt',
    async (_e, args: GeneratePromptRequest): Promise<GeneratePromptResponse> => {
      const { taskId, title, repo, templateHint } = args
      const fallback: GeneratePromptResponse = { taskId, spec: '', prompt: title }

      try {
        const { url: rawGatewayUrl, token: gatewayToken } = getGatewayConfig()
        // getGatewayConfig may return a ws:// URL — normalize to http:// for REST calls
        const gatewayUrl = rawGatewayUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://')

        const templateScaffold = getTemplateScaffold(templateHint)
        const message = buildQuickSpecPrompt(title, repo, templateHint, templateScaffold)

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 55_000)
        let response: Response
        try {
          response = await fetch(`${gatewayUrl}/tools/invoke`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${gatewayToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tool: 'sessions_send',
              // 'bde-spec-gen' session is not configured — send to main session
              args: { sessionKey: 'main', message, timeoutSeconds: 45 },
            }),
            signal: controller.signal,
          })
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw new Error('Spec generation timed out — gateway unreachable')
          }
          throw err
        } finally {
          clearTimeout(timeoutId)
        }

        if (!response.ok) return fallback

        const data = (await response.json()) as {
          result?: { content?: Array<{ type: string; text: string }> }
        }
        const text = data.result?.content?.[0]?.text ?? ''
        if (!text) return fallback

        // Persist the generated spec + prompt to SQLite
        const db = getDb()
        db.prepare('UPDATE sprint_tasks SET spec = ?, prompt = ? WHERE id = ?').run(
          text,
          text,
          taskId
        )

        return { taskId, spec: text, prompt: text }
      } catch {
        return fallback
      }
    }
  )

  safeHandle('sprint:healthCheck', () => {
    const db = getDb()
    return db
      .prepare(
        `SELECT st.*
         FROM sprint_tasks st
         LEFT JOIN agent_runs ar ON ar.id = st.agent_run_id
         WHERE st.status = 'active'
           AND (
             st.agent_run_id IS NULL
             OR ar.id IS NULL
             OR ar.status NOT IN ('running')
           )`
      )
      .all()
  })

  safeHandle('sprint:readLog', async (_e, agentId: string, rawFromByte?: number) => {
    const fromByte = typeof rawFromByte === 'number' ? rawFromByte : 0
    const db = getDb()
    const agent = db.prepare('SELECT log_path, status FROM agent_runs WHERE id = ?').get(agentId) as
      | { log_path: string | null; status: string }
      | undefined

    if (!agent?.log_path) return { content: '', status: agent?.status ?? 'unknown', nextByte: fromByte }

    let fh: import('fs/promises').FileHandle | undefined
    try {
      fh = await open(agent.log_path, 'r')
      const stats = await fh.stat()
      const size = stats.size
      if (fromByte >= size) return { content: '', status: agent.status, nextByte: fromByte }
      const buf = Buffer.alloc(size - fromByte)
      await fh.read(buf, 0, buf.length, fromByte)
      return { content: buf.toString('utf-8'), status: agent.status, nextByte: size }
    } catch {
      return { content: '', status: agent.status, nextByte: fromByte }
    } finally {
      await fh?.close()
    }
  })
}

function buildQuickSpecPrompt(
  title: string,
  repo: string,
  templateHint: string,
  scaffold: string
): string {
  return `You are writing a coding agent spec. Be precise. Name exact files. No preamble.

Task: "${title}"
Repo: ${repo}
Type: ${templateHint}

${scaffold ? `Use this structure:\n${scaffold}` : 'Use sections: Problem, Solution, Files to Change, Out of Scope'}

Rules:
- Exact file paths (e.g. src/renderer/src/components/sprint/SprintCenter.tsx)
- Exact code changes (not "update the function" but "add X to Y")
- Out of Scope: 2-3 bullet points max
- Output ONLY the spec markdown. No commentary.`
}

function getTemplateScaffold(templateHint: string): string {
  const SCAFFOLDS: Record<string, string> = {
    bugfix: `## Bug Description\n\n## Root Cause\n\n## Fix\n\n## Files to Change\n\n## How to Test`,
    feature: `## Problem\n\n## Solution\n\n## Files to Change\n\n## Out of Scope`,
    refactor: `## What's Being Refactored\n\n## Target State\n\n## Files to Change\n\n## Out of Scope`,
    test: `## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n\n## Out of Scope`,
    performance: `## What's Slow\n\n## Approach\n\n## Files to Change\n\n## How to Verify`,
    ux: `## UX Problem\n\n## Target Design\n\n## Files to Change (CSS + TSX)\n\n## Out of Scope`,
    audit: `## Audit Scope\n\n## Criteria\n\n## Deliverable`,
    infra: `## What's Being Changed\n\n## Steps\n\n## Verification`,
  }
  return SCAFFOLDS[templateHint] ?? SCAFFOLDS.feature
}
