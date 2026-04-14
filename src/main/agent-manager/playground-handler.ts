import type { Logger } from '../logger'
import { asSDKMessage } from './sdk-adapter'
import { broadcast } from '../broadcast'
import type { AgentEvent } from '../../shared/types'
import { sanitizePlaygroundHtml } from '../playground-sanitize'
import { readFile, stat } from 'node:fs/promises'
import { extname, basename, join } from 'node:path'

const MAX_PLAYGROUND_SIZE = 5 * 1024 * 1024 // 5MB
const PLAYGROUND_IO_TIMEOUT_MS = 5_000

/**
 * Detects if a message is a tool_result for a Write tool that created an .html file.
 * Returns the file path if detected, null otherwise.
 */
export function detectHtmlWrite(msg: unknown): string | null {
  const m = asSDKMessage(msg)
  if (!m) return null

  // Check if this is a tool_result or result message
  if (m.type !== 'tool_result' && m.type !== 'result') return null

  // Check if the tool is Write (case-insensitive)
  const toolName = m.tool_name ?? m.name ?? ''
  if (toolName.toLowerCase() !== 'write') return null

  // Extract file path from the tool input or output
  // The Write tool typically has input with { file_path: "..." }
  const filePath = m.input?.file_path as string | undefined

  if (!filePath || extname(filePath).toLowerCase() !== '.html') return null

  return filePath
}

/**
 * Attempts to read an HTML file and emit a playground event.
 * Aborts after PLAYGROUND_IO_TIMEOUT_MS to prevent stalled filesystem from blocking indefinitely.
 * Silently fails if the file doesn't exist, is too large, or times out.
 */
export async function tryEmitPlaygroundEvent(
  taskId: string,
  filePath: string,
  worktreePath: string,
  logger: Logger
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
    logger.warn(
      `[playground] File I/O timed out after ${PLAYGROUND_IO_TIMEOUT_MS}ms for ${filePath}`
    )
  }, PLAYGROUND_IO_TIMEOUT_MS)

  try {
    if (controller.signal.aborted) return

    // Resolve absolute path
    const absolutePath = filePath.startsWith('/') ? filePath : join(worktreePath, filePath)

    // Validate path is within worktree (prevent traversal)
    const { resolve } = await import('node:path')
    const resolvedPath = resolve(absolutePath)
    const resolvedWorktree = resolve(worktreePath)
    if (!resolvedPath.startsWith(resolvedWorktree + '/') && resolvedPath !== resolvedWorktree) {
      logger.warn(`[playground] Path traversal blocked: ${filePath} (resolved to ${resolvedPath})`)
      return
    }

    if (controller.signal.aborted) return

    // Check file size
    const stats = await stat(absolutePath)
    if (stats.size > MAX_PLAYGROUND_SIZE) {
      logger.warn(`[playground] File too large (${stats.size} bytes), skipping: ${filePath}`)
      return
    }

    if (controller.signal.aborted) return

    // Read and sanitize file content
    const rawHtml = await readFile(absolutePath, 'utf-8')
    const sanitizedHtml = sanitizePlaygroundHtml(rawHtml)
    const filename = basename(absolutePath)

    const event: AgentEvent = {
      type: 'agent:playground',
      filename,
      html: sanitizedHtml,
      sizeBytes: stats.size,
      timestamp: Date.now()
    }

    broadcast('agent:event', { agentId: taskId, event })
    logger.info(`[playground] Emitted playground event for ${filename} (${stats.size} bytes)`)
  } catch (err) {
    if (!controller.signal.aborted) {
      logger.warn(`[playground] Failed to read HTML file ${filePath}: ${err}`)
    }
  } finally {
    clearTimeout(timer)
  }
}
