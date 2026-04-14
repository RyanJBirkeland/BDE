import type { Logger } from '../logger'
import { asSDKMessage } from './sdk-adapter'
import { broadcast } from '../broadcast'
import type { AgentEvent } from '../../shared/types'
import { sanitizePlaygroundHtml } from '../playground-sanitize'
import { readFile, stat } from 'node:fs/promises'
import { extname, basename, join } from 'node:path'

const MAX_PLAYGROUND_SIZE = 5 * 1024 * 1024 // 5MB
const PLAYGROUND_IO_TIMEOUT_MS = 5_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`I/O timeout after ${ms}ms: ${label}`)), ms)
    )
  ])
}

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
 * Races each I/O step against PLAYGROUND_IO_TIMEOUT_MS to prevent a stalled
 * filesystem from blocking indefinitely.
 * Silently fails if the file doesn't exist, is too large, or times out.
 */
export async function tryEmitPlaygroundEvent(
  taskId: string,
  filePath: string,
  worktreePath: string,
  logger: Logger
): Promise<void> {
  try {
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
    const rawHtml = await withTimeout(
      readFile(absolutePath, 'utf-8'),
      PLAYGROUND_IO_TIMEOUT_MS,
      `readFile(${filePath})`
    )
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
    logger.warn(`[playground] Failed to read HTML file ${filePath}: ${err}`)
    // Silently ignore — covers I/O timeouts, missing files, permission errors
  }
}
