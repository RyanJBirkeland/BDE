import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from '../Input'

describe('Input', () => {
  it('renders with value', () => {
    render(<Input value="hello" onChange={() => {}} />)
    expect(screen.getByRole('textbox')).toHaveValue('hello')
  })

  it('calls onChange when typing', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Input value="" onChange={onChange} />)

    await user.type(screen.getByRole('textbox'), 'a')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('renders placeholder', () => {
    render(<Input value="" onChange={() => {}} placeholder="Search..." />)
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })

  it('is disabled when disabled prop is true', () => {
    render(<Input value="" onChange={() => {}} disabled />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('renders prefix when provided', () => {
    const { container } = render(<Input value="" onChange={() => {}} prefix={<span>$</span>} />)
    expect(container.querySelector('.bde-input__prefix')).toBeInTheDocument()
    expect(container.querySelector('.bde-input--has-prefix')).toBeInTheDocument()
  })

  it('renders suffix when provided', () => {
    const { container } = render(<Input value="" onChange={() => {}} suffix={<span>kg</span>} />)
    expect(container.querySelector('.bde-input__suffix')).toBeInTheDocument()
    expect(container.querySelector('.bde-input--has-suffix')).toBeInTheDocument()
  })
})
