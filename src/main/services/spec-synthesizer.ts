/**
 * Spec Synthesizer Service — AI-powered spec generation from user answers + codebase context.
 */
import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { buildAgentEnv } from '../env-utils'
import { createLogger } from '../logger'
import type { SynthesizeRequest, ReviseRequest } from '../../shared/types'

const execFileAsync = promisify(execFile)
const log = createLogger('spec-synthesizer')

// --- Types ---

export interface SynthesizeResult {
  spec: string
  filesAnalyzed: string[]
}

interface CodebaseContext {
  claudeMd: string
  fileTree: string
  relevantFiles: Array<{ path: string; content: string }>
}

// --- Active streams for cancellation ---

const activeStreams = new Map<string, { close: () => void }>()

// --- Helper: Gather codebase context ---

async function gatherCodebaseContext(
  repoPath: string,
  answers: Record<string, string>
): Promise<CodebaseContext> {
  const context: CodebaseContext = {
    claudeMd: '',
    fileTree: '',
    relevantFiles: []
  }

  // 1. Read CLAUDE.md from repo root
  try {
    const claudeMdPath = `${repoPath}/CLAUDE.md`
    context.claudeMd = await fs.readFile(claudeMdPath, 'utf-8')
    log.info(`Loaded CLAUDE.md (${context.claudeMd.length} chars)`)
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      log.info('CLAUDE.md not found in repo')
    } else {
      log.warn(`Error reading CLAUDE.md: ${err.message}`)
    }
  }

  // 2. Get file tree via git ls-files (truncate to 500 lines)
  try {
    const { stdout } = await execFileAsync('git', ['ls-files'], {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024
    })
    const lines = stdout.trim().split('\n')
    context.fileTree = lines.slice(0, 500).join('\n')
    log.info(`File tree: ${lines.length} files (showing first 500)`)
  } catch (err: any) {
    log.warn(`Error getting file tree: ${err.message}`)
  }

  // 3. Extract keywords from answer values
  const answerText = Object.values(answers).join(' ')
  const words = answerText
    .split(/[\s.,;:!?()[\]{}'"]+/)
    .filter((w) => w.length >= 3)
  const keywords = Array.from(new Set(words))
    .slice(0, 10)
    .map((k) => k.toLowerCase())
  log.info(`Extracted keywords: ${keywords.join(', ')}`)

  // 4. Grep for each keyword, collect unique file paths (cap at 10 files)
  const matchedFiles = new Set<string>()
  for (const keyword of keywords) {
    if (matchedFiles.size >= 10) break
    try {
      const { stdout } = await execFileAsync(
        'grep',
        ['-rn', '-i', '-l', '--', keyword, '.'],
        {
          cwd: repoPath,
          encoding: 'utf-8',
          maxBuffer: 5 * 1024 * 1024,
          timeout: 5000
        }
      )
      const files = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .filter((f) => !f.includes('node_modules') && !f.includes('.git'))
      for (const file of files) {
        if (matchedFiles.size >= 10) break
        matchedFiles.add(file)
      }
    } catch (err: any) {
      // grep exits with code 1 when no matches found
      if (err.code !== 1) {
        log.warn(`Error grepping for "${keyword}": ${err.message}`)
      }
    }
  }

  // 5. Read top 5 matched files (first 200 lines each)
  const filesToRead = Array.from(matchedFiles).slice(0, 5)
  for (const file of filesToRead) {
    try {
      const fullPath = `${repoPath}/${file}`
      const content = await fs.readFile(fullPath, 'utf-8')

      // Check for binary files (null bytes in first 512 chars)
      const sample = content.slice(0, 512)
      if (sample.includes('\0')) {
        log.info(`Skipping binary file: ${file}`)
        continue
      }

      const lines = content.split('\n').slice(0, 200)
      context.relevantFiles.push({
        path: file,
        content: lines.join('\n')
      })
      log.info(`Read ${file} (${lines.length} lines)`)
    } catch (err: any) {
      log.warn(`Error reading ${file}: ${err.message}`)
    }
  }

  return context
}

// --- Helper: Build spec generation prompt ---

function buildSpecPrompt(request: SynthesizeRequest, context: CodebaseContext): string {
  const { templateName, answers, repo, customPrompt } = request

  // Format answers as Key: Value pairs
  const answersText = Object.entries(answers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')

  // If custom prompt is provided, use it instead
  if (customPrompt) {
    return `${customPrompt}

REPO: ${repo}

${context.claudeMd ? `CLAUDE.md:\n${context.claudeMd}\n\n` : ''}
${context.fileTree ? `FILE TREE (first 500):\n${context.fileTree}\n\n` : ''}
${context.relevantFiles.length > 0 ? `RELEVANT FILES:\n${context.relevantFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n')}\n\n` : ''}`
  }

  // Standard system prompt for spec generation
  const systemPrompt = `You are an expert software engineer writing a precise, actionable coding task specification.

CONTEXT:
- Template: ${templateName}
- Repository: ${repo}
- User Input:
${answersText}

${context.claudeMd ? `\nCLAUDE.md (Project Context):\n${context.claudeMd}\n` : ''}
${context.fileTree ? `\nFILE TREE (first 500 files):\n${context.fileTree}\n` : ''}
${context.relevantFiles.length > 0 ? `\nRELEVANT CODE:\n${context.relevantFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n')}\n` : ''}

TASK:
Write a complete, actionable spec for this coding task. The spec will be executed by an AI coding agent.

REQUIREMENTS:
1. **Exact file paths**: Specify full paths like "src/renderer/src/components/sprint/TaskList.tsx"
2. **Exact code changes**: Show code snippets, not vague instructions like "update the function"
3. **Numbered steps**: Break work into discrete, sequential steps
4. **Verification criteria**: Include how to verify each step worked
5. **Out of scope**: List 2-3 items explicitly NOT included
6. **No preamble**: Output ONLY the spec markdown, starting with a title

STRUCTURE:
Use markdown with these sections (adapt based on template type):
- ## Problem/Background (why this change is needed)
- ## Solution (what will be implemented)
- ## Steps (numbered, with file paths and code snippets)
- ## Verification (how to test)
- ## Out of Scope (what's NOT included)

STYLE:
- Be specific and actionable
- Show exact code changes
- Name exact files
- Keep it concise but complete
- No meta-commentary

Output the spec now:`

  return systemPrompt
}

// --- Helper: Build revision prompt ---

function buildRevisionPrompt(request: ReviseRequest): string {
  const { currentSpec, instruction, stepIndex, repo } = request

  if (stepIndex !== undefined) {
    return `You are revising a coding task specification. The user wants to update ONLY step ${stepIndex}.

CURRENT SPEC:
${currentSpec}

USER INSTRUCTION:
${instruction}

TASK:
Rewrite ONLY step ${stepIndex} based on the user's instruction. Keep all other sections and steps EXACTLY as they are.

Output the complete spec with the revised step:`
  }

  return `You are revising a coding task specification.

CURRENT SPEC:
${currentSpec}

USER INSTRUCTION:
${instruction}

REPO: ${repo}

TASK:
Regenerate the full spec incorporating the user's instruction. Maintain the same structure and style, but apply the requested changes.

Output the revised spec now:`
}

// --- Helper: Run SDK streaming query ---

async function runSdkStreaming(
  prompt: string,
  onChunk: (chunk: string) => void,
  streamId: string,
  timeoutMs = 180_000
): Promise<string> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const env = buildAgentEnv()

  const queryHandle = sdk.query({
    prompt,
    options: {
      model: 'claude-sonnet-4-5',
      maxTurns: 1,
      env: env as Record<string, string>,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true
    }
  })

  activeStreams.set(streamId, { close: () => queryHandle.return() })

  let fullText = ''
  const timer = setTimeout(() => {
    queryHandle.return()
    activeStreams.delete(streamId)
  }, timeoutMs)

  try {
    for await (const msg of queryHandle) {
      if (typeof msg !== 'object' || msg === null) continue
      const m = msg as Record<string, unknown>

      // Extract text from assistant messages
      if (m.type === 'assistant') {
        const message = m.message as Record<string, unknown> | undefined
        const content = message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>
            if (b.type === 'text' && typeof b.text === 'string') {
              fullText += b.text
              onChunk(b.text)
            }
          }
        }
      }
    }
  } finally {
    clearTimeout(timer)
    activeStreams.delete(streamId)
  }

  return fullText.trim()
}

// --- Main: Synthesize spec ---

export async function synthesizeSpec(
  request: SynthesizeRequest,
  onChunk: (chunk: string) => void,
  streamId: string
): Promise<SynthesizeResult> {
  log.info(`Synthesizing spec: ${request.templateName} for ${request.repo}`)

  // Gather codebase context
  const context = await gatherCodebaseContext(request.repoPath, request.answers)

  // Build prompt
  const prompt = buildSpecPrompt(request, context)

  // Stream generation
  const spec = await runSdkStreaming(prompt, onChunk, streamId)

  log.info(`Spec generated: ${spec.length} chars`)
  return {
    spec,
    filesAnalyzed: context.relevantFiles.map((f) => f.path)
  }
}

// --- Main: Revise spec ---

export async function reviseSpec(
  request: ReviseRequest,
  onChunk: (chunk: string) => void,
  streamId: string
): Promise<SynthesizeResult> {
  log.info(`Revising spec for ${request.repo}`)

  // Build prompt
  const prompt = buildRevisionPrompt(request)

  // Stream revision
  const spec = await runSdkStreaming(prompt, onChunk, streamId)

  log.info(`Spec revised: ${spec.length} chars`)
  return {
    spec,
    filesAnalyzed: [] // No codebase analysis for revisions
  }
}

// --- Cancellation ---

export function cancelSynthesis(streamId: string): boolean {
  const handle = activeStreams.get(streamId)
  if (handle) {
    handle.close()
    activeStreams.delete(streamId)
    log.info(`Cancelled synthesis: ${streamId}`)
    return true
  }
  return false
}
