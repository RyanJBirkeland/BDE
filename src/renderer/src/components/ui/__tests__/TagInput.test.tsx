import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TagInput } from '../TagInput'

describe('TagInput', () => {
  it('renders existing tags', () => {
    render(<TagInput tags={['foo', 'bar']} onChange={() => {}} />)
    expect(screen.getByText('foo')).toBeInTheDocument()
    expect(screen.getByText('bar')).toBeInTheDocument()
  })

  it('shows placeholder when no tags', () => {
    render(<TagInput tags={[]} onChange={() => {}} placeholder="Type here" />)
    expect(screen.getByPlaceholderText('Type here')).toBeInTheDocument()
  })

  it('hides placeholder when tags exist', () => {
    render(<TagInput tags={['tag']} onChange={() => {}} placeholder="Type here" />)
    expect(screen.getByLabelText('Add tag')).toHaveAttribute('placeholder', '')
  })

  it('adds tag on Enter', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['existing']} onChange={onChange} />)
    const input = screen.getByLabelText('Add tag')
    fireEvent.change(input, { target: { value: 'new-tag' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['existing', 'new-tag'])
  })

  it('does not add duplicate tags', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['existing']} onChange={onChange} />)
    const input = screen.getByLabelText('Add tag')
    fireEvent.change(input, { target: { value: 'existing' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not add empty tags', () => {
    const onChange = vi.fn()
    render(<TagInput tags={[]} onChange={onChange} />)
    const input = screen.getByLabelText('Add tag')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('removes last tag on Backspace when input is empty', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['a', 'b']} onChange={onChange} />)
    const input = screen.getByLabelText('Add tag')
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(onChange).toHaveBeenCalledWith(['a'])
  })

  it('respects maxTags limit', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['a', 'b']} onChange={onChange} maxTags={2} />)
    const input = screen.getByLabelText('Add tag')
    fireEvent.change(input, { target: { value: 'c' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables input when maxTags reached', () => {
    render(<TagInput tags={['a', 'b']} onChange={() => {}} maxTags={2} />)
    expect(screen.getByLabelText('Add tag')).toBeDisabled()
  })

  it('removes a specific tag via remove button', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['a', 'b', 'c']} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Remove b tag'))
    expect(onChange).toHaveBeenCalledWith(['a', 'c'])
  })
})
