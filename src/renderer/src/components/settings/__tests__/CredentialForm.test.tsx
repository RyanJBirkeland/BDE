/**
 * CredentialForm — field rendering, password toggle, and save callback tests.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CredentialForm, type CredentialField } from '../CredentialForm'

const TOKEN_FIELDS: CredentialField[] = [
  { key: 'token', label: 'API Token', type: 'token', placeholder: 'sk-...', savedPlaceholder: 'Token saved' },
]

const URL_FIELDS: CredentialField[] = [
  { key: 'url', label: 'Service URL', type: 'url', placeholder: 'https://...' },
]

const defaultProps = {
  title: 'Test Service',
  fields: TOKEN_FIELDS,
  values: { token: '' },
  hasExisting: { token: false },
  onChange: vi.fn(),
  onSave: vi.fn().mockResolvedValue(undefined),
  dirty: false,
}

describe('CredentialForm', () => {
  it('renders title and field labels', () => {
    render(<CredentialForm {...defaultProps} />)
    expect(screen.getByText('Test Service')).toBeInTheDocument()
    expect(screen.getByText('API Token')).toBeInTheDocument()
  })

  it('renders token field as password input by default', () => {
    render(<CredentialForm {...defaultProps} />)
    const input = screen.getByPlaceholderText('sk-...')
    expect(input).toHaveAttribute('type', 'password')
  })

  it('toggles token field to text type when eye button is clicked', async () => {
    const user = userEvent.setup()
    render(<CredentialForm {...defaultProps} />)
    const input = screen.getByPlaceholderText('sk-...')
    expect(input).toHaveAttribute('type', 'password')
    await user.click(screen.getByTitle('Show'))
    expect(input).toHaveAttribute('type', 'text')
  })

  it('toggles back to password when eye button is clicked again', async () => {
    const user = userEvent.setup()
    render(<CredentialForm {...defaultProps} />)
    const input = screen.getByPlaceholderText('sk-...')
    await user.click(screen.getByTitle('Show'))
    expect(input).toHaveAttribute('type', 'text')
    await user.click(screen.getByTitle('Hide'))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('renders saved placeholder when hasExisting is true', () => {
    render(<CredentialForm {...defaultProps} hasExisting={{ token: true }} />)
    expect(screen.getByPlaceholderText('Token saved')).toBeInTheDocument()
  })

  it('calls onSave when Save button is clicked', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<CredentialForm {...defaultProps} dirty={true} saveDisabled={false} onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalled()
  })

  it('renders Save button as disabled when saveDisabled is true', () => {
    render(<CredentialForm {...defaultProps} saveDisabled={true} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('renders Test button when onTest is provided', () => {
    render(<CredentialForm {...defaultProps} onTest={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument()
  })

  it('does not render Test button when onTest is not provided', () => {
    render(<CredentialForm {...defaultProps} />)
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument()
  })

  it('renders URL field as text input', () => {
    render(<CredentialForm {...defaultProps} fields={URL_FIELDS} values={{ url: '' }} hasExisting={{ url: false }} />)
    const input = screen.getByPlaceholderText('https://...')
    expect(input).toHaveAttribute('type', 'text')
  })

  it('calls onChange when typing in a field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CredentialForm {...defaultProps} onChange={onChange} />)
    const input = screen.getByPlaceholderText('sk-...')
    await user.type(input, 'abc')
    expect(onChange).toHaveBeenCalledWith('token', expect.any(String))
  })

  it('shows test result badge on success', () => {
    render(
      <CredentialForm
        {...defaultProps}
        onTest={vi.fn().mockResolvedValue(undefined)}
        testResult="success"
      />
    )
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  it('shows test result badge on error', () => {
    render(
      <CredentialForm
        {...defaultProps}
        onTest={vi.fn().mockResolvedValue(undefined)}
        testResult="error"
      />
    )
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })
})
