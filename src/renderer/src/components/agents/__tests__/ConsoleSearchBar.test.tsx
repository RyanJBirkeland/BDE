import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConsoleSearchBar } from '../ConsoleSearchBar'

describe('ConsoleSearchBar', () => {
  it('renders search input', () => {
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={vi.fn()}
        matchCount={0}
        activeMatch={0}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />
    )
    const input = screen.getByPlaceholderText('Search console output...')
    expect(input).toBeInTheDocument()
  })

  it('auto-focuses input on mount', () => {
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={vi.fn()}
        matchCount={0}
        activeMatch={0}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />
    )
    const input = screen.getByPlaceholderText('Search console output...')
    expect(input).toHaveFocus()
  })

  it('calls onSearch when typing', async () => {
    const onSearch = vi.fn()
    render(
      <ConsoleSearchBar
        onSearch={onSearch}
        onClose={vi.fn()}
        matchCount={0}
        activeMatch={0}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />
    )
    const input = screen.getByPlaceholderText('Search console output...')
    await userEvent.type(input, 'test query')
    expect(onSearch).toHaveBeenCalled()
  })

  it('shows match count when matches exist', () => {
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={vi.fn()}
        matchCount={5}
        activeMatch={3}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />
    )
    expect(screen.getByText('3 of 5')).toBeInTheDocument()
  })

  it('does not show match count when no matches', () => {
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={vi.fn()}
        matchCount={0}
        activeMatch={0}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />
    )
    expect(screen.queryByText(/of/)).not.toBeInTheDocument()
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={onClose}
        matchCount={0}
        activeMatch={0}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />
    )
    const input = screen.getByPlaceholderText('Search console output...')
    await userEvent.type(input, '{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onNext when Enter is pressed', async () => {
    const onNext = vi.fn()
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={vi.fn()}
        matchCount={5}
        activeMatch={1}
        onNext={onNext}
        onPrev={vi.fn()}
      />
    )
    const input = screen.getByPlaceholderText('Search console output...')
    await userEvent.type(input, '{Enter}')
    expect(onNext).toHaveBeenCalled()
  })

  it('calls onPrev when Shift+Enter is pressed', async () => {
    const onPrev = vi.fn()
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={vi.fn()}
        matchCount={5}
        activeMatch={2}
        onNext={vi.fn()}
        onPrev={onPrev}
      />
    )
    const input = screen.getByPlaceholderText('Search console output...')
    await userEvent.type(input, '{Shift>}{Enter}{/Shift}')
    expect(onPrev).toHaveBeenCalled()
  })

  it('calls onNext when next button is clicked', async () => {
    const onNext = vi.fn()
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={vi.fn()}
        matchCount={5}
        activeMatch={1}
        onNext={onNext}
        onPrev={vi.fn()}
      />
    )
    const nextBtn = screen.getByLabelText('Next match')
    await userEvent.click(nextBtn)
    expect(onNext).toHaveBeenCalled()
  })

  it('calls onPrev when previous button is clicked', async () => {
    const onPrev = vi.fn()
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={vi.fn()}
        matchCount={5}
        activeMatch={2}
        onNext={vi.fn()}
        onPrev={onPrev}
      />
    )
    const prevBtn = screen.getByLabelText('Previous match')
    await userEvent.click(prevBtn)
    expect(onPrev).toHaveBeenCalled()
  })

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={onClose}
        matchCount={0}
        activeMatch={0}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />
    )
    const closeBtn = screen.getByLabelText('Close search')
    await userEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('disables navigation buttons when no matches', () => {
    render(
      <ConsoleSearchBar
        onSearch={vi.fn()}
        onClose={vi.fn()}
        matchCount={0}
        activeMatch={0}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />
    )
    const nextBtn = screen.getByLabelText('Next match')
    const prevBtn = screen.getByLabelText('Previous match')
    expect(nextBtn).toBeDisabled()
    expect(prevBtn).toBeDisabled()
  })
})
