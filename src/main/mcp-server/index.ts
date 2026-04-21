import http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { broadcast } from '../broadcast'
import { createLogger } from '../logger'
import {
  TaskTransitionError,
  cancelTask,
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
import { McpDomainError, McpErrorCode, writeJsonRpcError } from './errors'
import { wrapServerWithSafeToolHandlers } from './safe-tool-handler'

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
    const mcp = wrapServerWithSafeToolHandlers(
      new McpServer({ name: 'bde', version: '1.0.0' }),
      logger
    )

    registerMetaTools(mcp, {
      getRepos: () => getSettingJson<RepoConfig[]>('repos') ?? []
    })

    registerTaskTools(mcp, {
      listTasks,
      getTask,
      createTaskWithValidation,
      updateTask,
      cancelTask: cancelTaskForMcp,
      getTaskChanges: (id, options) => getTaskChanges(id, options),
      onStatusTerminal: deps.onStatusTerminal,
      logger
    })

    registerEpicTools(mcp, { epicService: deps.epicService })

    return mcp
  }

  async function cancelTaskForMcp(
    id: string,
    reason?: string
  ): ReturnType<typeof cancelTask> {
    try {
      return await cancelTask(id, { reason }, { onStatusTerminal: deps.onStatusTerminal, logger })
    } catch (err) {
      throw translateCancelError(err)
    }
  }

  return {
    async start(): Promise<number> {
      const { token, created, path: tokenPath } = await readOrCreateToken(undefined, { logger })

      return new Promise<number>((resolve, reject) => {
        httpServer = http.createServer((req, res) => {
          transportHandler!.handle(req, res).catch((err) => {
            logger.error(
              `mcp transport unhandled: ${req.method ?? '?'} ${req.url ?? '?'} — ${formatRequestError(err)}`
            )
            writeJsonRpcError(res, 500, err, { logger })
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
          transportHandler = createTransportHandler(buildMcp, token, actualPort, logger)
          logger.info(`Listening on http://127.0.0.1:${actualPort}/mcp`)
          logger.info(`MCP bearer token at ${tokenPath}${created ? ' (newly minted)' : ''}`)
          if (created) {
            broadcast('manager:warning', {
              message: `BDE MCP: fresh token minted at ${tokenPath}. Re-copy into your MCP client config.`
            })
          }
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

function formatRequestError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message
  return String(err)
}

/**
 * Translate service-layer throws from `cancelTask` into the MCP error
 * vocabulary. Exported for unit tests — the production call site lives
 * inside `createMcpServer`'s `cancelTaskForMcp` closure.
 */
export function translateCancelError(err: unknown): unknown {
  if (err instanceof TaskTransitionError) {
    return new McpDomainError(err.message, McpErrorCode.InvalidTransition, {
      taskId: err.taskId,
      fromStatus: err.fromStatus,
      toStatus: err.toStatus
    })
  }
  return err
}
