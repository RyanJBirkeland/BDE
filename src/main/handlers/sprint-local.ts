import { safeHandle } from '../ipc-utils'
import { getGatewayConfig } from '../config'
import { getDb } from '../db'
import { getSpecsRoot } from '../paths'
import { syncToTaskRunner } from '../adapters/task-runner-sync'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import type { SprintTask } from '../../shared/types'

function validateSpecPath(relativePath: string): string {
  const specsRoot = getSpecsRoot()
  if (!specsRoot) {
    throw new Error('Cannot resolve spec path: BDE repo not configured')
  }
  const resolved = resolve(specsRoot, relativePath)
  if (!resolved.startsWith(specsRoot + '/') && resolved !== specsRoot) {
    throw new Error(`Path traversal blocked: "${relativePath}" resolves outside ${specsRoot}`)
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

// --- Field allowlist for updates ---

const UPDATE_ALLOWLIST = new Set([
  'title',
  'prompt',
  'repo',
  'status',
  'priority',
  'spec',
  'notes',
  'pr_url',
  'pr_number',
  'pr_status',
  'pr_mergeable_state',
  'agent_run_id',
  'started_at',
  'completed_at',
])

// --- Exported helper functions (used by git-handlers, agent-history) ---

export function markTaskDoneByPrNumber(prNumber: number): void {
  try {
    const completedAt = new Date().toISOString()
    getDb()
      .prepare(
        "UPDATE sprint_tasks SET status='done', completed_at=? WHERE pr_number=? AND status='active'"
      )
      .run(completedAt, prNumber)
  } catch (err) {
    console.warn(`[sprint-local] failed to mark task done for PR #${prNumber}:`, err)
  }
}

export function markTaskCancelledByPrNumber(prNumber: number): void {
  try {
    getDb()
      .prepare(
        "UPDATE sprint_tasks SET status='cancelled', completed_at=? WHERE pr_number=? AND status='active'"
      )
      .run(new Date().toISOString(), prNumber)
  } catch (err) {
    console.warn(`[sprint-local] failed to mark task cancelled for PR #${prNumber}:`, err)
  }
}

export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): void {
  if (!mergeableState) return
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?')
      .run(mergeableState, prNumber)
  } catch (err) {
    console.warn(`[sprint-local] failed to update mergeable_state for PR #${prNumber}:`, err)
  }
}

export function clearSprintTaskFk(agentRunId: string): void {
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET agent_run_id = NULL WHERE agent_run_id = ?')
      .run(agentRunId)
  } catch (err) {
    console.warn(`[sprint-local] failed to clear FK for agent_run_id=${agentRunId}:`, err)
  }
}

// --- Pure helper functions (shared with old sprint.ts) ---

export function buildQuickSpecPrompt(
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

export function getTemplateScaffold(templateHint: string): string {
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

// --- Handler registration ---

export function registerSprintLocalHandlers(): void {
  safeHandle('sprint:list', () => {
    return getDb()
      .prepare('SELECT * FROM sprint_tasks ORDER BY priority ASC, created_at DESC')
      .all() as SprintTask[]
  })

  safeHandle('sprint:create', (_e, task: CreateTaskInput) => {
    const row = getDb()
      .prepare(
        `INSERT INTO sprint_tasks (title, repo, prompt, spec, notes, priority, status)
         VALUES (@title, @repo, @prompt, @spec, @notes, @priority, @status)
         RETURNING *`
      )
      .get({
        title: task.title,
        repo: task.repo,
        prompt: task.prompt ?? task.spec ?? task.title,
        spec: task.spec ?? null,
        notes: task.notes ?? null,
        priority: task.priority ?? 0,
        status: task.status ?? 'backlog',
      }) as SprintTask

    syncToTaskRunner('POST', '/tasks', row)

    return row
  })

  safeHandle('sprint:update', (_e, id: string, patch: Record<string, unknown>) => {
    const entries = Object.entries(patch).filter(([k]) => UPDATE_ALLOWLIST.has(k))
    if (entries.length === 0) return null

    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
    const values = entries.map(([, v]) => v)

    const row = getDb()
      .prepare(`UPDATE sprint_tasks SET ${setClauses} WHERE id = ? RETURNING *`)
      .get(...values, id) as SprintTask | undefined

    if (row) {
      syncToTaskRunner('PATCH', `/tasks/${id}`, patch)
    }

    return row ?? null
  })

  safeHandle('sprint:delete', (_e, id: string) => {
    getDb().prepare('DELETE FROM sprint_tasks WHERE id = ?').run(id)
    syncToTaskRunner('DELETE', `/tasks/${id}`)
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
        const gatewayConfig = getGatewayConfig()
        if (!gatewayConfig) return fallback
        const { url: rawGatewayUrl, token: gatewayToken } = gatewayConfig
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

        // Persist generated spec locally via direct SQLite update
        getDb()
          .prepare('UPDATE sprint_tasks SET spec = ?, prompt = ? WHERE id = ?')
          .run(text, text, taskId)

        return { taskId, spec: text, prompt: text }
      } catch {
        return fallback
      }
    }
  )

  safeHandle('sprint:healthCheck', () => {
    // Local health check — just verify the table is accessible
    return getDb()
      .prepare('SELECT * FROM sprint_tasks LIMIT 1')
      .all() as SprintTask[]
  })

  safeHandle('sprint:readLog', async (_e, agentId: string, rawFromByte?: number) => {
    const fromByte = typeof rawFromByte === 'number' ? rawFromByte : 0
    const agent = getDb()
      .prepare('SELECT log_path, status FROM agent_runs WHERE id = ?')
      .get(agentId) as { log_path: string | null; status: string } | undefined

    if (!agent?.log_path) return { content: '', status: 'unknown', nextByte: fromByte }

    try {
      const fullContent = await readFile(agent.log_path, 'utf-8')
      const bytes = Buffer.from(fullContent, 'utf-8')
      if (fromByte >= bytes.length) return { content: '', status: agent.status, nextByte: fromByte }
      const slice = bytes.subarray(fromByte).toString('utf-8')
      return { content: slice, status: agent.status, nextByte: bytes.length }
    } catch {
      return { content: '', status: agent.status, nextByte: fromByte }
    }
  })
}
