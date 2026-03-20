/**
 * Sprint spec I/O and gateway-based spec generation.
 * Extracted from sprint-local.ts to isolate file system
 * and RPC concerns from CRUD handler registration.
 */
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { getGatewayConfig } from '../config'
import { getSpecsRoot } from '../paths'
import { updateTask } from './sprint-local'

// --- Types ---

export interface GeneratePromptRequest {
  taskId: string
  title: string
  repo: string
  templateHint: string
}

export interface GeneratePromptResponse {
  taskId: string
  spec: string
  prompt: string
}

// --- Path validation ---

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

// --- Spec file I/O ---

export async function readSpecFile(filePath: string): Promise<string> {
  const safePath = validateSpecPath(filePath)
  return readFile(safePath, 'utf-8')
}

// --- Prompt construction ---

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

// --- Gateway RPC ---

export async function generatePrompt(
  args: GeneratePromptRequest
): Promise<GeneratePromptResponse> {
  const { taskId, title, repo, templateHint } = args
  const fallback: GeneratePromptResponse = { taskId, spec: '', prompt: title }

  try {
    const gatewayConfig = getGatewayConfig()
    if (!gatewayConfig) return fallback
    const { url: rawGatewayUrl, token: gatewayToken } = gatewayConfig
    const gatewayUrl = rawGatewayUrl
      .replace(/^ws:\/\//, 'http://')
      .replace(/^wss:\/\//, 'https://')

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

    // Persist generated spec — use updateTask() to notify SSE subscribers
    updateTask(taskId, { spec: text, prompt: text })

    return { taskId, spec: text, prompt: text }
  } catch {
    return fallback
  }
}
