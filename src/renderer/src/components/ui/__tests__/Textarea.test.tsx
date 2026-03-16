import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Textarea } from '../Textarea'

describe('Textarea', () => {
  it('renders with value', () => {
    render(<Textarea value="hello" onChange={() => {}} />)
    expect(screen.getByRole('textbox')).toHaveValue('hello')
  })

  it('calls onChange when typing', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Textarea value="" onChange={onChange} />)

    await user.type(screen.getByRole('textbox'), 'a')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('renders placeholder', () => {
    render(<Textarea value="" onChange={() => {}} placeholder="Write..." />)
    expect(screen.getByPlaceholderText('Write...')).toBeInTheDocument()
  })

  it('is disabled when disabled prop is true', () => {
    render(<Textarea value="" onChange={() => {}} disabled />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('passes onKeyDown to textarea', async () => {
    const onKeyDown = vi.fn()
    const user = userEvent.setup()
    render(<Textarea value="" onChange={() => {}} onKeyDown={onKeyDown} />)

    await user.type(screen.getByRole('textbox'), '{Enter}')
    expect(onKeyDown).toHaveBeenCalled()
  })

  it('renders as a textbox element', () => {
    render(<Textarea value="" onChange={() => {}} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})
