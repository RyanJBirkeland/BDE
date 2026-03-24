/**
 * Integration tests for the Dev Playground feature.
 * Covers PlaygroundModal rendering, view mode switching, keyboard handling,
 * and the ChatRenderer pairEvents function handling playground events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlaygroundModal } from '../PlaygroundModal'
import { pairEvents } from '../ChatRenderer'
import type { AgentEvent } from '../../../../../shared/types'

// ---------------------------------------------------------------------------
// PlaygroundModal integration tests
// ---------------------------------------------------------------------------

const MULTI_LINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Test Page</title>
  <style>
    body { font-family: sans-serif; background: #f0f0f0; }
    .card { padding: 16px; border-radius: 8px; background: white; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello World</h1>
    <p>This is a test playground.</p>
  </div>
  <script>
    console.log('playground loaded');
  </script>
</body>
</html>`

describe('PlaygroundModal — integration', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders multi-line HTML content with correct line numbers in source view', () => {
    render(
      <PlaygroundModal
        html={MULTI_LINE_HTML}
        filename="index.html"
        sizeBytes={MULTI_LINE_HTML.length}
        onClose={onClose}
      />,
    )
    // Switch to source-only to simplify assertions
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    const source = screen.getByTestId('playground-source')
    const lines = MULTI_LINE_HTML.split('\n')
    // Line numbers should be present for each line
    expect(source.textContent).toContain(String(lines.length))
  })

  it('iframe receives raw HTML as srcdoc (not escaped)', () => {
    render(
      <PlaygroundModal
        html={MULTI_LINE_HTML}
        filename="app.html"
        sizeBytes={MULTI_LINE_HTML.length}
        onClose={onClose}
      />,
    )
    const iframe = screen.getByTitle('Preview of app.html') as HTMLIFrameElement
    expect(iframe.getAttribute('srcdoc')).toBe(MULTI_LINE_HTML)
  })

  it('sandbox attribute only allows scripts (no same-origin, no popups)', () => {
    render(
      <PlaygroundModal
        html="<h1>Test</h1>"
        filename="secure.html"
        sizeBytes={14}
        onClose={onClose}
      />,
    )
    const iframe = screen.getByTitle('Preview of secure.html')
    const sandbox = iframe.getAttribute('sandbox')
    expect(sandbox).toBe('allow-scripts')
    // Ensure dangerous permissions are not present
    expect(sandbox).not.toContain('allow-same-origin')
    expect(sandbox).not.toContain('allow-popups')
    expect(sandbox).not.toContain('allow-forms')
    expect(sandbox).not.toContain('allow-top-navigation')
  })

  it('view mode cycle: split -> preview -> source -> split', () => {
    render(
      <PlaygroundModal
        html="<h1>Hi</h1>"
        filename="test.html"
        sizeBytes={12}
        onClose={onClose}
      />,
    )

    // Default is split — both panes visible
    expect(screen.getByTestId('playground-preview')).toBeTruthy()
    expect(screen.getByTestId('playground-source')).toBeTruthy()

    // Switch to preview
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByTestId('playground-preview')).toBeTruthy()
    expect(screen.queryByTestId('playground-source')).toBeNull()

    // Switch to source
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    expect(screen.queryByTestId('playground-preview')).toBeNull()
    expect(screen.getByTestId('playground-source')).toBeTruthy()

    // Back to split
    fireEvent.click(screen.getByRole('tab', { name: 'Split' }))
    expect(screen.getByTestId('playground-preview')).toBeTruthy()
    expect(screen.getByTestId('playground-source')).toBeTruthy()
  })

  it('aria-selected tracks active view mode', () => {
    render(
      <PlaygroundModal
        html="<p>x</p>"
        filename="a.html"
        sizeBytes={7}
        onClose={onClose}
      />,
    )

    const splitTab = screen.getByRole('tab', { name: 'Split' })
    const previewTab = screen.getByRole('tab', { name: 'Preview' })
    const sourceTab = screen.getByRole('tab', { name: 'Source' })

    // Default: split is selected
    expect(splitTab.getAttribute('aria-selected')).toBe('true')
    expect(previewTab.getAttribute('aria-selected')).toBe('false')
    expect(sourceTab.getAttribute('aria-selected')).toBe('false')

    // Click preview
    fireEvent.click(previewTab)
    expect(splitTab.getAttribute('aria-selected')).toBe('false')
    expect(previewTab.getAttribute('aria-selected')).toBe('true')
    expect(sourceTab.getAttribute('aria-selected')).toBe('false')
  })

  it('Escape key closes modal even when fired from nested element', () => {
    render(
      <PlaygroundModal
        html="<p>test</p>"
        filename="test.html"
        sizeBytes={12}
        onClose={onClose}
      />,
    )
    // Fire Escape from the modal itself (not document)
    const modal = screen.getByTestId('playground-modal')
    fireEvent.keyDown(modal, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on non-Escape key press', () => {
    render(
      <PlaygroundModal
        html="<p>test</p>"
        filename="test.html"
        sizeBytes={12}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Open in Browser button calls window.api.openExternal', async () => {
    render(
      <PlaygroundModal
        html="<h1>Open me</h1>"
        filename="open.html"
        sizeBytes={18}
        onClose={onClose}
      />,
    )
    const openBtn = screen.getByLabelText('Open in browser')
    fireEvent.click(openBtn)
    // openExternal is mocked in test-setup
    expect(window.api.openExternal).toHaveBeenCalled()
  })

  it('formats large file size as MB', () => {
    render(
      <PlaygroundModal
        html="<p>big</p>"
        filename="large.html"
        sizeBytes={3.5 * 1024 * 1024}
        onClose={onClose}
      />,
    )
    expect(screen.getByText('3.5 MB')).toBeTruthy()
  })

  it('source pane HTML is escaped (no raw tags)', () => {
    const html = '<script>alert("xss")</script>'
    render(
      <PlaygroundModal
        html={html}
        filename="xss.html"
        sizeBytes={html.length}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    const source = screen.getByTestId('playground-source')
    // The source pane should NOT contain raw <script> tags as HTML
    // (they'd be escaped as &lt;script&gt; in the display)
    const scriptElements = source.querySelectorAll('script')
    expect(scriptElements.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// pairEvents — agent:playground event handling
// ---------------------------------------------------------------------------

describe('pairEvents — playground event handling', () => {
  it('skips agent:playground events (not rendered as ChatBlocks)', () => {
    // The current ChatRenderer pairEvents does not have a case for agent:playground.
    // Verify it gracefully skips playground events without errors.
    const events: AgentEvent[] = [
      { type: 'agent:started', model: 'claude-3', timestamp: 1000 },
      {
        type: 'agent:playground',
        filename: 'preview.html',
        html: '<h1>Hello</h1>',
        sizeBytes: 14,
        timestamp: 2000,
      },
      {
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0.01,
        tokensIn: 100,
        tokensOut: 200,
        durationMs: 5000,
        timestamp: 3000,
      },
    ]

    const blocks = pairEvents(events)
    // Should have started + completed (playground is skipped/not handled)
    expect(blocks.length).toBe(2)
    expect(blocks[0].type).toBe('started')
    expect(blocks[1].type).toBe('completed')
  })

  it('handles multiple playground events in a stream', () => {
    const events: AgentEvent[] = [
      { type: 'agent:started', model: 'claude-3', timestamp: 1000 },
      { type: 'agent:text', text: 'Building UI...', timestamp: 1500 },
      {
        type: 'agent:playground',
        filename: 'v1.html',
        html: '<h1>V1</h1>',
        sizeBytes: 12,
        timestamp: 2000,
      },
      { type: 'agent:text', text: 'Iterating...', timestamp: 2500 },
      {
        type: 'agent:playground',
        filename: 'v2.html',
        html: '<h1>V2</h1>',
        sizeBytes: 12,
        timestamp: 3000,
      },
      {
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0.02,
        tokensIn: 200,
        tokensOut: 400,
        durationMs: 10000,
        timestamp: 4000,
      },
    ]

    const blocks = pairEvents(events)
    // started + text + text + completed (2 playground events skipped)
    expect(blocks.length).toBe(4)
    expect(blocks[0].type).toBe('started')
    expect(blocks[1].type).toBe('text')
    expect(blocks[2].type).toBe('text')
    expect(blocks[3].type).toBe('completed')
  })
})
