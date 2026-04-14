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
  text?: string
  message?: {
    role?: string
    content?: Array<{
      type?: string
      text?: string
      name?: string
      tool_name?: string
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
 * Safely casts unknown SDK message to SDKWireMessage for field access.
 */
export function asSDKMessage(msg: unknown): SDKWireMessage | null {
  if (typeof msg !== 'object' || msg === null) return null
  return msg as SDKWireMessage
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
