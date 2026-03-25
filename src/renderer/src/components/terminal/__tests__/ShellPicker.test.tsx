import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShellPicker } from '../ShellPicker'

describe('ShellPicker', () => {
  const defaultProps = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all shell options', () => {
    render(<ShellPicker {...defaultProps} />)
    expect(screen.getByText('Default Shell')).toBeInTheDocument()
    expect(screen.getByText('zsh')).toBeInTheDocument()
    expect(screen.getByText('bash')).toBeInTheDocument()
    expect(screen.getByText('fish')).toBeInTheDocument()
    expect(screen.getByText('node')).toBeInTheDocument()
    expect(screen.getByText('python3')).toBeInTheDocument()
  })

  it('shows shortcut for Default Shell', () => {
    render(<ShellPicker {...defaultProps} />)
    expect(screen.getByText('⌘T')).toBeInTheDocument()
  })

  it('shows Custom button', () => {
    render(<ShellPicker {...defaultProps} />)
    expect(screen.getByText('Custom…')).toBeInTheDocument()
  })

  it('calls onSelect with empty string for Default Shell', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ShellPicker {...defaultProps} onSelect={onSelect} />)
    await user.click(screen.getByText('Default Shell'))
    expect(onSelect).toHaveBeenCalledWith('')
  })

  it('calls onSelect with shell path for zsh', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ShellPicker {...defaultProps} onSelect={onSelect} />)
    await user.click(screen.getByText('zsh'))
    expect(onSelect).toHaveBeenCalledWith('/bin/zsh')
  })

  it('calls onSelect with shell path for bash', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ShellPicker {...defaultProps} onSelect={onSelect} />)
    await user.click(screen.getByText('bash'))
    expect(onSelect).toHaveBeenCalledWith('/bin/bash')
  })

  it('calls onSelect with value for node', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ShellPicker {...defaultProps} onSelect={onSelect} />)
    await user.click(screen.getByText('node'))
    expect(onSelect).toHaveBeenCalledWith('node')
  })

  it('calls onClose on Escape key', () => {
    render(<ShellPicker {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('calls onClose on outside click', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <ShellPicker {...defaultProps} />
      </div>
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('does not call onClose on inside click', () => {
    render(<ShellPicker {...defaultProps} />)
    fireEvent.mouseDown(screen.getByText('zsh'))
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  it('shows custom input when Custom button is clicked', async () => {
    const user = userEvent.setup()
    render(<ShellPicker {...defaultProps} />)
    await user.click(screen.getByText('Custom…'))
    expect(screen.getByPlaceholderText('/path/to/shell')).toBeInTheDocument()
    // Custom button should be gone
    expect(screen.queryByText('Custom…')).not.toBeInTheDocument()
  })

  it('calls onSelect with custom value on Enter', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ShellPicker {...defaultProps} onSelect={onSelect} />)
    await user.click(screen.getByText('Custom…'))
    const input = screen.getByPlaceholderText('/path/to/shell')
    await user.type(input, '/usr/bin/custom{Enter}')
    expect(onSelect).toHaveBeenCalledWith('/usr/bin/custom')
  })

  it('does not call onSelect when custom value is empty on Enter', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ShellPicker {...defaultProps} onSelect={onSelect} />)
    await user.click(screen.getByText('Custom…'))
    const input = screen.getByPlaceholderText('/path/to/shell')
    await user.type(input, '{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not call onSelect when custom value is whitespace on Enter', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ShellPicker {...defaultProps} onSelect={onSelect} />)
    await user.click(screen.getByText('Custom…'))
    const input = screen.getByPlaceholderText('/path/to/shell')
    await user.type(input, '   {Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('hides custom input and resets value on Escape in custom input', async () => {
    const user = userEvent.setup()
    render(<ShellPicker {...defaultProps} />)
    await user.click(screen.getByText('Custom…'))
    const input = screen.getByPlaceholderText('/path/to/shell')
    await user.type(input, '/some/path')
    await user.type(input, '{Escape}')
    // Custom input should be gone, Custom button should be back
    expect(screen.queryByPlaceholderText('/path/to/shell')).not.toBeInTheDocument()
    expect(screen.getByText('Custom…')).toBeInTheDocument()
  })

  it('renders dividers between shell groups', () => {
    const { container } = render(<ShellPicker {...defaultProps} />)
    const dividers = container.querySelectorAll('.shell-picker__divider')
    // 2 dividers between 3 groups + 1 before custom section = 3
    expect(dividers.length).toBe(3)
  })

  it('applies header class to Default Shell item', () => {
    const { container } = render(<ShellPicker {...defaultProps} />)
    const headerItem = container.querySelector('.shell-picker__item--header')
    expect(headerItem).toBeInTheDocument()
    expect(headerItem?.textContent).toContain('Default Shell')
  })

  it('has shell-picker class on root element', () => {
    const { container } = render(<ShellPicker {...defaultProps} />)
    expect(container.querySelector('.shell-picker')).toBeInTheDocument()
  })
})
