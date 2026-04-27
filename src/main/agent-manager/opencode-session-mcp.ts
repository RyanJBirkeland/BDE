/**
 * Per-session MCP server for opencode agents.
 *
 * opencode is an external process and can only reach MCP tools over HTTP.
 * Rather than routing through the persistent external MCP server (port 18792,
 * designed for non-BDE-native tools like Claude Desktop and Cursor), this
 * module spins up a lightweight per-session HTTP listener backed by the same
 * sprint-service and EpicGroupService that the in-process planner MCP server
 * uses for Claude agents.
 *
 * The server:
 *   - Binds to 127.0.0.1 on a random free port (OS-assigned via port 0)
 *   - Uses a random per-session bearer token (not the persistent mcp-token file)
 *   - Exposes tasks.*, epics.*, and meta.* — the same vocabulary as the
 *     in-process planner server
 *   - Is torn down when the opencode session closes
 *
 * This keeps the external HTTP MCP server solely for external integrations
 * and gives every opencode agent its own isolated, ephemeral endpoint.
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  cancelTask,
  createTaskWithValidation,
  getTask,
  getTaskChanges,
  listTasks,
  updateTask
} from '../services/sprint-service'
import { registerTaskTools } from '../mcp-server/tools/tasks'
import { registerEpicTools } from '../mcp-server/tools/epics'
import { registerMetaTools } from '../mcp-server/tools/meta'
import { wrapServerWithSafeToolHandlers } from '../mcp-server/safe-tool-handler'
import { getConfiguredRepos } from '../paths'
import { createTaskStateService } from '../services/task-state-service'
import type { EpicGroupService } from '../services/epic-group-service'
import type { Logger } from '../logger'

export interface OpencodeSessionMcpHandle {
  /** Full MCP endpoint URL, e.g. `http://127.0.0.1:52341/mcp` */
  url: string
  /** Random per-session bearer token for the Authorization header */
  token: string
  /** Stops the HTTP server and releases the port */
  close(): Promise<void>
}

const MCP_PATH = '/mcp'
const UNAUTHORIZED_BODY = JSON.stringify({ error: 'Unauthorized' })

/**
 * Starts a per-session MCP HTTP server for an opencode agent.
 * Returns the URL and bearer token to inject into the opencode worktree config,
 * plus a `close()` to call when the session ends.
 */
export async function startOpencodeSessionMcp(
  epicService: EpicGroupService,
  logger: Logger
): Promise<OpencodeSessionMcpHandle> {
  const token = randomBytes(24).toString('hex')
  const httpServer = http.createServer()

  httpServer.on('request', (req, res) => {
    void handleRequest(req, res, token, epicService, logger)
  })

  const port = await listenOnRandomPort(httpServer)
  const url = `http://127.0.0.1:${port}${MCP_PATH}`

  logger.info(`[opencode-session-mcp] Listening on ${url}`)

  return {
    url,
    token,
    close() {
      return new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
  }
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  epicService: EpicGroupService,
  logger: Logger
): Promise<void> {
  if (req.url !== MCP_PATH || req.method !== 'POST') {
    res.writeHead(404)
    res.end()
    return
  }

  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(UNAUTHORIZED_BODY)
    return
  }

  const port = (req.socket.localPort ?? 0).toString()
  const mcp = buildMcpServer(epicService, logger)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: ['127.0.0.1', 'localhost', `127.0.0.1:${port}`, `localhost:${port}`],
    allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
  } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0])

  try {
    await mcp.connect(transport as Parameters<typeof mcp.connect>[0])
    await transport.handleRequest(req, res)
  } catch (err) {
    logger.error(`[opencode-session-mcp] Request error: ${err}`)
    if (!res.headersSent) {
      res.writeHead(500)
      res.end()
    }
  }
}

function buildMcpServer(epicService: EpicGroupService, logger: Logger): McpServer {
  const mcp = wrapServerWithSafeToolHandlers(
    new McpServer({ name: 'bde', version: '1.0.0' }),
    logger
  )

  registerMetaTools(mcp, { getRepos: getConfiguredRepos })

  const taskStateService = createTaskStateService({
    terminalDispatcher: { dispatch: () => {} },
    logger
  })

  registerTaskTools(mcp, {
    listTasks,
    getTask,
    createTaskWithValidation,
    updateTask,
    cancelTask: async (id, reason, options) =>
      cancelTask(
        id,
        { ...(reason !== undefined ? { reason } : {}), ...options },
        { logger, onStatusTerminal: () => {} }
      ),
    getTaskChanges: (id, options) => getTaskChanges(id, options),
    onStatusTerminal: () => {},
    taskStateService,
    logger
  })

  registerEpicTools(mcp, { epicService })

  return mcp
}

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0)
    })
  })
}
