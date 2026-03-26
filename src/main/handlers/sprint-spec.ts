/**
 * Sprint spec I/O and local spec generation.
 * Extracted from sprint-local.ts to isolate file system
 * concerns from CRUD handler registration.
 */
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { getSpecsRoot } from '../paths'

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

export function validateSpecPath(relativePath: string): string {
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
    infra: `## What's Being Changed\n\n## Steps\n\n## Verification`
  }
  return SCAFFOLDS[templateHint] ?? SCAFFOLDS.feature
}

// --- Local prompt generation ---

export function generatePrompt(args: GeneratePromptRequest): GeneratePromptResponse {
  const { taskId, title, repo, templateHint } = args
  const templateScaffold = getTemplateScaffold(templateHint)
  const prompt = buildQuickSpecPrompt(title, repo, templateHint, templateScaffold)
  return { taskId, spec: '', prompt }
}
