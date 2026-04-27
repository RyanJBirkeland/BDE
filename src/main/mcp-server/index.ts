import http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { broadcast } from '../broadcast'
import { createLogger, logError, type Logger } from '../logger'
import {
  TaskTransitionError,
  cancelTask,
  createTaskWithValidation,
  getTask,
  getTaskChanges,
  listTasks,
  updateTask
} from '../services/sprint-service'
import type { CancelTaskResult } from '../services/sprint-use-cases'
import type { EpicGroupService } from '../services/epic-group-service'
import type { TaskStatus } from '../../shared/task-state-machine'
import { readOrCreateToken } from './token-store'
import { createTransportHandler } from './transport'
import { registerTaskTools } from './tools/tasks'
import { registerEpicTools } from './tools/epics'
import { registerMetaTools } from './tools/meta'
import { createReposCache } from './repos-cache'
import { McpDomainError, McpErrorCode, writeJsonRpcError } from './errors'
import { wrapServerWithSafeToolHandlers } from './safe-tool-handler'
import { closeQuietly } from './close-quietly'

const logger = createLogger('mcp-server')

/** Upper bound on how long request headers may trickle in (T-26). */
const HEADERS_TIMEOUT_MS = 30_000
/** Upper bound on a full request body read (T-26). */
const REQUEST_TIMEOUT_MS = 60_000
/** Keep-alive idle window — short so sockets don't linger (T-26). */
const KEEP_ALIVE_TIMEOUT_MS = 5_000
/** How long `stop()` waits for graceful close before force-closing sockets (T-27). */
const CLOSE_GRACE_MS = 3_000
/** Hard ceiling on the whole shutdown — `stop()` resolves regardless after this (T-27). */
const CLOSE_HARD_DEADLINE_MS = 5_000

export interface McpServerConfig {
  port: number
}

export interface McpServerDeps {
  epicService: EpicGroupService
  onStatusTerminal: (taskId: string, status: TaskStatus) => void | Promise<void>
  taskStateService: import('../services/task-state-service').TaskStateService
}

export interface McpServerHandle {
  start(): Promise<number>
  stop(): Promise<void>
}

export function createMcpServer(deps: McpServerDeps, config: McpServerConfig): McpServerHandle {
  let httpServer: http.Server | null = null
  let transportHandler: ReturnType<typeof createTransportHandler> | null = null
  const reposCache = createReposCache()

  function buildMcp(): McpServer {
    const mcp = wrapServerWithSafeToolHandlers(
      new McpServer({ name: 'bde', version: '1.0.0' }),
      logger
    )

    registerMetaTools(mcp, {
      getRepos: reposCache.getRepos
    })

    registerTaskTools(mcp, {
      listTasks,
      getTask,
      createTaskWithValidation,
      updateTask,
      cancelTask: cancelTaskForMcp,
      getTaskChanges: (id, options) => getTaskChanges(id, options),
      onStatusTerminal: deps.onStatusTerminal,
      taskStateService: deps.taskStateService,
      logger
    })

    registerEpicTools(mcp, { epicService: deps.epicService })

    return mcp
  }

  async function cancelTaskForMcp(
    id: string,
    reason?: string,
    options?: { caller?: string }
  ): Promise<CancelTaskResult> {
    try {
      return await cancelTask(
        id,
        {
          ...(reason !== undefined ? { reason } : {}),
          ...(options?.caller !== undefined ? { caller: options.caller } : {})
        },
        { onStatusTerminal: deps.onStatusTerminal, logger }
      )
    } catch (err) {
      throw translateCancelError(err)
    }
  }

  return {
    async start(): Promise<number> {
      const { token, created, path: tokenPath } = await readOrCreateToken(undefined, { logger })

      return new Promise<number>((resolve, reject) => {
        httpServer = bindHttpServer({
          configuredPort: config.port,
          onRequest: (req, res) => routeRequest(req, res, transportHandler),
          onListenError: (err) => {
            logError(logger, `MCP server listen(${config.port})`, err)
            broadcast('manager:warning', { message: summarizeListenError(err, config.port) })
            reject(err)
          },
          onListening: (actualPort) => {
            transportHandler = createTransportHandler(buildMcp, token, actualPort, logger)
            announceReady(actualPort, tokenPath, created)
            resolve(actualPort)
          }
        })
      })
    },

    async stop(): Promise<void> {
      if (transportHandler) {
        await closeQuietly(transportHandler, 'transport', logger)
        transportHandler = null
      }
      if (httpServer) {
        await closeHttpServerWithDeadline(httpServer, logger, {
          graceMs: CLOSE_GRACE_MS,
          hardDeadlineMs: CLOSE_HARD_DEADLINE_MS
        })
        httpServer = null
        logger.info('Stopped')
      }
    }
  }
}

