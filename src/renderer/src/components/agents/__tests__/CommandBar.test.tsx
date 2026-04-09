import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandBar } from '../CommandBar'

// Mock toast
vi.mock('../../../stores/toasts', () => ({
  toast: {
    error: vi.fn()
  }
}))

describe('CommandBar', () => {
  const defaultProps = {
    onSend: vi.fn(),
    onCommand: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create a paste event with an image
  function createImagePasteEvent(blob: Blob) {
    return {
      clipboardData: {
        items: [
          {
            type: blob.type,
            getAsFile: () => blob
          }
        ]
      }
    }
  }

  // Helper to mock FileReader with a specific result
  function mockFileReader(result: string, shouldError = false): typeof FileReader {
    return class MockFileReader {
      result = result
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null = null
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null = null
      readAsDataURL(_blob: Blob): void {
        setTimeout(() => {
          if (shouldError && this.onerror) {
            this.onerror.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>)
          } else if (this.onload) {
            this.onload.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>)
          }
        }, 0)
      }
    } as unknown as typeof FileReader
  }

  it('renders prompt character', () => {
    const { container } = render(<CommandBar {...defaultProps} />)
    const prompt = container.querySelector('.command-bar__prompt')
    expect(prompt).toBeInTheDocument()
    expect(prompt).toHaveTextContent('>')
  })

  it('renders input field with placeholder', () => {
    render(<CommandBar {...defaultProps} />)
    expect(
      screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')
    ).toBeInTheDocument()
  })

  it('shows autocomplete when typing /', async () => {
    const user = userEvent.setup()
    const { container } = render(<CommandBar {...defaultProps} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

    await user.type(input, '/')

    await waitFor(() => {
      expect(container.querySelector('.command-autocomplete')).toBeInTheDocument()
    })
  })

  it('shows filtered commands in autocomplete', async () => {
    const user = userEvent.setup()
    render(<CommandBar {...defaultProps} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

    await user.type(input, '/sto')

    await waitFor(() => {
      expect(screen.getByText('/stop')).toBeInTheDocument()
    })
  })

  it('hides autocomplete when input does not start with /', async () => {
    const user = userEvent.setup()
    const { container } = render(<CommandBar {...defaultProps} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

    await user.type(input, 'hello')

    expect(container.querySelector('.command-autocomplete')).not.toBeInTheDocument()
  })

  it('sends free text message on Enter', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<CommandBar {...defaultProps} onSend={onSend} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

    await user.type(input, 'hello world')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith('hello world', undefined)
    expect(input).toHaveValue('')
  })

  it('sends slash command with onCommand on Enter', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    const { container } = render(<CommandBar {...defaultProps} onCommand={onCommand} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

    await user.type(input, '/stop')
    // Wait for autocomplete to appear, then press Escape to close it
    await waitFor(() => {
      expect(container.querySelector('.command-autocomplete')).toBeInTheDocument()
    })
    await user.keyboard('{Escape}')
    await user.keyboard('{Enter}')

    expect(onCommand).toHaveBeenCalledWith('/stop', undefined)
    expect(input).toHaveValue('')
  })

  it('sends slash command with arguments', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    render(<CommandBar {...defaultProps} onCommand={onCommand} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

    await user.type(input, '/focus authentication')
    // Close autocomplete
    await user.keyboard('{Escape}')
    await user.keyboard('{Enter}')

    expect(onCommand).toHaveBeenCalledWith('/focus', 'authentication')
    expect(input).toHaveValue('')
  })

  it('does not send on empty input', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onCommand = vi.fn()
    render(<CommandBar {...defaultProps} onSend={onSend} onCommand={onCommand} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('disabled state disables input', () => {
    render(<CommandBar {...defaultProps} disabled={true} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')
    expect(input).toBeDisabled()
  })

  it('disabled state shows disabledReason as placeholder', () => {
    render(<CommandBar {...defaultProps} disabled={true} disabledReason="Agent is not running" />)
    expect(screen.getByPlaceholderText('Agent is not running')).toBeInTheDocument()
  })

  it('does not send when disabled', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onCommand = vi.fn()
    render(<CommandBar {...defaultProps} onSend={onSend} onCommand={onCommand} disabled={true} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

    // Try to type and send (should not work due to disabled state)
    await user.type(input, 'test')
    await user.keyboard('{Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('clears input after sending', async () => {
    const user = userEvent.setup()
    render(<CommandBar {...defaultProps} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

    await user.type(input, 'test message')
    await user.keyboard('{Enter}')

    expect(input).toHaveValue('')
  })

  it('autocomplete selects command on click', async () => {
    const user = userEvent.setup()
    render(<CommandBar {...defaultProps} />)
    const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

    await user.type(input, '/')

    await waitFor(() => {
      expect(screen.getByText('/stop')).toBeInTheDocument()
    })

    await user.click(screen.getByText('/stop'))

    expect(input).toHaveValue('/stop ')
  })

  describe('clipboard image paste', () => {
    it('shows thumbnail when image is pasted', async () => {
      const { container } = render(<CommandBar {...defaultProps} />)
      const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

      const originalFileReader = window.FileReader
      window.FileReader = mockFileReader('data:image/png;base64,fakebase64data')

      const imageBlob = new Blob(['fake-image-data'], { type: 'image/png' })
      const clipboardEvent = createImagePasteEvent(imageBlob)
      fireEvent.paste(input, clipboardEvent)

      await waitFor(() => {
        const thumbnail = container.querySelector('img')
        expect(thumbnail).toBeInTheDocument()
        expect(thumbnail).toHaveAttribute('src', 'data:image/png;base64,fakebase64data')
      })

      window.FileReader = originalFileReader
    })

    it('does not show thumbnail when text is pasted', async () => {
      const user = userEvent.setup()
      const { container } = render(<CommandBar {...defaultProps} />)
      const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

      await user.click(input)
      await user.paste('plain text')

      expect(container.querySelector('img')).not.toBeInTheDocument()
      expect(input).toHaveValue('plain text')
    })

    it('removes attachment when X button is clicked', async () => {
      const user = userEvent.setup()
      const { container } = render(<CommandBar {...defaultProps} />)
      const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

      const originalFileReader = window.FileReader
      window.FileReader = mockFileReader('data:image/png;base64,fakebase64data')

      const imageBlob = new Blob(['fake-image-data'], { type: 'image/png' })
      const clipboardEvent = createImagePasteEvent(imageBlob)
      fireEvent.paste(input, clipboardEvent)

      await waitFor(() => {
        expect(container.querySelector('img')).toBeInTheDocument()
      })

      const removeButton = container.querySelector('button[title="Remove attachment"]')
      expect(removeButton).toBeInTheDocument()
      await user.click(removeButton!)

      expect(container.querySelector('img')).not.toBeInTheDocument()

      window.FileReader = originalFileReader
    })

    it('sends message with attachment on Enter', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      const { container } = render(<CommandBar {...defaultProps} onSend={onSend} />)
      const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

      const originalFileReader = window.FileReader
      window.FileReader = mockFileReader('data:image/png;base64,fakebase64data')

      const imageBlob = new Blob(['fake-image-data'], { type: 'image/png' })
      const clipboardEvent = createImagePasteEvent(imageBlob)
      fireEvent.paste(input, clipboardEvent)

      await waitFor(() => {
        expect(container.querySelector('img')).toBeInTheDocument()
      })

      await user.type(input, 'check this image')
      await user.keyboard('{Enter}')

      expect(onSend).toHaveBeenCalledWith(
        'check this image',
        expect.objectContaining({
          type: 'image',
          mimeType: 'image/png',
          data: 'fakebase64data'
        })
      )
      expect(container.querySelector('img')).not.toBeInTheDocument()

      window.FileReader = originalFileReader
    })

    it('sends attachment without text on Enter', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      const { container } = render(<CommandBar {...defaultProps} onSend={onSend} />)
      const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

      const originalFileReader = window.FileReader
      window.FileReader = mockFileReader('data:image/png;base64,fakebase64data')

      const imageBlob = new Blob(['fake-image-data'], { type: 'image/png' })
      const clipboardEvent = createImagePasteEvent(imageBlob)
      fireEvent.paste(input, clipboardEvent)

      await waitFor(() => {
        expect(container.querySelector('img')).toBeInTheDocument()
      })

      await user.keyboard('{Enter}')

      expect(onSend).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          type: 'image',
          mimeType: 'image/png'
        })
      )

      window.FileReader = originalFileReader
    })

    it('shows error toast when pasted image is too large', async () => {
      const { toast } = await import('../../../stores/toasts')
      render(<CommandBar {...defaultProps} />)
      const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

      const largeBlob = new Blob([new ArrayBuffer(6 * 1024 * 1024)], { type: 'image/png' })
      const clipboardEvent = createImagePasteEvent(largeBlob)
      fireEvent.paste(input, clipboardEvent)

      expect(toast.error).toHaveBeenCalledWith('Image too large (max 5MB)')
    })

    it('shows error toast on FileReader error', async () => {
      const { toast } = await import('../../../stores/toasts')
      render(<CommandBar {...defaultProps} />)
      const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

      const originalFileReader = window.FileReader
      window.FileReader = mockFileReader('', true)

      const imageBlob = new Blob(['fake-image-data'], { type: 'image/png' })
      const clipboardEvent = createImagePasteEvent(imageBlob)
      fireEvent.paste(input, clipboardEvent)

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to read image')
      })

      window.FileReader = originalFileReader
    })

    it('replaces first attachment when second image is pasted', async () => {
      const { container } = render(<CommandBar {...defaultProps} />)
      const input = screen.getByPlaceholderText('Message the agent… (Shift+Enter for newline)')

      const originalFileReader = window.FileReader

      // Paste first image
      window.FileReader = mockFileReader('data:image/png;base64,firstimage')
      const firstBlob = new Blob(['first-image'], { type: 'image/png' })
      const firstClipboardEvent = createImagePasteEvent(firstBlob)
      fireEvent.paste(input, firstClipboardEvent)

      await waitFor(() => {
        const thumbnail = container.querySelector('img')
        expect(thumbnail).toHaveAttribute('src', 'data:image/png;base64,firstimage')
      })

      // Paste second image
      window.FileReader = mockFileReader('data:image/jpeg;base64,secondimage')
      const secondBlob = new Blob(['second-image'], { type: 'image/jpeg' })
      const secondClipboardEvent = createImagePasteEvent(secondBlob)
      fireEvent.paste(input, secondClipboardEvent)

      await waitFor(() => {
        const thumbnail = container.querySelector('img')
        expect(thumbnail).toHaveAttribute('src', 'data:image/jpeg;base64,secondimage')
      })

      window.FileReader = originalFileReader
    })
  })
})
