/**
 * Sprint spec I/O and local spec generation.
 * Extracted from sprint-local.ts to isolate file system
 * concerns from CRUD handler registration.
 */
import { readFile } from 'fs/promises'
import { realpathSync } from 'fs'
import { resolve } from 'path'
import { getSpecsRoot } from '../paths'
import { buildQuickSpecPrompt, getTemplateScaffold } from '../services/spec-template-service'

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
    throw new Error('Spec file storage is not configured for this repository')
  }
  const resolved = resolve(specsRoot, relativePath)
  // SP-5: Resolve symlinks before checking path containment
  let realPath: string
  try {
    realPath = realpathSync(resolved)
  } catch (_err) {
    // File doesn't exist yet or can't be accessed - use resolved path for validation
    // This allows creating new files while still blocking traversal attempts
    realPath = resolved
  }
  const realSpecsRoot = realpathSync(specsRoot)
  if (!realPath.startsWith(realSpecsRoot + '/') && realPath !== realSpecsRoot) {
    throw new Error(`Path traversal blocked: "${relativePath}" resolves outside ${specsRoot}`)
  }
  return resolved
}

// --- Spec file I/O ---

export async function readSpecFile(filePath: string): Promise<string> {
  const safePath = validateSpecPath(filePath)
  return readFile(safePath, 'utf-8')
}

// --- Local prompt generation ---

export function generatePrompt(args: GeneratePromptRequest): GeneratePromptResponse {
  const { taskId, title, repo, templateHint } = args
  const templateScaffold = getTemplateScaffold(templateHint)
  const prompt = buildQuickSpecPrompt(title, repo, templateHint, templateScaffold)
  return { taskId, spec: '', prompt }
}
