/**
 * Dev Playground IPC handlers — validates and broadcasts HTML preview files
 * renderer for inline display in agent chat.
 */
import { readFile, stat } from 'fs/promises'
import { extname, basename, resolve } from 'path'
import { realpathSync } from 'fs'
import { safeHandle } from '../ipc-utils'
import { broadcast } from '../broadcast'
import type { AgentEvent } from '../../shared/types'
import { sanitizePlaygroundHtml } from '../playground-sanitize'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export function registerPlaygroundHandlers(): void {
  safeHandle('playground:show', async (_e, input: { filePath: string; rootPath: string }) => {
    const { filePath, rootPath } = input

    if (!rootPath) {
      throw new Error('rootPath is required for playground file access')
    }

    // Resolve symlinks and enforce path boundary (same pattern as ide-fs-handlers.ts)
    let resolvedRoot: string
    try {
      resolvedRoot = realpathSync(resolve(rootPath))
    } catch {
      resolvedRoot = resolve(rootPath)
    }

    let resolvedPath: string
    try {
      resolvedPath = realpathSync(resolve(filePath))
    } catch {
      resolvedPath = resolve(filePath)
    }

    if (!resolvedPath.startsWith(resolvedRoot + '/') && resolvedPath !== resolvedRoot) {
      throw new Error(`Path traversal blocked: "${filePath}" is outside root "${rootPath}"`)
    }

    // Validate .html extension
    if (extname(resolvedPath).toLowerCase() !== '.html') {
      throw new Error(`Invalid file type: only .html files are supported (got: ${filePath})`)
    }

    // Check file size before reading
    const stats = await stat(resolvedPath)
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`
      )
    }

    // Read and sanitize file content
    const rawHtml = await readFile(resolvedPath, 'utf-8')
    const html = sanitizePlaygroundHtml(rawHtml)
    const filename = basename(resolvedPath)

    // Broadcast agent:playground event to renderer
    const event: AgentEvent = {
      type: 'agent:playground',
      filename,
      html,
      sizeBytes: stats.size,
      timestamp: Date.now()
    }

    // Broadcast via agent:event channel with generic 'playground' agentId
    // NOTE: For manual playground:show calls, we use a generic agentId.
    // Auto-detected playgrounds from run-agent.ts will use the actual agent ID.
    broadcast('agent:event', { agentId: 'playground', event })
  })
}
