import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, className, onClick, style, ...rest }: any) => (
      <div className={className} onClick={onClick} style={style} {...rest}>
        {children}
      </div>
    )
  }
}))

import { SpecPanel } from '../SpecPanel'

function makeProps(overrides: Partial<Parameters<typeof SpecPanel>[0]> = {}) {
  return {
    taskTitle: 'My Task Title',
    spec: 'Initial spec content\nLine two',
    onClose: vi.fn(),
    onSave: vi.fn(),
    ...overrides
  }
}

describe('SpecPanel', () => {
  it('renders task title in header', () => {
    render(<SpecPanel {...makeProps()} />)
    expect(screen.getByText('Spec — My Task Title')).toBeInTheDocument()
  })

  it('renders spec content', () => {
    render(<SpecPanel {...makeProps()} />)
    expect(screen.getByText(/Initial spec content/)).toBeInTheDocument()
  })

  it('calls onClose when backdrop clicked', () => {
    const props = makeProps()
    render(<SpecPanel {...props} />)
    const overlay = document.querySelector('.spec-panel-overlay')
    expect(overlay).toBeTruthy()
    fireEvent.click(overlay!)
    expect(props.onClose).toHaveBeenCalled()
  })

  it('calls onClose when X button clicked', () => {
    const props = makeProps()
    render(<SpecPanel {...props} />)
    fireEvent.click(screen.getByText('×'))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('enters edit mode when Edit button clicked — shows textarea', () => {
    render(<SpecPanel {...makeProps()} />)
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('Initial spec content\nLine two')
  })

  it('calls onSave with edited content when Save clicked', () => {
    const props = makeProps()
    render(<SpecPanel {...props} />)
    fireEvent.click(screen.getByText('Edit'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Updated spec content' } })
    fireEvent.click(screen.getByText('Save'))
    expect(props.onSave).toHaveBeenCalledWith('Updated spec content')
  })

  it('reverts to original spec when Cancel clicked in edit mode', () => {
    render(<SpecPanel {...makeProps()} />)
    fireEvent.click(screen.getByText('Edit'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Changed text' } })
    fireEvent.click(screen.getByText('Cancel'))
    // Should exit edit mode and show original spec
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText(/Initial spec content/)).toBeInTheDocument()
  })

  it('overlay has dialog role and aria-modal', () => {
    render(<SpecPanel {...makeProps()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'Spec — My Task Title')
  })
})
