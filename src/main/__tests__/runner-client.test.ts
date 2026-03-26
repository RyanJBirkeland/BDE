/**
 * Integration tests for runner-client.ts
 * Uses a real in-process HTTP server to test the client against a mock runner API.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'

// ---------------------------------------------------------------------------
// We need to capture the mock port after the server starts, then configure
// the getSetting mock to return a URL pointing at it. Because vi.mock is
// hoisted, we use a module-level variable that the factory closure reads.
// ---------------------------------------------------------------------------

let mockRunnerUrl = 'http://127.0.0.1:0' // overwritten after server starts
const mockApiKey = 'test-key'

vi.mock('../settings', () => ({
  getSetting: vi.fn((key: string) => {
    if (key === 'runners') {
      return JSON.stringify([{ url: mockRunnerUrl, apiKey: mockApiKey }])
    }
    return null
  })
}))

// Import the module under test AFTER the mock is established
import {
  listAgents,
  steerAgent,
  killAgent,
  getAgent,
  getAgentLogUrl,
  getEventsUrl
} from '../runner-client'

// ---------------------------------------------------------------------------
// In-process mock HTTP server
// ---------------------------------------------------------------------------

interface CapturedRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

const capturedRequests: CapturedRequest[] = []

/** Response stub — each test can overwrite these before issuing a request. */
let mockStatusCode = 200
let mockResponseBody: unknown = {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const mockServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const raw = await readBody(req)
  let body: unknown = null
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      body = raw
    }
  }

  capturedRequests.push({
    method: req.method ?? 'GET',
    url: req.url ?? '/',
    headers: req.headers as Record<string, string | string[] | undefined>,
    body
  })

  res.writeHead(mockStatusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(mockResponseBody))
})

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      const addr = mockServer.address() as AddressInfo
      mockRunnerUrl = `http://127.0.0.1:${addr.port}`
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    mockServer.close((err) => (err ? reject(err) : resolve()))
  })
})

function resetMock(status = 200, body: unknown = {}) {
  capturedRequests.length = 0
  mockStatusCode = status
  mockResponseBody = body
}

function lastRequest(): CapturedRequest {
  return capturedRequests[capturedRequests.length - 1]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runner-client', () => {
  describe('listAgents()', () => {
    it('GETs /agents and returns the parsed response', async () => {
      const agents = [
        { id: 'a1', status: 'running' },
        { id: 'a2', status: 'idle' }
      ]
      resetMock(200, agents)

      const result = await listAgents()

      expect(result).toEqual(agents)
      const req = lastRequest()
      expect(req.method).toBe('GET')
      expect(req.url).toBe('/agents')
    })

    it('sends Authorization header with the configured API key', async () => {
      resetMock(200, [])

      await listAgents()

      const req = lastRequest()
      expect(req.headers['authorization']).toBe(`Bearer ${mockApiKey}`)
    })

    it('sends Content-Type: application/json', async () => {
      resetMock(200, [])

      await listAgents()

      const req = lastRequest()
      expect(req.headers['content-type']).toBe('application/json')
    })
  })

  describe('getAgent()', () => {
    it('GETs /agents/:id and returns parsed task', async () => {
      const agent = { id: 'a1', status: 'running', taskId: 't1' }
      resetMock(200, agent)

      const result = await getAgent('a1')

      expect(result).toEqual(agent)
      const req = lastRequest()
      expect(req.method).toBe('GET')
      expect(req.url).toBe('/agents/a1')
    })

    it('returns null when server responds with non-200', async () => {
      resetMock(404, { error: 'Not found' })

      const result = await getAgent('missing')

      expect(result).toBeNull()
    })
  })

  describe('steerAgent()', () => {
    it('POSTs to /agents/:id/steer with the correct body', async () => {
      resetMock(200, { ok: true })

      const result = await steerAgent('a1', 'please stop')

      expect(result).toEqual({ ok: true })
      const req = lastRequest()
      expect(req.method).toBe('POST')
      expect(req.url).toBe('/agents/a1/steer')
      expect(req.body).toEqual({ message: 'please stop' })
    })

    it('sends Authorization header', async () => {
      resetMock(200, {})

      await steerAgent('a1', 'hello')

      const req = lastRequest()
      expect(req.headers['authorization']).toBe(`Bearer ${mockApiKey}`)
    })
  })

  describe('killAgent()', () => {
    it('POSTs to /agents/:id/kill', async () => {
      resetMock(200, { killed: true })

      const result = await killAgent('a1')

      expect(result).toEqual({ killed: true })
      const req = lastRequest()
      expect(req.method).toBe('POST')
      expect(req.url).toBe('/agents/a1/kill')
    })

    it('sends an empty POST body (no body required)', async () => {
      resetMock(200, {})

      await killAgent('a2')

      const req = lastRequest()
      expect(req.body).toBeNull()
    })
  })

  describe('getAgentLogUrl()', () => {
    it('constructs the correct log URL with token query param', () => {
      const url = getAgentLogUrl('a1')
      expect(url).toBe(`${mockRunnerUrl}/agents/a1/log?token=${mockApiKey}`)
    })
  })

  describe('getEventsUrl()', () => {
    it('constructs the correct events URL with token query param', () => {
      const url = getEventsUrl()
      expect(url).toBe(`${mockRunnerUrl}/events?token=${mockApiKey}`)
    })
  })

  describe('error handling', () => {
    it('propagates fetch errors when the runner is unreachable', async () => {
      // Temporarily close the server so connection is refused
      await new Promise<void>((resolve, reject) => {
        mockServer.close((err) => (err ? reject(err) : resolve()))
      })

      await expect(listAgents()).rejects.toThrow()

      // Re-open server for subsequent tests
      await new Promise<void>((resolve) => {
        mockServer.listen(0, '127.0.0.1', () => {
          const addr = mockServer.address() as AddressInfo
          mockRunnerUrl = `http://127.0.0.1:${addr.port}`
          resolve()
        })
      })
    })

    it('throws on a non-200 response (listAgents)', async () => {
      resetMock(500, { error: 'internal server error' })
      await expect(listAgents()).rejects.toThrow('listAgents failed: 500')
    })

    it('throws on a non-200 response (steerAgent)', async () => {
      resetMock(503, { error: 'runner overloaded' })
      await expect(steerAgent('a1', 'hello')).rejects.toThrow('steerAgent failed: 503')
    })
  })
})
