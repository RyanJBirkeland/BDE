import { describe, it, expect } from 'vitest'
import { checkBearerAuth, parseBearerToken } from './auth'
import type { IncomingMessage } from 'node:http'

function fakeReq(headers: Record<string, string | string[]>): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

describe('checkBearerAuth', () => {
  const token = 'a'.repeat(64)

  it('returns ok when Authorization matches', () => {
    const result = checkBearerAuth(fakeReq({ authorization: `Bearer ${token}` }), token)
    expect(result.ok).toBe(true)
  })

  it('returns 401 when header is missing', () => {
    const result = checkBearerAuth(fakeReq({}), token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('returns 401 when scheme is not Bearer', () => {
    const result = checkBearerAuth(fakeReq({ authorization: `Basic ${token}` }), token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('returns 401 when token differs', () => {
    const other = 'b'.repeat(64)
    const result = checkBearerAuth(fakeReq({ authorization: `Bearer ${other}` }), token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('returns 401 when token length differs (avoids timingSafeEqual throw)', () => {
    const result = checkBearerAuth(fakeReq({ authorization: `Bearer short` }), token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('returns invalid-bearer-token when header is "Bearer " with no token', () => {
    const result = checkBearerAuth(fakeReq({ authorization: 'Bearer ' }), token)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.message).toBe('invalid bearer token')
    }
  })

  it('returns missing-bearer-token for lowercase "bearer" scheme (case-sensitive check)', () => {
    const result = checkBearerAuth(fakeReq({ authorization: `bearer ${token}` }), token)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.message).toBe('missing bearer token')
    }
  })

  it('returns missing-bearer-token when Authorization header is an array', () => {
    const result = checkBearerAuth(
      fakeReq({ authorization: [`Bearer ${token}`, 'Bearer other'] }),
      token
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.message).toBe('missing bearer token')
    }
  })

  it('accepts a token with trailing whitespace (current trim tolerance)', () => {
    const result = checkBearerAuth(fakeReq({ authorization: `Bearer ${token}   ` }), token)
    expect(result.ok).toBe(true)
  })

  it('accepts extra whitespace between scheme and token (current trim tolerance)', () => {
    const result = checkBearerAuth(fakeReq({ authorization: `Bearer    ${token}` }), token)
    expect(result.ok).toBe(true)
  })

  it('returns invalid-bearer-token for same-length token with different content', () => {
    const wrongSameLength = 'c'.repeat(64)
    const result = checkBearerAuth(fakeReq({ authorization: `Bearer ${wrongSameLength}` }), token)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.message).toBe('invalid bearer token')
    }
  })
})

describe('parseBearerToken', () => {
  const token = 'a'.repeat(64)

  it('returns the token when header carries a well-formed Bearer scheme', () => {
    expect(parseBearerToken(`Bearer ${token}`)).toBe(token)
  })

  it('returns null when header does not start with the Bearer scheme', () => {
    expect(parseBearerToken(`Basic ${token}`)).toBeNull()
  })

  it('returns null for a lowercase "bearer" scheme (case-sensitive)', () => {
    expect(parseBearerToken(`bearer ${token}`)).toBeNull()
  })

  it('returns null when the scheme prefix is present but the token is empty', () => {
    expect(parseBearerToken('Bearer ')).toBeNull()
  })

  it('returns null when the scheme prefix is present but the remainder is only whitespace', () => {
    expect(parseBearerToken('Bearer    ')).toBeNull()
  })

  it('trims surrounding whitespace from the token (documented tolerance)', () => {
    expect(parseBearerToken(`Bearer   ${token}   `)).toBe(token)
  })

  it('returns null for the empty string', () => {
    expect(parseBearerToken('')).toBeNull()
  })
})
