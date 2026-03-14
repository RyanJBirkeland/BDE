import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invokeTool } from '../rpc'

const mockInvokeTool = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: { api: { invokeTool: mockInvokeTool } },
  writable: true,
})

describe('invokeTool', () => {
  beforeEach(() => {
    mockInvokeTool.mockReset()
  })

  it('returns result.details when present', async () => {
    const details = { sessions: [], count: 0 }
    mockInvokeTool.mockResolvedValue({ ok: true, result: { details } })
    const result = await invokeTool('sessions_list')
    expect(result).toEqual(details)
    expect(mockInvokeTool).toHaveBeenCalledWith('sessions_list', {})
  })

  it('falls back to parsing result.content[0].text as JSON', async () => {
    const payload = { key: 'value' }
    mockInvokeTool.mockResolvedValue({
      ok: true,
      result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    })
    const result = await invokeTool('some_tool')
    expect(result).toEqual(payload)
  })

  it('returns raw text when content[0].text is not valid JSON', async () => {
    mockInvokeTool.mockResolvedValue({
      ok: true,
      result: { content: [{ type: 'text', text: 'plain string' }] },
    })
    const result = await invokeTool('some_tool')
    expect(result).toBe('plain string')
  })

  it('throws on ok: false with error message', async () => {
    mockInvokeTool.mockResolvedValue({ ok: false, error: 'Tool not found' })
    await expect(invokeTool('bad_tool')).rejects.toThrow('Tool not found')
  })

  it('throws on ok: false with default message', async () => {
    mockInvokeTool.mockResolvedValue({ ok: false })
    await expect(invokeTool('bad_tool')).rejects.toThrow('Gateway returned ok=false')
  })

  it('passes args through to IPC', async () => {
    mockInvokeTool.mockResolvedValue({ ok: true, result: { details: null } })
    await invokeTool('test_tool', { sessionKey: 'abc', limit: 10 })
    expect(mockInvokeTool).toHaveBeenCalledWith('test_tool', { sessionKey: 'abc', limit: 10 })
  })

  it('returns result when no details or content', async () => {
    const result = { foo: 'bar' }
    mockInvokeTool.mockResolvedValue({ ok: true, result })
    const out = await invokeTool('test_tool')
    expect(out).toEqual(result)
  })
})
