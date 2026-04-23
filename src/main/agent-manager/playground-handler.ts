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

export interface PlaygroundDetector {
  /**
   * Feed every raw SDK message from a single session. Returns a hit only
   * when a `Write` tool has *completed* successfully for a playground
   * content type (.html, .htm, .svg, .md, .markdown, .json). Returns null
   * for every other message — including the tool_use that opens a write,
   * and for writes whose tool_result reports an error.
   */
  onMessage(msg: unknown): PlaygroundWriteResult | null
}

/**
 * Creates a per-session detector that pairs each Write tool_use block with
 * its matching tool_result block (via tool_use_id), so the caller only sees
 * a hit when the file is guaranteed to exist on disk.
 */
export function createPlaygroundDetector(): PlaygroundDetector {
  const pendingWrites = new Map<string, PlaygroundWriteResult>()

  return {
    onMessage(msg: unknown): PlaygroundWriteResult | null {
      const sdkMsg = asSDKMessage(msg)
      if (!sdkMsg) return null

      const legacyHit = matchLegacyTopLevelToolResult(sdkMsg)
      if (legacyHit) return legacyHit

      if (sdkMsg.type === 'assistant') {
        rememberAssistantWrites(sdkMsg, pendingWrites)
        return null
      }

      if (sdkMsg.type === 'user') {
        return flushMatchingToolResult(sdkMsg, pendingWrites)
      }

      return null
    }
  }
}

/**
 * Pure per-message detector. Preserved for the legacy top-level tool_result
 * wire format (pre-content-block SDK). Current SDK callers should prefer
 * `createPlaygroundDetector` — it handles the correlation required by the
 * current `tool_use` / `tool_result` content-block protocol.
 */
export function detectPlaygroundWrite(msg: unknown): PlaygroundWriteResult | null {
  const sdkMsg = asSDKMessage(msg)
  if (!sdkMsg) return null
  return matchLegacyTopLevelToolResult(sdkMsg)
}

/** Backward-compat alias — returns only the path for existing callers. */
export function detectHtmlWrite(msg: unknown): string | null {
  return detectPlaygroundWrite(msg)?.path ?? null
}

function matchLegacyTopLevelToolResult(
  sdkMsg: import('./sdk-message-protocol').SDKWireMessage
): PlaygroundWriteResult | null {
  if (sdkMsg.type !== 'tool_result' && sdkMsg.type !== 'result') return null
  const toolName = sdkMsg.tool_name ?? sdkMsg.name ?? ''
  if (toolName.toLowerCase() !== 'write') return null
  const filePath = sdkMsg.input?.file_path as string | undefined
  return buildWriteResult(filePath)
}

function rememberAssistantWrites(
  sdkMsg: import('./sdk-message-protocol').SDKWireMessage,
  pendingWrites: Map<string, PlaygroundWriteResult>
): void {
  const content = sdkMsg.message?.content
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (!isToolUseBlock(block)) continue
    const id = (block as { id?: unknown }).id
    if (typeof id !== 'string') continue
    const toolName = (block.name ?? block.tool_name ?? '').toLowerCase()
    const hit = resolvePlaygroundWriteForTool(toolName, block.input ?? {})
    if (!hit) continue
    pendingWrites.set(id, hit)
  }
}

/**
 * Extracts a playground write result from a tool_use input block.
 * Handles three naming conventions in use across agent backends:
 *  - Claude SDK: `Write` tool with `file_path` (snake_case)
 *  - opencode `edit` tool: modifies a file, uses `filePath` (camelCase)
 *  - opencode `apply_patch` tool: creates/updates files via patch text;
 *    new files appear as `*** Add File: <path>` lines in `patchText`
 */
function resolvePlaygroundWriteForTool(
  toolName: string,
  input: Record<string, unknown>
): PlaygroundWriteResult | null {
  if (toolName === 'write') {
    return buildWriteResult(input.file_path as string | undefined)
  }
  if (toolName === 'edit') {
    const filePath = (input.filePath ?? input.file_path) as string | undefined
    return buildWriteResult(filePath)
  }
  if (toolName === 'apply_patch') {
    return extractNewFileFromPatch(input.patchText as string | undefined)
  }
  return null
}

function extractNewFileFromPatch(patchText: string | undefined): PlaygroundWriteResult | null {
  if (typeof patchText !== 'string') return null
  for (const line of patchText.split('\n')) {
    const match = /^\*\*\* Add File: (.+)$/.exec(line)
    if (!match) continue
    const hit = buildWriteResult(match[1]?.trim())
    if (hit) return hit
  }
  return null
}

function flushMatchingToolResult(
  sdkMsg: import('./sdk-message-protocol').SDKWireMessage,
  pendingWrites: Map<string, PlaygroundWriteResult>
): PlaygroundWriteResult | null {
  const content = sdkMsg.message?.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (!isToolResultBlock(block)) continue
    const toolUseId = (block as { tool_use_id?: unknown }).tool_use_id
    if (typeof toolUseId !== 'string') continue
    const pending = pendingWrites.get(toolUseId)
    pendingWrites.delete(toolUseId)
    if (!pending) continue
    const isError = (block as { is_error?: unknown }).is_error === true
    if (isError) continue
    return pending
  }
  return null
}

function isToolUseBlock(
  block: unknown
): block is {
  type: 'tool_use'
  name?: string
  tool_name?: string
  input?: Record<string, unknown>
} {
  return (
    typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_use'
  )
}

function isToolResultBlock(block: unknown): block is { type: 'tool_result' } {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_result'
  )
}

function buildWriteResult(filePath: string | undefined): PlaygroundWriteResult | null {
  if (!filePath) return null
  const contentType = resolveContentType(filePath)
  if (!contentType) return null
  return { path: filePath, contentType }
}

export interface PlaygroundEmitRequest {
  taskId: string
  filePath: string
  worktreePath: string
  logger: Logger
  contentType?: PlaygroundContentType
  /**
   * Skip the worktree containment check. Adhoc/assistant agents set this
   * because the user directly controls the session and may ask the agent to
   * render files outside the worktree (e.g. /tmp scratch files). DOMPurify
   * sanitization still runs — that is the real security boundary, not the
   * path check.
   */
  allowAnyPath?: boolean
}

/**
 * Attempts to read a playground file and emit an agent:playground event.
 * SVG, markdown, and JSON are sanitized the same way HTML is.
 * Races each I/O step against PLAYGROUND_IO_TIMEOUT_MS to prevent a stalled
 * filesystem from blocking indefinitely.
 * Silently fails if the file doesn't exist, is too large, or times out.
 */
export async function tryEmitPlaygroundEvent(request: PlaygroundEmitRequest): Promise<void> {
  const {
    taskId,
    filePath,
    worktreePath,
    logger,
    contentType = 'html',
    allowAnyPath = false
  } = request
  try {
    // Resolve absolute path
    const absolutePath = filePath.startsWith('/') ? filePath : join(worktreePath, filePath)

    const resolvedPath = await realpath(absolutePath).catch(() => null)
    if (!resolvedPath) {
      logger.warn(`[playground] Path does not exist: ${filePath}`)
      return
    }

    if (!allowAnyPath) {
      const resolvedWorktree = await realpath(worktreePath).catch(() => null)
      if (!resolvedWorktree) {
        logger.warn(`[playground] Worktree path does not exist: ${worktreePath}`)
        return
      }
      if (!resolvedPath.startsWith(resolvedWorktree + '/') && resolvedPath !== resolvedWorktree) {
        logger.warn(
          `[playground] Path traversal blocked: ${filePath} (resolved to ${resolvedPath})`
        )
        return
      }
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
