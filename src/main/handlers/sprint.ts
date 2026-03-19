import { safeHandle } from '../ipc-utils'
import { getGatewayConfig, getTaskRunnerConfig } from '../config'
import { SPECS_ROOT } from '../paths'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import type { SprintTask } from '../../shared/types'

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

// --- Task Runner HTTP client ---

async function taskRunnerFetch<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const cfg = getTaskRunnerConfig()
  if (!cfg) throw new Error('Task runner not configured — check openclaw.json for taskRunnerUrl + sprintApiKey')
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Task runner ${method} ${path} → ${res.status}: ${text}`)
  }
  if (res.status === 204) return null as T
  return res.json() as Promise<T>
}

// --- Handler registration ---

export function registerSprintHandlers(): void {
  safeHandle('sprint:list', () =>
    taskRunnerFetch<SprintTask[]>('GET', '/tasks')
  )

  safeHandle('sprint:create', (_e, task: CreateTaskInput) =>
    taskRunnerFetch('POST', '/tasks', {
      title: task.title,
      repo: task.repo,
      prompt: task.prompt ?? task.spec ?? task.title,
      spec: task.spec ?? null,
      notes: task.notes ?? null,
      priority: task.priority ?? 0,
      status: task.status ?? 'backlog',
    })
  )

  safeHandle('sprint:update', (_e, id: string, patch: Record<string, unknown>) =>
    taskRunnerFetch('PATCH', `/tasks/${id}`, patch)
  )

  safeHandle('sprint:delete', async (_e, id: string) => {
    await taskRunnerFetch('DELETE', `/tasks/${id}`)
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

        // Persist generated spec back to task runner via PATCH
        await taskRunnerFetch('PATCH', `/tasks/${taskId}`, { spec: text, prompt: text })

        return { taskId, spec: text, prompt: text }
      } catch {
        return fallback
      }
    }
  )

  safeHandle('sprint:healthCheck', () =>
    taskRunnerFetch<SprintTask[]>('GET', '/health')
  )

  safeHandle('sprint:readLog', async (_e, agentId: string, rawFromByte?: number) => {
    const fromByte = typeof rawFromByte === 'number' ? rawFromByte : 0
    const cfg = getTaskRunnerConfig()
    if (!cfg) return { content: '', status: 'unknown', nextByte: fromByte }

    const res = await fetch(`${cfg.url}/agents/${agentId}/log`, {
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
    })
    if (!res.ok) return { content: '', status: 'unknown', nextByte: fromByte }

    const fullContent = await res.text()
    const bytes = Buffer.from(fullContent, 'utf-8')
    if (fromByte >= bytes.length) return { content: '', status: 'done', nextByte: fromByte }
    const slice = bytes.subarray(fromByte).toString('utf-8')
    return { content: slice, status: 'done', nextByte: bytes.length }
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
