/**
 * Dev Playground IPC handlers — validates and broadcasts HTML preview files
 * to renderer for inline display in agent chat.
 */
import { readFile, stat } from 'fs/promises'
import { extname, basename } from 'path'
import { safeHandle } from '../ipc-utils'
import { broadcast } from '../broadcast'
import type { AgentEvent } from '../../shared/types'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export function registerPlaygroundHandlers(): void {
  safeHandle('playground:show', async (_e, input: { filePath: string }) => {
    const { filePath } = input

    // Validate .html extension
    if (extname(filePath).toLowerCase() !== '.html') {
      throw new Error(`Invalid file type: only .html files are supported (got: ${filePath})`)
    }

    // Check file size before reading
    const stats = await stat(filePath)
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`
      )
    }

    // Read file content
    const html = await readFile(filePath, 'utf-8')
    const filename = basename(filePath)

    // Broadcast agent:playground event to renderer
    const event: AgentEvent = {
      type: 'agent:playground',
      filename,
      html,
      sizeBytes: stats.size,
      timestamp: Date.now(),
    }

    // Broadcast via agent:event channel with generic 'playground' agentId
    // NOTE: For manual playground:show calls, we use a generic agentId.
    // Auto-detected playgrounds from run-agent.ts will use the actual agent ID.
    broadcast('agent:event', { agentId: 'playground', event })
  })
}
