import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderHook, act } from '@testing-library/react'
import { ConfirmModal, useConfirm } from '../ConfirmModal'

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

describe('ConfirmModal', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when open is false', () => {
    const { container } = render(
      <ConfirmModal
        open={false}
        message="Are you sure?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(container.textContent).toBe('')
  })

  it('renders message when open is true', () => {
    render(
      <ConfirmModal open={true} message="Are you sure?" onConfirm={onConfirm} onCancel={onCancel} />
    )
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
  })

  it('renders title when provided', () => {
    render(
      <ConfirmModal
        open={true}
        title="Confirm Action"
        message="This is irreversible."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText('Confirm Action')).toBeInTheDocument()
    expect(screen.getByText('This is irreversible.')).toBeInTheDocument()
  })

  it('does not render title element when title is not provided', () => {
    render(
      <ConfirmModal
        open={true}
        message="Just a message"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.getAttribute('aria-labelledby')).toBeNull()
  })

  it('uses default confirm/cancel labels', () => {
    render(
      <ConfirmModal open={true} message="Are you sure?" onConfirm={onConfirm} onCancel={onCancel} />
    )
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('uses custom confirm/cancel labels', () => {
    render(
      <ConfirmModal
        open={true}
        message="Delete?"
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <ConfirmModal open={true} message="Are you sure?" onConfirm={onConfirm} onCancel={onCancel} />
    )
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <ConfirmModal open={true} message="Are you sure?" onConfirm={onConfirm} onCancel={onCancel} />
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onCancel when overlay is clicked', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ConfirmModal open={true} message="Are you sure?" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const overlay = container.querySelector('.confirm-modal__overlay')!
    await user.click(overlay)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when Escape key is pressed inside modal', async () => {
    render(
      <ConfirmModal open={true} message="Are you sure?" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const dialog = screen.getByRole('alertdialog')
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('has aria-modal="true" attribute', () => {
    render(
      <ConfirmModal open={true} message="Confirm?" onConfirm={onConfirm} onCancel={onCancel} />
    )
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('danger variant renders confirm button with danger styling', () => {
    render(
      <ConfirmModal
        open={true}
        message="This is destructive"
        variant="danger"
        confirmLabel="Destroy"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByRole('button', { name: 'Destroy' })).toBeInTheDocument()
  })
})

describe('useConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns confirm function and confirmProps', () => {
    const { result } = renderHook(() => useConfirm())
    expect(typeof result.current.confirm).toBe('function')
    expect(result.current.confirmProps).toBeDefined()
    expect(result.current.confirmProps.open).toBe(false)
  })

  it('confirm() opens the modal with the provided message', async () => {
    const { result } = renderHook(() => useConfirm())

    act(() => {
      void result.current.confirm({ message: 'Are you absolutely sure?' })
    })

    expect(result.current.confirmProps.open).toBe(true)
    expect(result.current.confirmProps.message).toBe('Are you absolutely sure?')
  })

  it('confirm() resolves true when onConfirm is called', async () => {
    const { result } = renderHook(() => useConfirm())

    let resolved: boolean | undefined
    act(() => {
      result.current.confirm({ message: 'Continue?' }).then((v) => {
        resolved = v
      })
    })

    act(() => {
      result.current.confirmProps.onConfirm()
    })

    await waitFor(() => expect(resolved).toBe(true))
    expect(result.current.confirmProps.open).toBe(false)
  })

  it('confirm() resolves false when onCancel is called', async () => {
    const { result } = renderHook(() => useConfirm())

    let resolved: boolean | undefined
    act(() => {
      result.current.confirm({ message: 'Continue?' }).then((v) => {
        resolved = v
      })
    })

    act(() => {
      result.current.confirmProps.onCancel()
    })

    await waitFor(() => expect(resolved).toBe(false))
    expect(result.current.confirmProps.open).toBe(false)
  })

  it('confirm() passes through title and confirmLabel and variant', async () => {
    const { result } = renderHook(() => useConfirm())

    act(() => {
      void result.current.confirm({
        message: 'Delete this?',
        title: 'Delete Task',
        confirmLabel: 'Delete',
        variant: 'danger'
      })
    })

    expect(result.current.confirmProps.title).toBe('Delete Task')
    expect(result.current.confirmProps.confirmLabel).toBe('Delete')
    expect(result.current.confirmProps.variant).toBe('danger')

    act(() => {
      result.current.confirmProps.onCancel()
    })
  })
})
