import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { ServerResponse } from 'node:http'
import {
  toJsonRpcError,
  writeJsonRpcError,
  McpDomainError,
  McpErrorCode,
  parseToolArgs,
  JSON_RPC_NOT_FOUND,
  JSON_RPC_VALIDATION_FAILED,
  JSON_RPC_CONFLICT,
  JSON_RPC_REPO_UNCONFIGURED
} from './errors'

describe('toJsonRpcError', () => {
  it('maps zod ZodError to -32602 Invalid params', () => {
    const schema = z.object({ id: z.string() })
    let caught: unknown
    try {
      schema.parse({})
    } catch (err) {
      caught = err
    }
    const mapped = toJsonRpcError(caught)
    expect(mapped.code).toBe(-32602)
    expect(mapped.message).toMatch(/invalid/i)
    expect(mapped.data).toBeDefined()
  })

  it('includes .describe() text in the user-facing message when schema is passed', () => {
    const schema = z.object({
      icon: z.string().max(4).describe('Single emoji glyph identifying the epic (max 4 chars)')
    })
    const result = schema.safeParse({ icon: 'shield' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const rpc = toJsonRpcError(result.error, schema)
      expect(rpc.message).toMatch(/Single emoji glyph/)
      expect(rpc.message).toMatch(/icon/)
    }
  })

  it('falls back to raw issue path when schema is omitted', () => {
    const schema = z.object({
      icon: z.string().max(4).describe('Single emoji glyph identifying the epic (max 4 chars)')
    })
    const result = schema.safeParse({ icon: 'shield' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const rpc = toJsonRpcError(result.error)
      expect(rpc.message).not.toMatch(/Single emoji glyph/)
    }
  })

  it('enriches messages automatically when parseToolArgs is used', () => {
    const schema = z.object({
      icon: z.string().max(4).describe('Single emoji glyph identifying the epic (max 4 chars)')
    })
    let caught: unknown
    try {
      parseToolArgs(schema, { icon: 'shield' })
    } catch (err) {
      caught = err
    }
    const rpc = toJsonRpcError(caught)
    expect(rpc.code).toBe(-32602)
    expect(rpc.message).toMatch(/Single emoji glyph/)
  })

  it('maps McpDomainError with code NOT_FOUND to -32001', () => {
    const err = new McpDomainError('Task xyz not found', McpErrorCode.NotFound, { id: 'xyz' })
    const mapped = toJsonRpcError(err)
    expect(mapped.code).toBe(-32001)
    expect(mapped.data).toEqual({ id: 'xyz' })
  })

  it('maps McpDomainError with code INVALID_TRANSITION to -32002', () => {
    const err = new McpDomainError('bad transition', McpErrorCode.InvalidTransition)
    expect(toJsonRpcError(err).code).toBe(-32002)
  })

  it('maps McpDomainError with code CYCLE to -32003', () => {
    const err = new McpDomainError('cycle', McpErrorCode.Cycle)
    expect(toJsonRpcError(err).code).toBe(-32003)
  })

  it('maps McpDomainError with code FORBIDDEN_FIELD to -32004', () => {
    const err = new McpDomainError('nope', McpErrorCode.ForbiddenField)
    expect(toJsonRpcError(err).code).toBe(-32004)
  })

  it('maps McpDomainError with code VALIDATION_FAILED to -32005', () => {
    const err = new McpDomainError('invalid input', McpErrorCode.ValidationFailed)
    expect(toJsonRpcError(err).code).toBe(JSON_RPC_VALIDATION_FAILED)
  })

  it('maps McpDomainError with code CONFLICT to -32006', () => {
    const err = new McpDomainError('conflict', McpErrorCode.Conflict)
    expect(toJsonRpcError(err).code).toBe(JSON_RPC_CONFLICT)
  })

  it('maps McpDomainError with code REPO_UNCONFIGURED to -32007', () => {
    const err = new McpDomainError('repo missing', McpErrorCode.RepoUnconfigured)
    expect(toJsonRpcError(err).code).toBe(JSON_RPC_REPO_UNCONFIGURED)
  })

  it('maps any other thrown value to -32603 Internal error without leaking stack', () => {
    const sensitiveError = new Error('oops database=postgres://secret@host/db failed')
    sensitiveError.stack =
      'Error: oops\n    at /Users/secret/private/path/module.ts:42:17\n    at async handler'
    const mapped = toJsonRpcError(sensitiveError)

    expect(mapped.code).toBe(-32603)
    expect(mapped.message).toBe('Internal error')
    expect(mapped.data).toBeUndefined()

    const serialized = JSON.stringify(mapped)
    expect(serialized).not.toContain('postgres://')
    expect(serialized).not.toContain('/Users/secret')
    expect(serialized).not.toContain('secret@host')
    expect(serialized).not.toMatch(/module\.ts:\d+/)
  })

  it('logs unknown throws via the optional logger before returning Internal error', () => {
    const logger = { error: vi.fn() }
    const err = new Error('kaboom')
    toJsonRpcError(err, undefined, logger)
    expect(logger.error).toHaveBeenCalledTimes(1)
    const msg = logger.error.mock.calls[0][0] as string
    expect(msg).toContain('kaboom')
  })

  it('does not throw when unknown error is received without a logger', () => {
    expect(() => toJsonRpcError(new Error('boom'))).not.toThrow()
  })
})

describe('writeJsonRpcError', () => {
  function fakeResponse(): {
    res: ServerResponse
    writeHead: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    setHeadersSent: (sent: boolean) => void
  } {
    const writeHead = vi.fn()
    const end = vi.fn()
    let headersSent = false
    const res = {
      get headersSent() {
        return headersSent
      },
      writeHead,
      end
    } as unknown as ServerResponse
    return {
      res,
      writeHead,
      end,
      setHeadersSent: (sent: boolean) => {
        headersSent = sent
      }
    }
  }

  it('writes a valid JSON-RPC 2.0 envelope with id: null by default', () => {
    const { res, writeHead, end } = fakeResponse()
    writeJsonRpcError(res, 500, new McpDomainError('gone', McpErrorCode.NotFound))
    expect(writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' })
    const body = JSON.parse(end.mock.calls[0][0])
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBeNull()
    expect(body.error.code).toBe(JSON_RPC_NOT_FOUND)
    expect(body.error.message).toBe('gone')
  })

  it('uses the explicit id from opts when provided', () => {
    const { res, end } = fakeResponse()
    writeJsonRpcError(res, 404, new McpDomainError('missing', McpErrorCode.NotFound), { id: 7 })
    const body = JSON.parse(end.mock.calls[0][0])
    expect(body.id).toBe(7)
  })

  it('skips writeHead when headers are already sent', () => {
    const { res, writeHead, end, setHeadersSent } = fakeResponse()
    setHeadersSent(true)
    writeJsonRpcError(res, 500, new Error('late'))
    expect(writeHead).not.toHaveBeenCalled()
    expect(end).toHaveBeenCalledOnce()
  })
})
