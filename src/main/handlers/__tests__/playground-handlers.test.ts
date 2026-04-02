/**
 * Unit tests for playground IPC handlers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Mock dependencies before importing the module
const mockBroadcast = vi.fn()
let capturedHandler: Function | null = null

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn((channel: string, handler: Function) => {
    capturedHandler = handler
  })
}))

vi.mock('../../broadcast', () => ({
  broadcast: mockBroadcast
}))

describe('playground-handlers', () => {
  let testDir: string

  beforeEach(async () => {
    // Create temp directory for test files
    testDir = join(tmpdir(), `playground-test-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })

    // Clear mocks
    vi.clearAllMocks()
    capturedHandler = null

    // Import and register handlers (this will capture the handler via the mock)
    const { registerPlaygroundHandlers } = await import('../playground-handlers')
    registerPlaygroundHandlers()
  })

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true })
  })

  it('validates .html extension', async () => {
    const filePath = join(testDir, 'test.txt')
    await writeFile(filePath, 'content')

    await expect(capturedHandler!(null, { filePath })).rejects.toThrow(
      'Invalid file type: only .html files are supported'
    )
  })

  it('enforces 5MB file size limit', async () => {
    const filePath = join(testDir, 'large.html')
    // Create a file larger than 5MB
    const largeContent = 'x'.repeat(6 * 1024 * 1024)
    await writeFile(filePath, largeContent)

    await expect(capturedHandler!(null, { filePath })).rejects.toThrow('File too large')
  })

  it('reads HTML file and broadcasts agent:playground event', async () => {
    const filePath = join(testDir, 'preview.html')
    const htmlContent = '<html><body><h1>Test</h1></body></html>'
    await writeFile(filePath, htmlContent)

    await capturedHandler!(null, { filePath })

    expect(mockBroadcast).toHaveBeenCalledTimes(1)
    expect(mockBroadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'playground',
      event: {
        type: 'agent:playground',
        filename: 'preview.html',
        html: htmlContent,
        sizeBytes: htmlContent.length,
        timestamp: expect.any(Number)
      }
    })
  })

  it('handles uppercase .HTML extension', async () => {
    const filePath = join(testDir, 'TEST.HTML')
    const htmlContent = '<html><body>Test</body></html>'
    await writeFile(filePath, htmlContent)

    await capturedHandler!(null, { filePath })

    expect(mockBroadcast).toHaveBeenCalledTimes(1)
  })

  it('rejects non-existent files', async () => {
    const filePath = join(testDir, 'nonexistent.html')

    await expect(capturedHandler!(null, { filePath })).rejects.toThrow()
  })

  it('includes correct file size in event', async () => {
    const filePath = join(testDir, 'sized.html')
    const htmlContent = '<html><body>x</body></html>'
    await writeFile(filePath, htmlContent)

    await capturedHandler!(null, { filePath })

    const call = mockBroadcast.mock.calls[0]
    expect(call[1].event.sizeBytes).toBe(htmlContent.length)
  })

  it('preserves HTML content exactly', async () => {
    const filePath = join(testDir, 'content.html')
    const htmlContent = '<html>\n  <body>\n    <h1>Test & "quotes"</h1>\n  </body>\n</html>'
    await writeFile(filePath, htmlContent)

    await capturedHandler!(null, { filePath })

    const call = mockBroadcast.mock.calls[0]
    expect(call[1].event.html).toBe(htmlContent)
  })
})
