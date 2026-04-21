import type { IncomingMessage } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

export type AuthResult = { ok: true } | { ok: false; status: 401; message: string }

const BEARER_SCHEME_PREFIX = 'Bearer '

function deny(message: string): AuthResult {
  return { ok: false, status: 401, message }
}

/**
 * Extracts the bearer token from an `Authorization` header value, or returns
 * `null` if the header is missing the `Bearer ` prefix or carries an empty
 * token. Whitespace around the token is intentionally tolerated — historical
 * clients have shipped tokens padded with trailing spaces, and a strict
 * rejection would break them without any security benefit (the comparison
 * itself is still constant-time and length-checked).
 */
export function parseBearerToken(headerValue: string): string | null {
  if (!headerValue.startsWith(BEARER_SCHEME_PREFIX)) return null
  const token = headerValue.slice(BEARER_SCHEME_PREFIX.length).trim()
  return token.length > 0 ? token : null
}

export function checkBearerAuth(req: IncomingMessage, expected: string): AuthResult {
  const header = req.headers.authorization
  if (typeof header !== 'string') {
    return deny('missing bearer token')
  }
  const presented = parseBearerToken(header)
  if (presented === null) {
    return deny(
      header.startsWith(BEARER_SCHEME_PREFIX) ? 'invalid bearer token' : 'missing bearer token'
    )
  }
  if (presented.length !== expected.length) {
    return deny('invalid bearer token')
  }
  const presentedBytes = Buffer.from(presented, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (!timingSafeEqual(presentedBytes, expectedBytes)) {
    return deny('invalid bearer token')
  }
  return { ok: true }
}
