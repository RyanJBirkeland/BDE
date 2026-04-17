import type { Logger } from '../logger'
import { asSDKMessage } from './sdk-adapter'
import { emitAgentEvent } from '../agent-event-mapper'
import type { AgentEvent, PlaygroundContentType } from '../../shared/types'
import { sanitizePlaygroundHtml } from '../playground-sanitize'
import { readFile, stat, realpath } from 'node:fs/promises'
import { basename, join } from 'node:path'

const MAX_PLAYGROUND_SIZE = 5 * 1024 * 1024 // 5MB
const PLAYGROUND_IO_TIMEOUT_MS = 5_000

export type { PlaygroundContentType }

export interface PlaygroundWriteResult {
  path: string
  contentType: PlaygroundContentType
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`I/O timeout after ${ms}ms: ${label}`)), ms)
    )
  ])
}

function resolveContentType(filePath: string): PlaygroundContentType | null {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.svg')) return 'svg'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
  if (lower.endsWith('.json')) return 'json'
  return null
}

/**
 * Detects if a message is a tool_result for a Write tool that created a
 * playground-supported file (.html, .htm, .svg, .md, .markdown, .json).
 * Returns path and content type if detected, null otherwise.
 */
export function detectPlaygroundWrite(msg: unknown): PlaygroundWriteResult | null {
  const m = asSDKMessage(msg)
  if (!m) return null

  if (m.type !== 'tool_result' && m.type !== 'result') return null

  const toolName = m.tool_name ?? m.name ?? ''
  if (toolName.toLowerCase() !== 'write') return null

  const filePath = m.input?.file_path as string | undefined
  if (!filePath) return null

  const contentType = resolveContentType(filePath)
  if (!contentType) return null

  return { path: filePath, contentType }
}

/** Backward-compat alias — returns only the path for existing callers. */
export function detectHtmlWrite(msg: unknown): string | null {
  return detectPlaygroundWrite(msg)?.path ?? null
}

/**
 * Attempts to read a playground file and emit an agent:playground event.
 * SVG, markdown, and JSON are sanitized the same way HTML is.
 * Races each I/O step against PLAYGROUND_IO_TIMEOUT_MS to prevent a stalled
 * filesystem from blocking indefinitely.
 * Silently fails if the file doesn't exist, is too large, or times out.
 */
export async function tryEmitPlaygroundEvent(
  taskId: string,
  filePath: string,
  worktreePath: string,
  logger: Logger,
  contentType: PlaygroundContentType = 'html'
): Promise<void> {
  try {
    // Resolve absolute path
    const absolutePath = filePath.startsWith('/') ? filePath : join(worktreePath, filePath)

    // Validate path is within worktree (prevent traversal + symlink bypass).
    // realpath resolves symlinks before comparing, which resolve() does not.
    const resolvedPath = await realpath(absolutePath).catch(() => null)
    const resolvedWorktree = await realpath(worktreePath).catch(() => null)
    if (!resolvedPath || !resolvedWorktree) {
      logger.warn(`[playground] Path does not exist: ${filePath}`)
      return
    }
    if (!resolvedPath.startsWith(resolvedWorktree + '/') && resolvedPath !== resolvedWorktree) {
      logger.warn(`[playground] Path traversal blocked: ${filePath} (resolved to ${resolvedPath})`)
      return
    }

    // Check file size — race against timeout in case of filesystem stall
    const stats = await withTimeout(
      stat(absolutePath),
      PLAYGROUND_IO_TIMEOUT_MS,
      `stat(${filePath})`
    )
    if (stats.size > MAX_PLAYGROUND_SIZE) {
      logger.warn(`[playground] File too large (${stats.size} bytes), skipping: ${filePath}`)
      return
    }

    // Read and sanitize file content — race against timeout
    const rawContent = await withTimeout(
      readFile(absolutePath, 'utf-8'),
      PLAYGROUND_IO_TIMEOUT_MS,
      `readFile(${filePath})`
    )

    // SVG, markdown, and JSON all go through the same DOMPurify sanitization path.
    // This strips script tags and event handlers from SVG, and harmlessly passes
    // markdown/JSON through since they contain no dangerous HTML constructs.
    let sanitizedContent: string
    try {
      sanitizedContent = sanitizePlaygroundHtml(rawContent)
    } catch (err) {
      logger.error(`[playground] Sanitization failed for ${filePath}: ${err}`)
      return // Drop event — never broadcast unsanitized content
    }

    const filename = basename(absolutePath)

    const event: AgentEvent = {
      type: 'agent:playground',
      filename,
      html: sanitizedContent,
      contentType,
      sizeBytes: stats.size,
      timestamp: Date.now()
    }

    emitAgentEvent(taskId, event)
    logger.info(`[playground] Emitted playground event for ${filename} (${stats.size} bytes)`)
  } catch (err) {
    logger.warn(`[playground] Failed to read playground file ${filePath}: ${err}`)
    // Silently ignore — covers I/O timeouts, missing files, permission errors
  }
}