/**
 * Build, wire, and start the HTTP server. Timeouts are applied before
 * `listen()` so a pathological client that connects in the bind window
 * cannot hold the Electron main event loop. On a late listener `'error'`
 * the server is closed before the caller's `onListenError` fires so we
 * never leak a half-bound socket.
 */
function bindHttpServer(opts: {
  configuredPort: number
  onRequest: http.RequestListener
  onListenError: (err: Error) => void
  onListening: (actualPort: number) => void
}): http.Server {
  const server = http.createServer(opts.onRequest)
  applyServerTimeouts(server)
  server.on('error', (err) => {
    server.close(() => {})
    opts.onListenError(err)
  })
  server.listen(opts.configuredPort, '127.0.0.1', () => {
    opts.onListening(resolveActualPort(server, opts.configuredPort))
  })
  return server
}

function applyServerTimeouts(server: http.Server): void {
  server.headersTimeout = HEADERS_TIMEOUT_MS
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS
}

function resolveActualPort(server: http.Server, fallback: number): number {
  const addr = server.address()
  return typeof addr === 'object' && addr ? addr.port : fallback
}

/**
 * Forward one incoming request to the transport handler. When a request
 * arrives before `listen()` has resolved — the transport handler cannot
 * yet be built because it needs the bound port — answer with a 503 so
 * the client sees a structured JSON-RPC error instead of a crash from
 * dereferencing a `null` handler.
 */
function routeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handler: ReturnType<typeof createTransportHandler> | null
): void {
  if (!handler) {
    writeJsonRpcError(res, 503, new Error('MCP server not ready'), { logger })
    return
  }
  handler.handle(req, res).catch((err) => {
    logger.error(
      `mcp transport unhandled: ${req.method ?? '?'} ${req.url ?? '?'} — ${formatRequestError(err)}`
    )
    writeJsonRpcError(res, 500, err, { logger })
  })
}

function announceReady(actualPort: number, tokenPath: string, freshlyMinted: boolean): void {
  logger.info(`Listening on http://127.0.0.1:${actualPort}/mcp`)
  logger.info(`MCP bearer token at ${tokenPath}${freshlyMinted ? ' (newly minted)' : ''}`)
  if (freshlyMinted) {
    broadcast('manager:warning', {
      message: `BDE MCP: fresh token minted at ${tokenPath}. Re-copy into your MCP client config.`
    })
  }
}

/**
 * Shut the HTTP server down within a bounded deadline. `close()` waits
 * for every open socket to drain, which a slow or stuck client can stall
 * indefinitely — the grace timer calls `closeAllConnections()` to force
 * remaining sockets shut, and the hard deadline guarantees the caller's
 * promise always resolves so Electron's `before-quit` handler never
 * hangs.
 */
async function closeHttpServerWithDeadline(
  server: http.Server,
  log: Logger,
  deadlines: { graceMs: number; hardDeadlineMs: number }
): Promise<void> {
  let forceTimer: NodeJS.Timeout | null = null
  const gracefulClose = new Promise<void>((resolve) => {
    server.close(() => resolve())
    forceTimer = setTimeout(() => {
      log.warn(
        `MCP server still had open sockets after ${deadlines.graceMs}ms — force-closing remaining connections.`
      )
      server.closeAllConnections()
    }, deadlines.graceMs)
  })
  const hardDeadline = new Promise<void>((resolve) =>
    setTimeout(() => {
      log.warn(
        `MCP server close exceeded ${deadlines.hardDeadlineMs}ms hard deadline — resolving anyway.`
      )
      resolve()
    }, deadlines.hardDeadlineMs)
  )
  try {
    await Promise.race([gracefulClose, hardDeadline])
  } finally {
    if (forceTimer) clearTimeout(forceTimer)
  }
}

function formatRequestError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message
  return String(err)
}

/**
 * Build a user-safe summary of an HTTP listener error for the renderer
 * `manager:warning` broadcast. Full detail (including stack) is written
 * to `~/.bde/bde.log` via `logError`; the broadcast body gets the minimum
 * needed for an operator to act. Raw error messages and stack frames are
 * withheld to avoid leaking filesystem paths or internal error shapes
 * through a renderer surface.
 */
export function summarizeListenError(err: unknown, configuredPort: number): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code === 'EADDRINUSE') {
    return `MCP server could not bind to port ${configuredPort} — already in use.`
  }
  return 'MCP server failed to start. See ~/.bde/bde.log for details.'
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
