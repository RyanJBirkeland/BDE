import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditableField } from '../EditableField'

function renderField(props: {
  value?: string
  onSave?: (v: string) => Promise<void>
  multiline?: boolean
  placeholder?: string
}): void {
  const { value = 'hello', onSave = vi.fn().mockResolvedValue(undefined), multiline, placeholder } =
    props
  render(
    <EditableField value={value} onSave={onSave} multiline={multiline} placeholder={placeholder} />
  )
}

describe('EditableField — single-line', () => {
  it('click enters edit mode', () => {
    renderField({})
    fireEvent.click(screen.getByText('hello'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('Enter commits and calls onSave with the current draft', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EditableField value="hello" onSave={onSave} />)
    fireEvent.click(screen.getByText('hello'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'world' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('world'))
  })

  it('Escape cancels without saving', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EditableField value="hello" onSave={onSave} />)
    fireEvent.click(screen.getByText('hello'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'changed' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('blur commits the draft', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EditableField value="hello" onSave={onSave} />)
    fireEvent.click(screen.getByText('hello'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'updated' } })
    fireEvent.blur(input)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('updated'))
  })

  it('does NOT call onSave when the value is unchanged on blur', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EditableField value="hello" onSave={onSave} />)
    fireEvent.click(screen.getByText('hello'))
    const input = screen.getByRole('textbox')
    // No change — blur immediately
    fireEvent.blur(input)
    // Allow any pending microtasks to settle, then confirm onSave was never invoked
    await Promise.resolve()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('EditableField — multiline', () => {
  it('click enters edit mode (textarea)', () => {
    render(
      <EditableField value="some text" onSave={vi.fn().mockResolvedValue(undefined)} multiline />
    )
    fireEvent.click(screen.getByText('some text'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('Escape cancels without saving', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EditableField value="original" onSave={onSave} multiline />)
    fireEvent.click(screen.getByText('original'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'edited' } })
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('original')).toBeInTheDocument()
  })

  it('blur commits the draft', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EditableField value="first" onSave={onSave} multiline />)
    fireEvent.click(screen.getByText('first'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'second' } })
    fireEvent.blur(textarea)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('second'))
  })

  it('shows placeholder when value is empty', () => {
    render(
      <EditableField
        value=""
        onSave={vi.fn().mockResolvedValue(undefined)}
        multiline
        placeholder="Add a goal…"
      />
    )
    expect(screen.getByText('Add a goal…')).toBeInTheDocument()
  })
})
