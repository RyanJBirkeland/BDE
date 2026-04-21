import { describe, it, expect, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { safeToolHandler, wrapServerWithSafeToolHandlers } from './safe-tool-handler'

const silentLogger = { error: vi.fn() }

describe('safeToolHandler', () => {
  it('passes through the return value of a successful handler', async () => {
    const logger = { error: vi.fn() }
    const wrapped = safeToolHandler('tasks.get', logger, async (args: { id: string }) => ({
      ok: true,
      id: args.id
    }))

    await expect(wrapped({ id: 't1' })).resolves.toEqual({ ok: true, id: 't1' })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs an error with the tool name and rethrows when the handler throws', async () => {
    const logger = { error: vi.fn() }
    const boom = new Error('kaboom')
    const wrapped = safeToolHandler('tasks.cancel', logger, async () => {
      throw boom
    })

    await expect(wrapped(undefined as unknown as never)).rejects.toBe(boom)
    expect(logger.error).toHaveBeenCalledTimes(1)
    const logged = logger.error.mock.calls[0]?.[0] as string
    expect(logged).toContain('tasks.cancel')
    expect(logged).toContain('kaboom')
  })
})

describe('wrapServerWithSafeToolHandlers', () => {
  it('intercepts server.tool and wraps the callback argument (3-arg call)', async () => {
    const originalTool = vi.fn()
    const server = { tool: originalTool } as unknown as McpServer
    const logger = { error: vi.fn() }
    wrapServerWithSafeToolHandlers(server, logger)

    const handler = vi.fn(async () => 'value')
    ;(server.tool as unknown as (name: string, desc: string, cb: typeof handler) => void)(
      'tasks.get',
      'Fetch',
      handler
    )

    expect(originalTool).toHaveBeenCalledTimes(1)
    const [nameArg, descArg, wrappedCb] = originalTool.mock.calls[0]
    expect(nameArg).toBe('tasks.get')
    expect(descArg).toBe('Fetch')
    expect(wrappedCb).not.toBe(handler)

    await (wrappedCb as typeof handler)({})
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('wrapped handler logs and rethrows when the underlying handler throws', async () => {
    const originalTool = vi.fn()
    const server = { tool: originalTool } as unknown as McpServer
    const logger = { error: vi.fn() }
    wrapServerWithSafeToolHandlers(server, logger)

    const boom = new Error('boom')
    ;(server.tool as unknown as (
      name: string,
      desc: string,
      shape: Record<string, unknown>,
      cb: () => Promise<never>
    ) => void)('tasks.list', 'List', {}, async () => {
      throw boom
    })

    const wrappedCb = originalTool.mock.calls[0]?.[3] as () => Promise<never>
    await expect(wrappedCb()).rejects.toBe(boom)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('tasks.list'))
  })

  it('leaves calls without a string name or function callback untouched', () => {
    const originalTool = vi.fn()
    const server = { tool: originalTool } as unknown as McpServer
    wrapServerWithSafeToolHandlers(server, silentLogger)

    const passthroughArgs = [123, 'desc', {}] as unknown as [string, string, Record<string, unknown>]
    ;(server.tool as unknown as (...args: unknown[]) => void)(...passthroughArgs)
    expect(originalTool).toHaveBeenCalledWith(...passthroughArgs)
  })
})
