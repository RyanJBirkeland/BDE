import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerWebhookHandlers } from '../webhook-handlers'
import * as webhookQueries from '../../data/webhook-queries'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('../../data/webhook-queries')

describe('webhook-handlers', () => {
  beforeEach(() => {
    handlers.clear()
    vi.mocked(webhookQueries.listWebhooks).mockReturnValue([])
    vi.mocked(webhookQueries.createWebhook).mockImplementation(
      (payload) => ({ id: 'wh-123', ...payload, enabled: true, events: [] }) as never
    )
    vi.mocked(webhookQueries.updateWebhook).mockImplementation(
      (payload) => ({ id: payload.id, updated: true, url: '', enabled: true, events: [] }) as never
    )
    vi.mocked(webhookQueries.deleteWebhook).mockReturnValue(true)
    vi.mocked(webhookQueries.getWebhookById).mockImplementation((id) =>
      id === 'wh-123' ? { id, url: 'https://example.com', enabled: true, events: [] } : null
    )
    registerWebhookHandlers()
  })

  it('should register all webhook handlers', () => {
    expect(handlers.has('webhook:list')).toBe(true)
    expect(handlers.has('webhook:create')).toBe(true)
    expect(handlers.has('webhook:update')).toBe(true)
    expect(handlers.has('webhook:delete')).toBe(true)
    expect(handlers.has('webhook:test')).toBe(true)
  })

  describe('webhook:list', () => {
    it('should return webhook list', async () => {
      vi.mocked(webhookQueries.listWebhooks).mockReturnValue([
        { id: 'wh-1', url: 'https://example.com', events: [], enabled: true }
      ])

      const handler = handlers.get('webhook:list')!
      const result = await handler({})

      expect(result).toEqual([
        { id: 'wh-1', url: 'https://example.com', events: [], enabled: true }
      ])
    })
  })

  describe('webhook:create', () => {
    it('should create webhook', async () => {
      const handler = handlers.get('webhook:create')!
      const payload = { url: 'https://example.com/hook', events: ['task.done'], secret: 'abc' }

      const result = await handler({}, payload)

      expect(result).toMatchObject({ id: 'wh-123', url: 'https://example.com/hook' })
    })
  })

  describe('webhook:update', () => {
    it('should update webhook', async () => {
      const handler = handlers.get('webhook:update')!
      const payload = { id: 'wh-123', enabled: false }

      const result = await handler({}, payload)

      expect(result).toMatchObject({ id: 'wh-123', updated: true })
    })
  })

  describe('webhook:delete', () => {
    it('should delete webhook', async () => {
      const handler = handlers.get('webhook:delete')!
      const result = await handler({}, { id: 'wh-123' })

      expect(result).toBe(true)
    })
  })

  describe('webhook:test', () => {
    it('should throw if webhook not found', async () => {
      const handler = handlers.get('webhook:test')!

      await expect(handler({}, { id: 'wh-999' })).rejects.toThrow('Webhook wh-999 not found')
    })

    it('should send test webhook', async () => {
      global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))

      const handler = handlers.get('webhook:test')!
      const result = await handler({}, { id: 'wh-123' })

      expect(result).toEqual({ success: true, status: 200 })
      expect(fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })

    it('should throw if webhook test fails', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response)
      )

      const handler = handlers.get('webhook:test')!

      await expect(handler({}, { id: 'wh-123' })).rejects.toThrow('Test failed: HTTP 500')
    })

    it('should include HMAC signature if webhook has secret', async () => {
      vi.mocked(webhookQueries.getWebhookById).mockReturnValue({
        id: 'wh-123',
        url: 'https://example.com',
        secret: 'my-secret',
        enabled: true,
        events: []
      })

      global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))

      const handler = handlers.get('webhook:test')!
      await handler({}, { id: 'wh-123' })

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const headers = fetchCall[1]?.headers as Record<string, string>

      expect(headers['X-BDE-Signature']).toBeDefined()
      expect(headers['X-BDE-Event']).toBe('webhook.test')
    })
  })
})
