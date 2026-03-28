import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderHook, act } from '@testing-library/react'
import { PromptModal, usePrompt } from '../PromptModal'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onKeyDown, role, ...rest }: any) => {
      const { createElement } = require('react')
      return createElement('div', { onKeyDown, role, ...rest }, children)
    }
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false
}))

vi.mock('../../lib/motion', () => ({
  VARIANTS: { scaleIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: { duration: 0 },
  useReducedMotion: () => false
}))

describe('PromptModal', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when open is false', () => {
    const { container } = render(
      <PromptModal
        open={false}
        message="Enter name:"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(container.textContent).toBe('')
  })

  it('renders message and input when open is true', () => {
    render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    expect(screen.getByText('Enter name:')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders title when provided', () => {
    render(
      <PromptModal
        open={true}
        title="New File"
        message="Enter file name:"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText('New File')).toBeInTheDocument()
    expect(screen.getByText('Enter file name:')).toBeInTheDocument()
  })

  it('uses default confirm/cancel labels', () => {
    render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('uses custom confirm/cancel labels', () => {
    render(
      <PromptModal
        open={true}
        message="Enter name:"
        confirmLabel="Create"
        cancelLabel="Abort"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument()
  })

  it('shows placeholder in input', () => {
    render(
      <PromptModal
        open={true}
        message="Enter name:"
        placeholder="my-file.txt"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', 'my-file.txt')
  })

  it('shows defaultValue in input', () => {
    render(
      <PromptModal
        open={true}
        message="Rename to:"
        defaultValue="old-name.txt"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('old-name.txt')
  })

  it('calls onConfirm with input value when confirm button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const input = screen.getByRole('textbox')
    await user.type(input, 'test.txt')
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(onConfirm).toHaveBeenCalledWith('test.txt')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('does not call onConfirm when input is empty', async () => {
    const user = userEvent.setup()
    render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const confirmButton = screen.getByRole('button', { name: 'OK' })
    expect(confirmButton).toBeDisabled()
    await user.click(confirmButton)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not call onConfirm when input contains only whitespace', async () => {
    const user = userEvent.setup()
    render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const input = screen.getByRole('textbox')
    await user.type(input, '   ')
    const confirmButton = screen.getByRole('button', { name: 'OK' })
    expect(confirmButton).toBeDisabled()
  })

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onCancel when overlay is clicked', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const overlay = container.querySelector('.prompt-modal__overlay')!
    await user.click(overlay)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when Escape key is pressed', async () => {
    render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('calls onConfirm when Enter key is pressed with valid input', async () => {
    const user = userEvent.setup()
    render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const input = screen.getByRole('textbox')
    await user.type(input, 'test.txt')
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Enter', code: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith('test.txt')
  })

  it('does not call onConfirm when Enter key is pressed with empty input', async () => {
    render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Enter', code: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('has aria-modal="true" attribute', () => {
    render(
      <PromptModal open={true} message="Enter name:" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })
})

describe('usePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns prompt function and promptProps', () => {
    const { result } = renderHook(() => usePrompt())
    expect(typeof result.current.prompt).toBe('function')
    expect(result.current.promptProps).toBeDefined()
    expect(result.current.promptProps.open).toBe(false)
  })

  it('prompt() opens the modal with the provided message', async () => {
    const { result } = renderHook(() => usePrompt())

    act(() => {
      void result.current.prompt({ message: 'Enter your name:' })
    })

    expect(result.current.promptProps.open).toBe(true)
    expect(result.current.promptProps.message).toBe('Enter your name:')
  })

  it('prompt() resolves with input value when onConfirm is called', async () => {
    const { result } = renderHook(() => usePrompt())

    let resolved: string | null | undefined
    act(() => {
      result.current.prompt({ message: 'Enter name:' }).then((v) => {
        resolved = v
      })
    })

    act(() => {
      result.current.promptProps.onConfirm('test-value')
    })

    await waitFor(() => expect(resolved).toBe('test-value'))
    expect(result.current.promptProps.open).toBe(false)
  })

  it('prompt() resolves null when onCancel is called', async () => {
    const { result } = renderHook(() => usePrompt())

    let resolved: string | null | undefined
    act(() => {
      result.current.prompt({ message: 'Enter name:' }).then((v) => {
        resolved = v
      })
    })

    act(() => {
      result.current.promptProps.onCancel()
    })

    await waitFor(() => expect(resolved).toBeNull())
    expect(result.current.promptProps.open).toBe(false)
  })

  it('prompt() passes through title, placeholder, defaultValue, and confirmLabel', async () => {
    const { result } = renderHook(() => usePrompt())

    act(() => {
      void result.current.prompt({
        message: 'Enter file name:',
        title: 'New File',
        placeholder: 'file.txt',
        defaultValue: 'untitled.txt',
        confirmLabel: 'Create'
      })
    })

    expect(result.current.promptProps.title).toBe('New File')
    expect(result.current.promptProps.placeholder).toBe('file.txt')
    expect(result.current.promptProps.defaultValue).toBe('untitled.txt')
    expect(result.current.promptProps.confirmLabel).toBe('Create')

    act(() => {
      result.current.promptProps.onCancel()
    })
  })
})
