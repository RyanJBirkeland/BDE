import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { renderHook, act } from '@testing-library/react'
import { useUnsavedDialog, UnsavedDialogModal } from '../UnsavedDialog'
import { ConfirmModal } from '../../ui/ConfirmModal'

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

vi.mock('../../../lib/motion', () => ({
  VARIANTS: { scaleIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: { duration: 0 },
  useReducedMotion: () => false
}))

describe('UnsavedDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('UnsavedDialogModal is the same as ConfirmModal', () => {
    expect(UnsavedDialogModal).toBe(ConfirmModal)
  })

  it('useUnsavedDialog returns confirmUnsaved function and confirmProps', () => {
    const { result } = renderHook(() => useUnsavedDialog())
    expect(typeof result.current.confirmUnsaved).toBe('function')
    expect(result.current.confirmProps).toBeDefined()
    expect(result.current.confirmProps.open).toBe(false)
    expect(result.current.confirmProps.message).toBe('')
  })

  it('confirmUnsaved opens the dialog with correct message', async () => {
    const { result } = renderHook(() => useUnsavedDialog())

    let confirmPromise: Promise<boolean>
    act(() => {
      confirmPromise = result.current.confirmUnsaved('app.tsx')
    })

    expect(result.current.confirmProps.open).toBe(true)
    expect(result.current.confirmProps.message).toBe('"app.tsx" has unsaved changes. Discard them?')
    expect(result.current.confirmProps.title).toBe('Unsaved changes')
    expect(result.current.confirmProps.confirmLabel).toBe('Discard')

    // Resolve by confirming
    act(() => {
      result.current.confirmProps.onConfirm()
    })

    expect(await confirmPromise!).toBe(true)
    expect(result.current.confirmProps.open).toBe(false)
  })

  it('confirmUnsaved resolves false on cancel', async () => {
    const { result } = renderHook(() => useUnsavedDialog())

    let confirmPromise: Promise<boolean>
    act(() => {
      confirmPromise = result.current.confirmUnsaved('styles.css')
    })

    expect(result.current.confirmProps.open).toBe(true)

    act(() => {
      result.current.confirmProps.onCancel()
    })

    expect(await confirmPromise!).toBe(false)
    expect(result.current.confirmProps.open).toBe(false)
  })

  it('renders modal with Discard button when open', () => {
    const { result } = renderHook(() => useUnsavedDialog())

    act(() => {
      result.current.confirmUnsaved('readme.md')
    })

    render(<ConfirmModal {...result.current.confirmProps} />)

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByText('"readme.md" has unsaved changes. Discard them?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('Escape key triggers cancel via the modal', () => {
    const { result } = renderHook(() => useUnsavedDialog())

    act(() => {
      result.current.confirmUnsaved('file.ts')
    })

    render(<ConfirmModal {...result.current.confirmProps} />)

    const dialog = screen.getByRole('alertdialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(result.current.confirmProps.open).toBe(false)
  })
})
