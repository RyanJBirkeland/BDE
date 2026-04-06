import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../lib/motion', () => ({
  VARIANTS: { fadeIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: {},
  useReducedMotion: () => false
}))

import { TextareaPromptModal } from '../TextareaPromptModal'

describe('TextareaPromptModal', () => {
  const defaultProps = {
    open: true,
    message: 'Enter revision notes',
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  }

  it('renders nothing when closed', () => {
    const { container } = render(<TextareaPromptModal {...defaultProps} open={false} />)
    // Modal is not visible when closed (AnimatePresence handles exit)
    expect(container).toBeTruthy()
  })

  it('renders modal content when open', () => {
    render(<TextareaPromptModal {...defaultProps} />)
    expect(screen.getByText('Enter revision notes')).toBeInTheDocument()
  })

  it('renders confirm and cancel buttons', () => {
    render(<TextareaPromptModal {...defaultProps} />)
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('uses custom labels', () => {
    render(
      <TextareaPromptModal
        {...defaultProps}
        confirmLabel="Submit"
        cancelLabel="Discard"
      />
    )
    expect(screen.getByText('Submit')).toBeInTheDocument()
    expect(screen.getByText('Discard')).toBeInTheDocument()
  })

  it('renders title when provided', () => {
    render(<TextareaPromptModal {...defaultProps} title="Revision Request" />)
    expect(screen.getByText('Revision Request')).toBeInTheDocument()
  })

  it('calls onCancel when Cancel clicked', () => {
    render(<TextareaPromptModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(defaultProps.onCancel).toHaveBeenCalled()
  })

  it('renders textarea with placeholder', () => {
    render(<TextareaPromptModal {...defaultProps} placeholder="Enter notes..." />)
    const textarea = screen.getByPlaceholderText('Enter notes...')
    expect(textarea).toBeInTheDocument()
  })

  it('calls onConfirm with text when OK clicked', () => {
    render(<TextareaPromptModal {...defaultProps} defaultValue="My notes" />)
    fireEvent.click(screen.getByText('OK'))
    expect(defaultProps.onConfirm).toHaveBeenCalledWith('My notes')
  })
})
