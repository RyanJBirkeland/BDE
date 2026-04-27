/**
 * Uniform error logging wrapper for MCP tool callbacks — the MCP analog
 * of the `safeHandle()` wrapper that every IPC handler uses.
 *
 * Without this, a tool throwing an unknown error surfaces only as an MCP
 * text-content string on the client with no server-side record. With it,
 * every throw gets a single `logger.error` line that pins the tool name
 * and stack before the error propagates to the SDK's error envelope.
 *
 * Two usage patterns are supported:
 *   1. `safeToolHandler(name, logger, fn)` — wrap a callback directly.
 *   2. `wrapServerWithSafeToolHandlers(server, logger)` — Proxy every
 *      `server.tool(...)` registration so callers don't have to opt in
 *      per call site.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Logger } from '../logger'

type ToolHandlerFn<Args, Result> = (args: Args) => Result | Promise<Result>

export function safeToolHandler<Args, Result>(
  name: string,
  logger: Pick<Logger, 'error'>,
  fn: ToolHandlerFn<Args, Result>
): ToolHandlerFn<Args, Result> {
  return async (args: Args) => {
    try {
      return await fn(args)
    } catch (err) {
      logger.error(`mcp tool "${name}" threw: ${formatError(err)}`)
      throw err
    }
  }
}

/**
 * Wrap an `McpServer` so every tool registration — whether via the legacy
 * `.tool(...)` overload or the newer `.registerTool(...)` config-object form
 * — has its callback (the last argument) replaced with a `safeToolHandler`-
 * wrapped version. Returns the same `server` with the registration methods
 * swapped in place, so no call site has to opt in.
 */
export function wrapServerWithSafeToolHandlers(
  server: McpServer,
  logger: Pick<Logger, 'error'>
): McpServer {
  wrapRegistrationMethod(server, 'tool', logger)
  wrapRegistrationMethod(server, 'registerTool', logger)
  return server
}

function wrapRegistrationMethod(
  server: McpServer,
  methodName: 'tool' | 'registerTool',
  logger: Pick<Logger, 'error'>
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (server as any)[methodName]
  if (typeof existing !== 'function') return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (existing as (...args: any[]) => unknown).bind(server)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapped = (...args: any[]): unknown => {
    if (args.length === 0) return original()
    const name = args[0]
    const cbIndex = args.length - 1
    const cb = args[cbIndex]
    if (typeof cb !== 'function' || typeof name !== 'string') {
      return original.apply(server, args)
    }
    const wrappedCb = safeToolHandler(name, logger, cb as ToolHandlerFn<unknown, unknown>)
    const nextArgs = [...args.slice(0, cbIndex), wrappedCb]
    return original.apply(server, nextArgs)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(server as any)[methodName] = wrapped
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message
  return String(err)
}
