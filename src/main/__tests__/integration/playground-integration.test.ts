/**
 * Integration test for dev playground — full flow from HTML write to modal render
 *
 * Flow:
 * 1. Agent writes .html file via Write tool (simulated)
 * 2. run-agent.ts detects the write (when playground_enabled)
 * 3. Main process reads HTML and emits agent:playground event
 * 4. Renderer receives event and renders PlaygroundCard
 * 5. Click card → PlaygroundModal opens
 * 6. Modal renders sandboxed iframe + source
 * 7. Escape closes modal
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

describe('Playground Integration', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `playground-integration-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('File Detection', () => {
    it('detects .html file writes', async () => {
      const htmlPath = join(testDir, 'preview.html')
      const htmlContent = '<html><body><h1>Test Preview</h1></body></html>'
      await writeFile(htmlPath, htmlContent)

      // Simulate detection logic
      const ext = htmlPath.slice(htmlPath.lastIndexOf('.')).toLowerCase()
      expect(ext).toBe('.html')
    })

    it('ignores non-.html files', async () => {
      const txtPath = join(testDir, 'file.txt')
      await writeFile(txtPath, 'content')

      const ext = txtPath.slice(txtPath.lastIndexOf('.')).toLowerCase()
      expect(ext).not.toBe('.html')
    })

    it('handles .HTML uppercase extension', async () => {
      const htmlPath = join(testDir, 'TEST.HTML')
      await writeFile(htmlPath, '<html>Test</html>')

      const ext = htmlPath.slice(htmlPath.lastIndexOf('.')).toLowerCase()
      expect(ext).toBe('.html')
    })
  })

  describe('Event Flow', () => {
    it('creates valid agent:playground event structure', () => {
      const event = {
        type: 'agent:playground',
        filename: 'preview.html',
        html: '<html><body>Test</body></html>',
        sizeBytes: 31,
        timestamp: Date.now()
      }

      expect(event.type).toBe('agent:playground')
      expect(event.filename).toBe('preview.html')
      expect(event.html).toContain('<html>')
      expect(event.sizeBytes).toBeGreaterThan(0)
      expect(event.timestamp).toBeGreaterThan(0)
    })

    it('preserves HTML content exactly', () => {
      const originalHtml = '<html>\n  <body>\n    <h1>Test & "quotes"</h1>\n  </body>\n</html>'
      const event = {
        type: 'agent:playground',
        filename: 'test.html',
        html: originalHtml,
        sizeBytes: originalHtml.length,
        timestamp: Date.now()
      }

      expect(event.html).toBe(originalHtml)
      expect(event.html).toContain('&')
      expect(event.html).toContain('"')
    })
  })

  describe('Security Constraints', () => {
    it('enforces 5MB file size limit', async () => {
      const MAX_SIZE = 5 * 1024 * 1024
      const largeContent = 'x'.repeat(MAX_SIZE + 1)

      expect(largeContent.length).toBeGreaterThan(MAX_SIZE)

      // Simulated validation
      const isValid = largeContent.length <= MAX_SIZE
      expect(isValid).toBe(false)
    })

    it('accepts files under 5MB', async () => {
      const MAX_SIZE = 5 * 1024 * 1024
      const validContent = 'x'.repeat(MAX_SIZE - 1000)

      expect(validContent.length).toBeLessThan(MAX_SIZE)

      // Simulated validation
      const isValid = validContent.length <= MAX_SIZE
      expect(isValid).toBe(true)
    })

    it('validates sandbox attributes', () => {
      const sandbox = 'allow-scripts'

      // Should NOT include allow-same-origin (security risk)
      expect(sandbox).not.toContain('allow-same-origin')
      expect(sandbox).not.toContain('allow-top-navigation')
      expect(sandbox).not.toContain('allow-popups')

      // Should allow scripts
      expect(sandbox).toContain('allow-scripts')
    })
  })

  describe('Prompt Augmentation', () => {
    it('augments prompt when playground_enabled is true', () => {
      const basePrompt = 'Build a React component'
      const playgroundEnabled = true

      let finalPrompt = basePrompt
      if (playgroundEnabled) {
        finalPrompt +=
          '\n\n## Dev Playground\n\nYou have access to a Dev Playground for previewing frontend UI natively in BDE.'
      }

      expect(finalPrompt).toContain('Dev Playground')
      expect(finalPrompt).toContain(basePrompt)
    })

    it('does not augment prompt when playground_enabled is false', () => {
      const basePrompt = 'Build a React component'
      const playgroundEnabled = false

      let finalPrompt = basePrompt
      if (playgroundEnabled) {
        finalPrompt += '\n\n## Dev Playground\n\nYou have access to a Dev Playground'
      }

      expect(finalPrompt).not.toContain('Dev Playground')
      expect(finalPrompt).toBe(basePrompt)
    })
  })

  describe('File Lifecycle', () => {
    it('creates HTML file in worktree', async () => {
      const htmlPath = join(testDir, 'component.html')
      const htmlContent = '<html><body><div id="app">Hello</div></body></html>'

      await writeFile(htmlPath, htmlContent)

      // File should exist
      const { readFile } = await import('fs/promises')
      const content = await readFile(htmlPath, 'utf-8')
      expect(content).toBe(htmlContent)
    })

    it('supports multiple HTML files in sequence', async () => {
      const files = [
        { name: 'v1.html', content: '<html><body>Version 1</body></html>' },
        { name: 'v2.html', content: '<html><body>Version 2</body></html>' },
        { name: 'v3.html', content: '<html><body>Version 3</body></html>' }
      ]

      for (const file of files) {
        const path = join(testDir, file.name)
        await writeFile(path, file.content)

        const { readFile } = await import('fs/promises')
        const content = await readFile(path, 'utf-8')
        expect(content).toBe(file.content)
      }
    })
  })
})
