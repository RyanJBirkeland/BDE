/**
 * supabase-import.ts — One-time async import of sprint tasks from Supabase into local SQLite.
 *
 * This module is intentionally separate from the synchronous migration system.
 * Migrations run synchronously in a transaction; network I/O cannot be done there.
 *
 * Call `importSprintTasksFromSupabase(db)` once at startup after migrations have run.
 * It is a no-op if the local table already has rows, credentials are missing, or the fetch fails.
 */

import type Database from 'better-sqlite3'
import { createLogger } from '../logger'
import { getSetting, deleteSetting } from './settings-queries'
import { SETTING_SUPABASE_URL, SETTING_SUPABASE_KEY } from '../settings'

const logger = createLogger('supabase-import')

interface SupabaseSprintTaskRow {
  id: string
  title: string
  prompt: string | null
  repo: string | null
  status: string
  priority: number | null
  spec: string | null
  notes: string | null
  pr_url: string | null
  pr_number: number | null
  pr_status: string | null
  pr_mergeable_state: string | null
  agent_run_id: string | null
  retry_count: number | null
  fast_fail_count: number | null
  started_at: string | null
  completed_at: string | null
  claimed_by: string | null
  template_name: string | null
  depends_on: unknown | null
  playground_enabled: boolean | null
  needs_review: boolean | null
  max_runtime_ms: number | null
  created_at: string | null
  updated_at: string | null
}

/**
 * Import sprint tasks from Supabase into the local SQLite database.
 *
 * - Only runs if local `sprint_tasks` table is empty.
 * - Uses INSERT OR IGNORE for idempotency.
 * - Silent no-op if credentials are missing or the fetch fails.
 */
export async function importSprintTasksFromSupabase(db: Database.Database): Promise<void> {
  // DL-10: Read credentials inside transaction to prevent TOCTOU race
  const credentials = db.transaction(() => {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM sprint_tasks').get() as {
      cnt: number
    }
    if (countRow.cnt > 0) {
      return null // Signal to skip import
    }
    // Read credentials atomically with the count check
    return {
      url: getSetting(db, SETTING_SUPABASE_URL),
      key: getSetting(db, SETTING_SUPABASE_KEY)
    }
  })()

  if (!credentials) {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM sprint_tasks').get() as {
      cnt: number
    }
    logger.info(`sprint_tasks already has ${countRow.cnt} rows — skipping Supabase import`)
    return
  }

  const supabaseUrl = credentials.url
  const supabaseKey = credentials.key

  if (!supabaseUrl || !supabaseKey) {
    logger.info('Supabase credentials not configured — skipping import')
    return
  }

  // Fetch all tasks from Supabase
  let rows: SupabaseSprintTaskRow[]
  try {
    const url = `${supabaseUrl}/rest/v1/sprint_tasks?select=*`
    const response = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      logger.warn(`Supabase fetch failed: HTTP ${response.status} ${response.statusText}`)
      return
    }

    rows = (await response.json()) as SupabaseSprintTaskRow[]
  } catch (err) {
    logger.warn(`Supabase fetch error: ${err instanceof Error ? err.message : String(err)}`)
    return
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    logger.info('No tasks returned from Supabase — nothing to import')
    return
  }

  // Insert all rows using INSERT OR IGNORE for idempotency
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sprint_tasks (
      id, title, prompt, repo, status, priority,
      spec, notes, pr_url, pr_number, pr_status, pr_mergeable_state,
      agent_run_id, retry_count, fast_fail_count,
      started_at, completed_at, claimed_by, template_name,
      depends_on, playground_enabled, needs_review, max_runtime_ms,
      created_at, updated_at
    ) VALUES (
      @id, @title, @prompt, @repo, @status, @priority,
      @spec, @notes, @pr_url, @pr_number, @pr_status, @pr_mergeable_state,
      @agent_run_id, @retry_count, @fast_fail_count,
      @started_at, @completed_at, @claimed_by, @template_name,
      @depends_on, @playground_enabled, @needs_review, @max_runtime_ms,
      @created_at, @updated_at
    )
  `)

  // DL-15: Valid status values per schema CHECK constraint
  const VALID_STATUSES = new Set([
    'backlog',
    'queued',
    'blocked',
    'active',
    'done',
    'cancelled',
    'failed',
    'error'
  ])

  const importAll = db.transaction((tasks: SupabaseSprintTaskRow[]) => {
    let imported = 0
    let skipped = 0
    for (const row of tasks) {
      const status = row.status ?? 'backlog'
      // DL-15: Validate status before insert to prevent silent drops
      if (!VALID_STATUSES.has(status)) {
        logger.warn(
          `Skipping task ${row.id} ("${row.title}") with invalid status: "${status}"`
        )
        skipped++
        continue
      }

      insert.run({
        id: row.id,
        title: row.title,
        prompt: row.prompt ?? '',
        repo: row.repo ?? 'bde',
        status,
        priority: row.priority ?? 1,
        spec: row.spec ?? null,
        notes: row.notes ?? null,
        pr_url: row.pr_url ?? null,
        pr_number: row.pr_number ?? null,
        pr_status: row.pr_status ?? null,
        pr_mergeable_state: row.pr_mergeable_state ?? null,
        agent_run_id: row.agent_run_id ?? null,
        retry_count: row.retry_count ?? 0,
        fast_fail_count: row.fast_fail_count ?? 0,
        started_at: row.started_at ?? null,
        completed_at: row.completed_at ?? null,
        claimed_by: row.claimed_by ?? null,
        template_name: row.template_name ?? null,
        // depends_on: JSON stringify if it's an object/array, pass through if already string
        depends_on:
          row.depends_on == null
            ? null
            : typeof row.depends_on === 'string'
              ? row.depends_on
              : JSON.stringify(row.depends_on),
        // booleans → 0/1
        playground_enabled: row.playground_enabled ? 1 : 0,
        needs_review: row.needs_review ? 1 : 0,
        max_runtime_ms: row.max_runtime_ms ?? null,
        created_at: row.created_at ?? new Date().toISOString(),
        updated_at: row.updated_at ?? new Date().toISOString()
      })
      imported++
    }
    return { imported, skipped }
  })

  try {
    const result = importAll(rows)
    logger.info(
      `Imported ${result.imported} sprint tasks from Supabase` +
        (result.skipped > 0 ? ` (skipped ${result.skipped} with invalid status)` : '')
    )

    // DL-6: Delete credentials after successful import to prevent plaintext storage
    try {
      deleteSetting(db, SETTING_SUPABASE_URL)
      deleteSetting(db, SETTING_SUPABASE_KEY)
      logger.info('Supabase credentials deleted after successful import')
    } catch (err) {
      logger.warn(`Failed to delete Supabase credentials: ${err instanceof Error ? err.message : String(err)}`)
    }
  } catch (err) {
    logger.error(`Failed to insert imported tasks: ${err instanceof Error ? err.message : String(err)}`)
  }
}
