import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlaygroundModal } from '../PlaygroundModal'

const SAMPLE_HTML = '<html><body><h1>Hello</h1></body></html>'

describe('PlaygroundModal', () => {
  const onClose = vi.fn()
  const defaultProps = {
    html: SAMPLE_HTML,
    filename: 'preview.html',
    sizeBytes: 1234,
    onClose
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the modal with filename and file size', () => {
    render(<PlaygroundModal {...defaultProps} />)
    expect(screen.getByText('preview.html')).toBeTruthy()
    expect(screen.getByText('1.2 KB')).toBeTruthy()
  })

  it('renders with dialog role and aria attributes', () => {
    render(<PlaygroundModal {...defaultProps} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Playground preview: preview.html')
  })

  it('renders sandboxed iframe with srcdoc in split mode (default)', () => {
    render(<PlaygroundModal {...defaultProps} />)
    const iframe = screen.getByTitle('Preview of preview.html')
    expect(iframe).toBeTruthy()
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('srcdoc')).toBe(SAMPLE_HTML)
  })

  it('renders both preview and source panes in split mode', () => {
    render(<PlaygroundModal {...defaultProps} />)
    expect(screen.getByTestId('playground-preview')).toBeTruthy()
    expect(screen.getByTestId('playground-source')).toBeTruthy()
  })

  it('switches to preview-only mode', () => {
    render(<PlaygroundModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByTestId('playground-preview')).toBeTruthy()
    expect(screen.queryByTestId('playground-source')).toBeNull()
  })

  it('switches to source-only mode', () => {
    render(<PlaygroundModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    expect(screen.queryByTestId('playground-preview')).toBeNull()
    expect(screen.getByTestId('playground-source')).toBeTruthy()
  })

  it('calls onClose when Escape is pressed', () => {
    render(<PlaygroundModal {...defaultProps} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when close button is clicked', () => {
    render(<PlaygroundModal {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Close playground'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when overlay backdrop is clicked', () => {
    render(<PlaygroundModal {...defaultProps} />)
    fireEvent.click(screen.getByTestId('playground-modal-overlay'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when modal content is clicked', () => {
    render(<PlaygroundModal {...defaultProps} />)
    fireEvent.click(screen.getByTestId('playground-modal'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders view mode toggle with three tabs', () => {
    render(<PlaygroundModal {...defaultProps} />)
    expect(screen.getByRole('tab', { name: 'Split' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Source' })).toBeTruthy()
  })

  it('has Split tab selected by default', () => {
    render(<PlaygroundModal {...defaultProps} />)
    const splitTab = screen.getByRole('tab', { name: 'Split' })
    expect(splitTab.getAttribute('aria-selected')).toBe('true')
  })

  it('renders Open in Browser button', () => {
    render(<PlaygroundModal {...defaultProps} />)
    expect(screen.getByLabelText('Open in browser')).toBeTruthy()
  })

  it('shows source with line numbers', () => {
    render(<PlaygroundModal {...defaultProps} />)
    const source = screen.getByTestId('playground-source')
    expect(source.textContent).toContain('1')
  })

  it('formats bytes correctly', () => {
    const { rerender } = render(<PlaygroundModal {...defaultProps} sizeBytes={500} />)
    expect(screen.getByText('500 B')).toBeTruthy()

    rerender(<PlaygroundModal {...defaultProps} sizeBytes={2048} />)
    expect(screen.getByText('2.0 KB')).toBeTruthy()

    rerender(<PlaygroundModal {...defaultProps} sizeBytes={1048576} />)
    expect(screen.getByText('1.0 MB')).toBeTruthy()
  })
})
