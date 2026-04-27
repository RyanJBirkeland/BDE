/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

const logs = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('../../logger', () => ({
  createLogger: () => logs
}))

// In tests, Electron's safeStorage is not available. Stub it to a
// deterministic XOR-based cipher so the queries under test can still
// encrypt/decrypt. The shape of the stub matches the Electron API that
// `secure-storage.ts` uses.
vi.mock('electron', () => {
  const key = Buffer.from('fleet-test-stub-key')
  function xor(buf: Buffer): Buffer {
    const out = Buffer.alloc(buf.length)
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length]
    return out
  }
  return {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => xor(Buffer.from(value, 'utf8')),
      decryptString: (buf: Buffer) => xor(buf).toString('utf8')
    }
  }
})

import { runMigrations } from '../../db'
import {
  parseWebhookEvents,
  listWebhooks,
  createWebhook,
  getWebhookById,
  getWebhooks
} from '../webhook-queries'

let db: Database.Database

beforeEach(() => {
  logs.info.mockClear()
  logs.warn.mockClear()
  logs.error.mockClear()
  logs.debug.mockClear()
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('parseWebhookEvents', () => {
  it('returns [] for null without warning', () => {
    expect(parseWebhookEvents(null)).toEqual([])
    expect(logs.warn).not.toHaveBeenCalled()
  })

  it('returns [] for undefined without warning', () => {
    expect(parseWebhookEvents(undefined)).toEqual([])
    expect(logs.warn).not.toHaveBeenCalled()
  })

  it('parses a JSON array of strings', () => {
    expect(parseWebhookEvents('["task.created","task.done"]')).toEqual([
      'task.created',
      'task.done'
    ])
    expect(logs.warn).not.toHaveBeenCalled()
  })

  it('returns [] and warns for malformed JSON', () => {
    expect(parseWebhookEvents('{not valid json')).toEqual([])
    expect(logs.warn).toHaveBeenCalledTimes(1)
    expect(logs.warn.mock.calls[0][0]).toMatch(/Malformed events JSON/)
  })

  it('filters non-string entries and warns', () => {
    expect(parseWebhookEvents('["task.created",42,null,"task.done"]')).toEqual([
      'task.created',
      'task.done'
    ])
    expect(logs.warn).toHaveBeenCalledTimes(1)
    expect(logs.warn.mock.calls[0][0]).toMatch(/Dropped 2 non-string events entry/)
  })

  it('returns [] and warns for non-array JSON value', () => {
    expect(parseWebhookEvents('{"events":["a"]}')).toEqual([])
    expect(logs.warn).toHaveBeenCalledTimes(1)
    expect(logs.warn.mock.calls[0][0]).toMatch(/Unexpected events type/)
  })

  it('accepts already-parsed arrays', () => {
    expect(parseWebhookEvents(['a', 'b'])).toEqual(['a', 'b'])
    expect(logs.warn).not.toHaveBeenCalled()
  })

  it('returns [] for unsupported types like numbers', () => {
    expect(parseWebhookEvents(123)).toEqual([])
    expect(logs.warn).toHaveBeenCalledTimes(1)
  })
})

describe('webhook-queries integration', () => {
  it('round-trips a webhook with an events array', () => {
    const created = createWebhook(
      { url: 'https://example.com/hook', events: ['task.created', 'task.done'] },
      db
    )
    expect(created.events).toEqual(['task.created', 'task.done'])

    const fetched = getWebhookById(created.id, db)
    expect(fetched?.events).toEqual(['task.created', 'task.done'])
  })

  it('listWebhooks coerces a corrupted events row to []', () => {
    // Simulate a corrupted row by bypassing createWebhook's JSON.stringify.
    db.prepare(
      "INSERT INTO webhooks (id, url, events, enabled) VALUES ('corrupt-1', 'https://x', 'not-json', 1)"
    ).run()

    const rows = listWebhooks(db)
    const corrupt = rows.find((r) => r.id === 'corrupt-1')
    expect(corrupt?.events).toEqual([])
    expect(logs.warn).toHaveBeenCalled()
  })

  it('getWebhooks filters non-string entries from legacy rows', () => {
    db.prepare(
      "INSERT INTO webhooks (id, url, events, enabled) VALUES ('mixed-1', 'https://x', '[\"ok\",7,null]', 1)"
    ).run()

    const configs = getWebhooks(db)
    const mixed = configs.find((c) => c.id === 'mixed-1')
    expect(mixed?.events).toEqual(['ok'])
  })

  describe('secret encryption at rest', () => {
    it('does not store the cleartext secret in the secret column', () => {
      const plaintext = 'super-secret-hmac-key-abcdef12345'
      const created = createWebhook(
        { url: 'https://example.com/hook', events: ['task.done'], secret: plaintext },
        db
      )
      const raw = db.prepare('SELECT secret FROM webhooks WHERE id = ?').get(created.id) as {
        secret: string
      }
      expect(raw.secret).not.toBe(plaintext)
      expect(raw.secret).toContain('ENC:')
    })

    it('getWebhookById returns the decrypted cleartext secret', () => {
      const plaintext = 'another-key-xyz'
      const created = createWebhook(
        { url: 'https://example.com/b', events: ['task.done'], secret: plaintext },
        db
      )
      const fetched = getWebhookById(created.id, db)
      expect(fetched?.secret).toBe(plaintext)
    })

    it('getWebhooks returns the decrypted cleartext secret for service consumers', () => {
      const plaintext = 'service-consumer-key'
      createWebhook(
        { url: 'https://example.com/c', events: ['task.done'], secret: plaintext },
        db
      )
      const all = getWebhooks(db)
      const match = all.find((w) => w.url === 'https://example.com/c')
      expect(match?.secret).toBe(plaintext)
    })

    it('decrypts legacy cleartext rows transparently', () => {
      db.prepare(
        "INSERT INTO webhooks (id, url, events, secret, enabled) VALUES ('legacy-1', 'https://x', '[]', 'plain-legacy', 1)"
      ).run()
      const fetched = getWebhookById('legacy-1', db)
      expect(fetched?.secret).toBe('plain-legacy')
    })
  })
})
