import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { safeHandle } from '../ipc-utils'

// --- Types ---

interface SupabaseEnv {
  url: string
  serviceKey: string
}

export interface CreateTaskInput {
  title: string
  repo: string
  description?: string
  spec?: string
  priority?: number
  status?: string
}

// --- Env Resolution ---

let cachedEnv: SupabaseEnv | null = null

function resolveSupabaseEnv(): SupabaseEnv {
  if (cachedEnv) return cachedEnv

  let url = process.env['VITE_SUPABASE_URL'] ?? ''
  let serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''

  if (!url || !serviceKey) {
    // Fallback: read from life-os .env
    try {
      const envPath = join(homedir(), 'Documents', 'Repositories', 'life-os', '.env')
      const raw = readFileSync(envPath, 'utf-8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue
        const eqIdx = trimmed.indexOf('=')
        const key = trimmed.slice(0, eqIdx).trim()
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
        if (key === 'VITE_SUPABASE_URL' && !url) url = val
        if (key === 'SUPABASE_SERVICE_ROLE_KEY' && !serviceKey) serviceKey = val
      }
    } catch {
      // .env not found — will fail on first request
    }
  }

  if (!url || !serviceKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'Set them in env or ~/Documents/Repositories/life-os/.env'
    )
  }

  cachedEnv = { url, serviceKey }
  return cachedEnv
}

// --- Supabase REST ---

async function supabaseFetch(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown
): Promise<unknown> {
  const { url, serviceKey } = resolveSupabaseEnv()
  const endpoint = `${url}/rest/v1/${path}`

  const headers: Record<string, string> = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: method === 'POST' ? 'return=representation' : 'return=representation',
  }

  const res = await fetch(endpoint, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase ${method} ${path} failed (${res.status}): ${text}`)
  }

  const text = await res.text()
  if (!text) return null
  return JSON.parse(text)
}

// --- Migration: ensure 'backlog' status is allowed ---

async function ensureBacklogStatus(): Promise<void> {
  try {
    // Try inserting and immediately deleting a backlog task to test the constraint.
    // If backlog is already valid, this is a no-op.
    // If not, we run the migration.
    await supabaseFetch(
      'sprint_tasks?id=eq.__backlog_migration_test__',
      'DELETE'
    )

    // Attempt the migration via RPC if the table uses a check constraint
    // PostgREST doesn't allow DDL, so we try a test insert instead.
    const testResult = await supabaseFetch('sprint_tasks', 'POST', {
      title: '__backlog_status_test__',
      repo: 'test',
      status: 'backlog',
      priority: 999,
    }) as Array<{ id: string }> | null

    // Clean up the test row
    if (testResult && Array.isArray(testResult) && testResult.length > 0) {
      await supabaseFetch(`sprint_tasks?id=eq.${testResult[0].id}`, 'DELETE')
    }
  } catch (err) {
    console.warn('[sprint] backlog status validation failed — may need manual migration:', err)
    console.warn(
      '[sprint] Run: ALTER TABLE sprint_tasks DROP CONSTRAINT IF EXISTS sprint_tasks_status_check; ' +
        "ALTER TABLE sprint_tasks ADD CONSTRAINT sprint_tasks_status_check " +
        "CHECK (status IN ('backlog', 'queued', 'active', 'done', 'cancelled'));"
    )
  }
}

// --- IPC Registration ---

export function registerSprintHandlers(): void {
  // Run migration check on startup (non-blocking)
  ensureBacklogStatus().catch((err) =>
    console.warn('[sprint] migration check failed:', err)
  )

  safeHandle('sprint:list', async () => {
    return supabaseFetch('sprint_tasks?order=priority.asc,created_at.desc&limit=200&select=*')
  })

  safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
    const payload = {
      title: task.title,
      repo: task.repo,
      description: task.description ?? null,
      spec: task.spec ?? null,
      priority: task.priority ?? 0,
      status: task.status ?? 'backlog',
    }
    const result = await supabaseFetch('sprint_tasks', 'POST', payload)
    return Array.isArray(result) ? result[0] : result
  })

  safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
    const result = await supabaseFetch(`sprint_tasks?id=eq.${id}`, 'PATCH', patch)
    return Array.isArray(result) ? result[0] : result
  })

  safeHandle('sprint:delete', async (_e, id: string) => {
    await supabaseFetch(`sprint_tasks?id=eq.${id}`, 'DELETE')
    return { ok: true }
  })
}
