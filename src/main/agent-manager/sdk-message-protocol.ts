/**
 * SDK wire protocol type guards and field accessors.
 *
 * Encapsulates all knowledge of the SDK message shape so callers
 * can extract fields without casting or null-checking raw unknowns.
 */

/**
 * SDK wire protocol message structure. All fields are optional as the SDK
 * emits various message shapes. Typed accessors below provide safe extraction.
 */
export interface SDKWireMessage {
  type?: string
  subtype?: string
  session_id?: string
  cost_usd?: number
  total_cost_usd?: number
  exit_code?: number
  stop_reason?: string
  text?: string
  message?: {
    role?: string
    content?: Array<{
      type?: string
      text?: string
      name?: string
      tool_name?: string
      id?: string
      tool_use_id?: string
      content?: string
      is_error?: boolean
      input?: Record<string, unknown>
    }>
  }
  content?: unknown
  output?: unknown
  tool_name?: string
  name?: string
  is_error?: boolean
  input?: Record<string, unknown> // tool_result messages can have input at top level
}

/**
 * Narrows an unknown SDK wire message to `SDKWireMessage`.
 *
 * Rejects values whose outer shape contradicts the declared type:
 * - non-objects or null
 * - `message` present but not an object
 * - `message.content` present but not an array
 *
 * Leaf fields (e.g. `type`, `session_id`, individual content blocks) are
 * still narrowed at each consumer site — this guard only prevents shapes
 * that would force consumers to re-check the container they just asked for.
 */
export function asSDKMessage(msg: unknown): SDKWireMessage | null {
  if (!isNonNullObject(msg)) return null
  if (!hasValidNestedMessage(msg)) return null
  return msg as SDKWireMessage
}

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasValidNestedMessage(msg: Record<string, unknown>): boolean {
  if (!('message' in msg)) return true
  const nested = msg.message
  if (nested === undefined) return true
  if (!isNonNullObject(nested)) return false
  return hasValidContentArray(nested)
}

function hasValidContentArray(nested: Record<string, unknown>): boolean {
  if (!('content' in nested)) return true
  const content = nested.content
  if (content === undefined) return true
  return Array.isArray(content)
}

/**
 * Extracts a numeric field from an SDK message, returning undefined if not present.
 */
export function getNumericField(msg: unknown, field: keyof SDKWireMessage): number | undefined {
  const sdkMsg = asSDKMessage(msg)
  if (!sdkMsg) return undefined
  const val = sdkMsg[field]
  return typeof val === 'number' ? val : undefined
}

/**
 * Extracts session_id from an SDK message if present.
 */
export function getSessionId(msg: unknown): string | undefined {
  const sdkMsg = asSDKMessage(msg)
  if (!sdkMsg) return undefined
  return typeof sdkMsg.session_id === 'string' ? sdkMsg.session_id : undefined
}

/**
 * Checks if a message is a rate_limit system message.
 */
export function isRateLimitMessage(msg: unknown): boolean {
  const sdkMsg = asSDKMessage(msg)
  return sdkMsg?.type === 'system' && sdkMsg?.subtype === 'rate_limit'
}
