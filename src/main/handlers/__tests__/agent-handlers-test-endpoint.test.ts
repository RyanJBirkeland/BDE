/**
 * agents:testLocalEndpoint — HTTP GET {endpoint}/models with a 2s timeout.
 * Returns { ok: true, latencyMs, modelCount } on 200 with a valid body;
 * { ok: false, error: string } otherwise. Never throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { testLocalEndpoint } from '../agent-handlers'

const originalFetch = globalThis.fetch

describe('testLocalEndpoint', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns ok with modelCount for a well-formed 200 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'qwen' }, { id: 'gemma' }, { id: 'codestral' }] })
    }) as unknown as typeof fetch

    const result = await testLocalEndpoint('http://localhost:1234/v1')

    expect(result).toEqual({
      ok: true,
      latencyMs: expect.any(Number),
      modelCount: 3
    })
  })

  it('returns an error string on a non-200 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({})
    }) as unknown as typeof fetch

    const result = await testLocalEndpoint('http://localhost:1234/v1')

    expect(result).toEqual({ ok: false, error: expect.stringContaining('502') })
  })

  it('returns an error string when the body is not the expected shape', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => '<html>proxy page</html>'
    }) as unknown as typeof fetch

    const result = await testLocalEndpoint('http://localhost:1234/v1')

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/shape|data/i) })
  })

  it('returns an error string on connection refusal', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
      ) as unknown as typeof fetch

    const result = await testLocalEndpoint('http://localhost:1234/v1')

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/ECONNREFUSED|refused/i) })
  })

  it('returns a timeout error when fetch aborts', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))
    }) as unknown as typeof fetch

    const result = await testLocalEndpoint('http://localhost:1234/v1')

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/timeout/i) })
  })

  it('never throws — returns a structured error for unexpected throws', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      throw new TypeError('invalid URL')
    }) as unknown as typeof fetch

    const result = await testLocalEndpoint('not-a-url')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(typeof result.error).toBe('string')
      expect(result.error.length).toBeGreaterThan(0)
    }
  })
})
