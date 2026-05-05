import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LiveAgentRow } from '../LiveAgentRow'

describe('LiveAgentRow', () => {
  it('renders the task title', () => {
    render(<LiveAgentRow title="Refactor login flow" onClick={vi.fn()} />)
    expect(screen.getByText('Refactor login flow')).toBeInTheDocument()
  })

  it('invokes onClick when the row is clicked', () => {
    const onClick = vi.fn()
    render(<LiveAgentRow title="Task" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('invokes onClick when Enter is pressed', () => {
    const onClick = vi.fn()
    render(<LiveAgentRow title="Task" onClick={onClick} />)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('invokes onClick when Space is pressed', () => {
    const onClick = vi.fn()
    render(<LiveAgentRow title="Task" onClick={onClick} />)
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not invoke onClick on unrelated keys', () => {
    const onClick = vi.fn()
    render(<LiveAgentRow title="Task" onClick={onClick} />)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Tab' })
    expect(onClick).not.toHaveBeenCalled()
  })
})
