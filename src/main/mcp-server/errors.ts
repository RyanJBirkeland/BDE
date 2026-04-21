import type { ServerResponse } from 'node:http'
import { z, ZodError } from 'zod'
import type { Logger } from '../logger'

/**
 * Named JSON-RPC error codes used by the MCP server. The MCP spec reserves
 * -32000..-32099 for server-defined errors; these constants name each slot
 * we use so call sites read as vocabulary rather than magic numbers.
 */
export const JSON_RPC_UNAUTHORIZED = -32000
export const JSON_RPC_NOT_FOUND = -32001
export const JSON_RPC_INVALID_TRANSITION = -32002
export const JSON_RPC_CYCLE = -32003
export const JSON_RPC_FORBIDDEN_FIELD = -32004
export const JSON_RPC_VALIDATION_FAILED = -32005
export const JSON_RPC_CONFLICT = -32006
export const JSON_RPC_REPO_UNCONFIGURED = -32007

export enum McpErrorCode {
  NotFound = 'NOT_FOUND',
  InvalidTransition = 'INVALID_TRANSITION',
  Cycle = 'CYCLE',
  ForbiddenField = 'FORBIDDEN_FIELD',
  ValidationFailed = 'VALIDATION_FAILED',
  Conflict = 'CONFLICT',
  RepoUnconfigured = 'REPO_UNCONFIGURED'
}

export class McpDomainError extends Error {
  constructor(
    message: string,
    public readonly kind: McpErrorCode,
    public readonly data?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'McpDomainError'
  }
}

/**
 * Thrown by `parseToolArgs` — carries the schema that rejected the input so
 * `toJsonRpcError` can enrich each issue with the field's `.describe()` text.
 */
export class McpZodError extends Error {
  constructor(
    public readonly zodError: ZodError,
    public readonly schema: z.ZodTypeAny
  ) {
    super(zodError.message)
    this.name = 'McpZodError'
  }
}

export interface JsonRpcErrorBody {
  code: number
  message: string
  data?: unknown
}

const CODE_MAP: Record<McpErrorCode, number> = {
  [McpErrorCode.NotFound]: JSON_RPC_NOT_FOUND,
  [McpErrorCode.InvalidTransition]: JSON_RPC_INVALID_TRANSITION,
  [McpErrorCode.Cycle]: JSON_RPC_CYCLE,
  [McpErrorCode.ForbiddenField]: JSON_RPC_FORBIDDEN_FIELD,
  [McpErrorCode.ValidationFailed]: JSON_RPC_VALIDATION_FAILED,
  [McpErrorCode.Conflict]: JSON_RPC_CONFLICT,
  [McpErrorCode.RepoUnconfigured]: JSON_RPC_REPO_UNCONFIGURED
}

export function toJsonRpcError(
  err: unknown,
  schema?: z.ZodTypeAny,
  logger?: Pick<Logger, 'error'>
): JsonRpcErrorBody {
  if (err instanceof McpZodError) {
    return formatZodError(err.zodError, err.schema)
  }
  if (err instanceof ZodError) {
    return formatZodError(err, schema)
  }
  if (err instanceof McpDomainError) {
    return { code: CODE_MAP[err.kind], message: err.message, data: err.data }
  }
  logUnknownError(err, logger)
  return { code: -32603, message: 'Internal error' }
}

/**
 * Writes a JSON-RPC 2.0 error envelope to an HTTP response. Centralizes the
 * header + body shape so transport layers never hand-roll the envelope.
 * Skips `writeHead` if headers are already sent — the caller is mid-stream
 * and only the body matters.
 */
export function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  err: unknown,
  opts?: {
    id?: string | number | null
    schema?: z.ZodTypeAny
    logger?: Pick<Logger, 'error'>
  }
): void {
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' })
  }
  const body = {
    jsonrpc: '2.0' as const,
    id: opts?.id ?? null,
    error: toJsonRpcError(err, opts?.schema, opts?.logger)
  }
  res.end(JSON.stringify(body))
}

/**
 * Parse MCP tool arguments against a zod schema. On failure throws an
 * `McpZodError` that carries the schema so `toJsonRpcError` can surface
 * each field's `.describe()` text in the JSON-RPC error response.
 */
export function parseToolArgs<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new McpZodError(result.error, schema)
  }
  return result.data as z.infer<T>
}

function formatZodError(err: ZodError, schema?: z.ZodTypeAny): JsonRpcErrorBody {
  return {
    code: -32602,
    message: `Invalid params: ${err.issues.map((issue) => enrichIssue(issue, schema)).join('; ')}`,
    data: { issues: err.issues }
  }
}

function enrichIssue(issue: z.ZodIssue, schema?: z.ZodTypeAny): string {
  const description = topLevelFieldDescription(schema, issue.path)
  const pathLabel = issue.path.length > 0 ? issue.path.join('.') : '(root)'
  if (description) {
    return `${pathLabel}: ${description} — got: ${issue.message}`
  }
  return `${pathLabel}: ${issue.message}`
}

/**
 * Look up the description of the top-level object field named by the issue
 * path. Nested paths fall back to an undefined description — callers then
 * surface the raw issue message without enrichment.
 */
function topLevelFieldDescription(
  schema: z.ZodTypeAny | undefined,
  path: ReadonlyArray<PropertyKey>
): string | undefined {
  if (!(schema instanceof z.ZodObject)) return undefined
  const fieldName = path[0]
  if (typeof fieldName !== 'string') return undefined
  const shape = schema.shape as Record<string, z.ZodTypeAny>
  const fieldSchema = shape[fieldName]
  return fieldSchema?.description
}

function logUnknownError(err: unknown, logger: Pick<Logger, 'error'> | undefined): void {
  if (!logger) return
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  logger.error(`toJsonRpcError received unknown throw: ${detail}`)
}
