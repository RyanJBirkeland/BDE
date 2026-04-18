import http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { broadcast } from '../broadcast'
import { createLogger } from '../logger'
import {
  createTaskWithValidation,
  getTask,
  listTasks,
  updateTask
} from '../services/sprint-service'
import { getTaskChanges } from '../data/task-changes'
import type { EpicGroupService } from '../services/epic-group-service'
import { getSettingJson } from '../settings'
import type { RepoConfig } from '../paths'
import { readOrCreateToken } from './token-store'
import { createTransportHandler } from './transport'
import { registerTaskTools } from './tools/tasks'
import { registerEpicTools } from './tools/epics'
import { registerMetaTools } from './tools/meta'
import { toJsonRpcError } from './errors'

const logger = createLogger('mcp-server')

export interface McpServerConfig {
  port: number
}

export interface McpServerDeps {
  epicService: EpicGroupService
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface McpServerHandle {
  start(): Promise<number>
  stop(): Promise<void>
}

export function createMcpServer(deps: McpServerDeps, config: McpServerConfig): McpServerHandle {
  let httpServer: http.Server | null = null
  let transportHandler: ReturnType<typeof createTransportHandler> | null = null

  function buildMcp(): McpServer {
    const mcp = new McpServer({ name: 'bde', version: '1.0.0' })

    registerMetaTools(mcp, {
      getRepos: () => getSettingJson<RepoConfig[]>('repos') ?? []
    })

    registerTaskTools(mcp, {
      listTasks,
      getTask,
      createTaskWithValidation,
      updateTask,
      cancelTask: (id, reason) => {
        const patch: Record<string, unknown> = { status: 'cancelled' }
        if (reason) patch.notes = reason
        const row = updateTask(id, patch)
        if (row) {
          Promise.resolve(deps.onStatusTerminal(id, 'cancelled')).catch((err) =>
            logger.error(`onStatusTerminal after cancel ${id}: ${err}`)
          )
        }
        return row
      },
      getTaskChanges: (id, limit) => getTaskChanges(id, limit),
      logger
    })

    registerEpicTools(mcp, { epicService: deps.epicService })

    return mcp
  }

  return {
    async start(): Promise<number> {
      const token = await readOrCreateToken()
      transportHandler = createTransportHandler(buildMcp, token, logger)

      return new Promise<number>((resolve, reject) => {
        httpServer = http.createServer((req, res) => {
          transportHandler!.handle(req, res).catch((err) => {
            const body = JSON.stringify({ jsonrpc: '2.0', error: toJsonRpcError(err) })
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
            }
            res.end(body)
          })
        })
        httpServer.on('error', (err) => {
          const errno = (err as NodeJS.ErrnoException).code
          const msg =
            errno === 'EADDRINUSE'
              ? `MCP server could not bind to port ${config.port} — already in use.`
              : `MCP server failed to start: ${err}`
          logger.error(msg)
          broadcast('manager:warning', { message: msg })
          reject(err)
        })
        httpServer.listen(config.port, '127.0.0.1', () => {
          const addr = httpServer!.address()
          const actualPort = typeof addr === 'object' && addr ? addr.port : config.port
          logger.info(`Listening on http://127.0.0.1:${actualPort}/mcp`)
          resolve(actualPort)
        })
      })
    },

    async stop(): Promise<void> {
      if (transportHandler) {
        await transportHandler.close().catch((err) => logger.warn(`transport close: ${err}`))
        transportHandler = null
      }
      if (httpServer) {
        await new Promise<void>((r) => httpServer!.close(() => r()))
        httpServer = null
        logger.info('Stopped')
      }
    }
  }
}
