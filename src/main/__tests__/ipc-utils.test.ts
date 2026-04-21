/**
 * Unit tests for the safeHandle / safeOn IPC wrappers, focused on the
 * optional `parseArgs` runtime-validation hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const hoisted = vi.hoisted(() => ({
  mockError: vi.fn(),
  mockInfo: vi.fn(),
  mockWarn: vi.fn(),
  mockDebug: vi.fn(),
  registeredHandlers: new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
}))

vi.mock('../logger', () => ({
  createLogger: vi.fn(() => ({
    error: hoisted.mockError,
    info: hoisted.mockInfo,
    warn: hoisted.mockWarn,
    debug: hoisted.mockDebug
  }))
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (e: unknown, ...args: unknown[]) => unknown) => {
      hoisted.registeredHandlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: (e: unknown, ...args: unknown[]) => unknown) => {
      hoisted.registeredHandlers.set(channel, handler)
    })
  }
}))

const { mockError, registeredHandlers } = hoisted

import { safeHandle } from '../ipc-utils'

const mockEvent = {} as IpcMainInvokeEvent

// The channel name is cast to any because we're exercising the wrapper's
// runtime behavior in isolation from the concrete IpcChannelMap.
const TEST_CHANNEL = 'test:channel' as any

function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = registeredHandlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return Promise.resolve(handler(mockEvent, ...args))
}

describe('safeHandle parseArgs hook', () => {
  beforeEach(() => {
    registeredHandlers.clear()
    mockError.mockClear()
  })

  it('passes parsed args through to the handler on the happy path', async () => {
    const handler = vi.fn(async (_e: unknown, id: string, patch: Record<string, unknown>) => ({
      id,
      patch
    }))
    const parseArgs = vi.fn((args: unknown[]) => {
      if (args.length !== 2) throw new Error('bad')
      return args as [string, Record<string, unknown>]
    })

    safeHandle(TEST_CHANNEL, handler as never, parseArgs as never)

    const result = await invokeHandler(TEST_CHANNEL, 'task-1', { title: 'hi' })

    expect(parseArgs).toHaveBeenCalledWith(['task-1', { title: 'hi' }])
    expect(handler).toHaveBeenCalledWith(mockEvent, 'task-1', { title: 'hi' })
    expect(result).toEqual({ id: 'task-1', patch: { title: 'hi' } })
    expect(mockError).not.toHaveBeenCalled()
  })

  it('logs and propagates when parseArgs throws, without calling the handler', async () => {
    const handler = vi.fn()
    const parseArgs = vi.fn(() => {
      throw new Error('patch must be a plain object')
    })

    safeHandle(TEST_CHANNEL, handler as never, parseArgs as never)

    await expect(invokeHandler(TEST_CHANNEL, 'task-1', null)).rejects.toThrow(
      'patch must be a plain object'
    )

    expect(handler).not.toHaveBeenCalled()
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('invalid payload: patch must be a plain object')
    )
  })

  it('forwards args unchanged when no parseArgs is provided', async () => {
    const handler = vi.fn(async (_e: unknown, a: unknown, b: unknown) => [a, b])

    safeHandle(TEST_CHANNEL, handler as never)

    const result = await invokeHandler(TEST_CHANNEL, 42, 'passthrough')

    expect(handler).toHaveBeenCalledWith(mockEvent, 42, 'passthrough')
    expect(result).toEqual([42, 'passthrough'])
    expect(mockError).not.toHaveBeenCalled()
  })
})
