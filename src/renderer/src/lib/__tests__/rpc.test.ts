import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { invokeTool, clearConfigCache } from '../rpc'

const mockGetGatewayConfig = vi.fn().mockResolvedValue({
  url: 'ws://localhost:18789',
  token: 'test-token',
})

// Stub window.api
Object.defineProperty(globalThis, 'window', {
  value: {
    api: { getGatewayConfig: mockGetGatewayConfig },
  },
  writable: true,
})

describe('invokeTool', () => {
  beforeEach(() => {
    clearConfigCache()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns result.details when present', async () => {
    const details = { sessions: [], count: 0 }
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { details } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await invokeTool('sessions_list')
    expect(result).toEqual(details)
  })

  it('falls back to parsing result.content[0].text as JSON', async () => {
    const payload = { key: 'value' }
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await invokeTool('some_tool')
    expect(result).toEqual(payload)
  })

  it('returns raw text when content[0].text is not valid JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { content: [{ type: 'text', text: 'plain string' }] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await invokeTool('some_tool')
    expect(result).toBe('plain string')
  })

  it('throws on ok: false with error message', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'Tool not found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(invokeTool('bad_tool')).rejects.toThrow('Tool not found')
  })

  it('throws on non-2xx HTTP status', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    )

    await expect(invokeTool('any_tool')).rejects.toThrow('Gateway error 500')
  })

  it('uses correct Authorization header', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { details: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await invokeTool('test_tool')

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    )
  })

  it('converts ws:// URL to http://', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { details: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await invokeTool('test_tool')

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18789/tools/invoke',
      expect.any(Object),
    )
  })
})
