import { z, ZodError } from 'zod'
import type { Logger } from '../../logger'
import { McpDomainError, McpZodError, toJsonRpcError } from '../errors'
import { TaskValidationError } from '../../services/sprint-service'
import { EpicCycleError, EpicNotFoundError } from '../../services/epic-group-service'

/**
 * Shared envelope builder for MCP tool responses. Every tool returns a
 * `{ content: [{ type: 'text', text: JSON.stringify(value) }] }` payload;
 * centralizing the shape keeps tool handlers focused on their domain
 * and eliminates drift across `tasks.ts`, `epics.ts`, and `meta.ts`.
 *
 * The index signature is required by the MCP SDK's `tool()` callback
 * return type, which is shaped as `{ [x: string]: unknown; content: […] }`.
 */
export interface JsonToolResponse {
  [key: string]: unknown
  content: [{ type: 'text'; text: string }]
}

export interface JsonToolError {
  [key: string]: unknown
  isError: true
  content: [{ type: 'text'; text: string }]
}

export function jsonContent(value: unknown): JsonToolResponse {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

/**
 * Build a structured error envelope carrying the JSON-RPC error body (code,
 * message, data) so MCP clients can programmatically distinguish error
 * types. Without this the SDK's default catch converts every throw into a
 * plain-text `isError: true` payload and the `kind` / `data` / numeric code
 * are lost.
 */
export function errorContent(
  err: unknown,
  schema?: z.ZodTypeAny,
  logger?: Pick<Logger, 'error'>
): JsonToolError {
  const body = toJsonRpcError(err, schema, logger)
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(body) }]
  }
}

/**
 * Recognize errors we can faithfully serialize to clients. Unknown throws
 * propagate so Agent B's `safeToolHandler` can log them and return a
 * sanitized generic payload.
 */
export function isKnownStructuredError(err: unknown): boolean {
  return (
    err instanceof McpDomainError ||
    err instanceof McpZodError ||
    err instanceof ZodError ||
    err instanceof TaskValidationError ||
    err instanceof EpicNotFoundError ||
    err instanceof EpicCycleError
  )
}

/**
 * Invoke `run()` and return a structured error payload when the throw is a
 * known MCP domain/validation error. Unknown throws propagate unchanged so
 * outer safety nets can log and sanitize them.
 */
export async function safeToolResponse(
  run: () => Promise<JsonToolResponse>,
  opts: { schema?: z.ZodTypeAny; logger?: Pick<Logger, 'error'> } = {}
): Promise<JsonToolResponse | JsonToolError> {
  try {
    return await run()
  } catch (err) {
    if (isKnownStructuredError(err)) {
      return errorContent(err, opts.schema, opts.logger)
    }
    throw err
  }
}
