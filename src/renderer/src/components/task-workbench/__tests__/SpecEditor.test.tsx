import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { SpecEditor } from '../SpecEditor'
import { useTaskWorkbenchStore } from '../../../stores/taskWorkbench'

describe('SpecEditor', () => {
  const defaultProps = {
    onRequestGenerate: vi.fn(),
    onRequestResearch: vi.fn(),
    generating: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useTaskWorkbenchStore.getState().resetForm()
  })

  it('renders the Generate Spec button', () => {
    render(<SpecEditor {...defaultProps} />)
    expect(screen.getByText('Generate Spec')).toBeInTheDocument()
  })

  it('renders template buttons', () => {
    render(<SpecEditor {...defaultProps} />)
    expect(screen.getByText('Feature')).toBeInTheDocument()
    expect(screen.getByText('Bug Fix')).toBeInTheDocument()
    expect(screen.getByText('Refactor')).toBeInTheDocument()
    expect(screen.getByText('Test')).toBeInTheDocument()
  })

  it('renders Research Codebase button', () => {
    render(<SpecEditor {...defaultProps} />)
    expect(screen.getByText('Research Codebase')).toBeInTheDocument()
  })

  it('renders textarea with placeholder', () => {
    render(<SpecEditor {...defaultProps} />)
    expect(screen.getByPlaceholderText(/Describe what the agent should do/)).toBeInTheDocument()
  })

  it('displays spec value from store', () => {
    useTaskWorkbenchStore.setState({ spec: 'My custom spec content' })
    render(<SpecEditor {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Describe what the agent should do/) as HTMLTextAreaElement
    expect(textarea.value).toBe('My custom spec content')
  })

  it('updates store when textarea value changes', () => {
    render(<SpecEditor {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Describe what the agent should do/)

    fireEvent.change(textarea, { target: { value: 'New spec text' } })

    expect(useTaskWorkbenchStore.getState().spec).toBe('New spec text')
  })

  it('calls onRequestGenerate when Generate Spec button is clicked', () => {
    render(<SpecEditor {...defaultProps} />)
    const button = screen.getByText('Generate Spec')

    fireEvent.click(button)

    expect(defaultProps.onRequestGenerate).toHaveBeenCalledTimes(1)
  })

  it('calls onRequestResearch when Research Codebase button is clicked', () => {
    render(<SpecEditor {...defaultProps} />)
    const button = screen.getByText('Research Codebase')

    fireEvent.click(button)

    expect(defaultProps.onRequestResearch).toHaveBeenCalledTimes(1)
  })

  it('disables Generate Spec button when generating', () => {
    render(<SpecEditor {...defaultProps} generating={true} />)
    const button = screen.getByText('Generating...')

    expect(button).toBeDisabled()
  })

  it('shows "Generating..." text when generating', () => {
    render(<SpecEditor {...defaultProps} generating={true} />)
    expect(screen.getByText('Generating...')).toBeInTheDocument()
    expect(screen.queryByText('Generate Spec')).not.toBeInTheDocument()
  })

  it('applies Feature template when Feature button is clicked', () => {
    render(<SpecEditor {...defaultProps} />)
    const button = screen.getByText('Feature')

    fireEvent.click(button)

    const spec = useTaskWorkbenchStore.getState().spec
    expect(spec).toContain('## Problem')
    expect(spec).toContain('## Solution')
    expect(spec).toContain('## Files to Change')
    expect(spec).toContain('## Out of Scope')
  })

  it('applies Bug Fix template when Bug Fix button is clicked', () => {
    render(<SpecEditor {...defaultProps} />)
    const button = screen.getByText('Bug Fix')

    fireEvent.click(button)

    const spec = useTaskWorkbenchStore.getState().spec
    expect(spec).toContain('## Bug Description')
    expect(spec).toContain('## Root Cause')
    expect(spec).toContain('## Fix')
    expect(spec).toContain('## Files to Change')
    expect(spec).toContain('## How to Test')
  })

  it('applies Refactor template when Refactor button is clicked', () => {
    render(<SpecEditor {...defaultProps} />)
    const button = screen.getByText('Refactor')

    fireEvent.click(button)

    const spec = useTaskWorkbenchStore.getState().spec
    expect(spec).toContain("## What's Being Refactored")
    expect(spec).toContain('## Target State')
    expect(spec).toContain('## Files to Change')
    expect(spec).toContain('## Out of Scope')
  })

  it('applies Test template when Test button is clicked', () => {
    render(<SpecEditor {...defaultProps} />)
    const button = screen.getByText('Test')

    fireEvent.click(button)

    const spec = useTaskWorkbenchStore.getState().spec
    expect(spec).toContain('## What to Test')
    expect(spec).toContain('## Test Strategy')
    expect(spec).toContain('## Files to Create')
    expect(spec).toContain('## Coverage Target')
  })

  it('overwrites existing spec when template is applied', () => {
    useTaskWorkbenchStore.setState({ spec: 'Existing content' })
    render(<SpecEditor {...defaultProps} />)

    const button = screen.getByText('Feature')
    fireEvent.click(button)

    const spec = useTaskWorkbenchStore.getState().spec
    expect(spec).not.toContain('Existing content')
    expect(spec).toContain('## Problem')
  })

  it('handles Tab key to insert spaces', () => {
    render(<SpecEditor {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Describe what the agent should do/) as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: 'Line 1' } })
    textarea.setSelectionRange(6, 6) // At end
    fireEvent.keyDown(textarea, { key: 'Tab' })

    expect(useTaskWorkbenchStore.getState().spec).toBe('Line 1  ')
  })

  it('inserts two spaces at cursor position on Tab', () => {
    useTaskWorkbenchStore.setState({ spec: 'Hello World' })
    render(<SpecEditor {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Describe what the agent should do/) as HTMLTextAreaElement

    textarea.setSelectionRange(5, 5) // After "Hello"
    fireEvent.keyDown(textarea, { key: 'Tab' })

    expect(useTaskWorkbenchStore.getState().spec).toBe('Hello   World')
  })

  it('replaces selection with spaces on Tab', () => {
    useTaskWorkbenchStore.setState({ spec: 'Hello World' })
    render(<SpecEditor {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Describe what the agent should do/) as HTMLTextAreaElement

    textarea.setSelectionRange(0, 5) // Select "Hello"
    fireEvent.keyDown(textarea, { key: 'Tab' })

    expect(useTaskWorkbenchStore.getState().spec).toBe('   World')
  })

  it('handles Tab key to insert spaces instead of default behavior', () => {
    useTaskWorkbenchStore.setState({ spec: 'Test' })
    render(<SpecEditor {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Describe what the agent should do/) as HTMLTextAreaElement

    textarea.setSelectionRange(4, 4) // At end
    fireEvent.keyDown(textarea, { key: 'Tab', preventDefault: () => {} })

    // Tab handler should insert two spaces
    expect(useTaskWorkbenchStore.getState().spec).toBe('Test  ')
  })

  it('does not call onRequestGenerate when disabled', () => {
    render(<SpecEditor {...defaultProps} generating={true} />)
    const button = screen.getByText('Generating...')

    fireEvent.click(button)

    // Should not be called because button is disabled
    expect(defaultProps.onRequestGenerate).not.toHaveBeenCalled()
  })

  it('has correct styling for Generate Spec button', () => {
    render(<SpecEditor {...defaultProps} />)
    const button = screen.getByText('Generate Spec')

    expect(button.className).toContain('wb-spec__btn--primary')
  })

  it('has disabled state when generating', () => {
    render(<SpecEditor {...defaultProps} generating={true} />)
    const button = screen.getByText('Generating...')

    expect(button).toBeDisabled()
  })

  it('maintains textarea value through re-renders', () => {
    const { rerender } = render(<SpecEditor {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Describe what the agent should do/)

    fireEvent.change(textarea, { target: { value: 'Persistent value' } })

    rerender(<SpecEditor {...defaultProps} generating={true} />)

    expect((textarea as HTMLTextAreaElement).value).toBe('Persistent value')
  })

  it('handles empty spec gracefully', () => {
    useTaskWorkbenchStore.setState({ spec: '' })
    render(<SpecEditor {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Describe what the agent should do/) as HTMLTextAreaElement

    expect(textarea.value).toBe('')
  })

  it('renders all four template buttons in order', () => {
    render(<SpecEditor {...defaultProps} />)
    const buttons = screen.getAllByRole('button')
    const templateButtons = buttons.filter(b =>
      ['Feature', 'Bug Fix', 'Refactor', 'Test'].includes(b.textContent || '')
    )

    expect(templateButtons).toHaveLength(4)
    expect(templateButtons[0].textContent).toBe('Feature')
    expect(templateButtons[1].textContent).toBe('Bug Fix')
    expect(templateButtons[2].textContent).toBe('Refactor')
    expect(templateButtons[3].textContent).toBe('Test')
  })

  it('updates cursor position after Tab insertion', async () => {
    useTaskWorkbenchStore.setState({ spec: 'Test' })
    render(<SpecEditor {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Describe what the agent should do/) as HTMLTextAreaElement

    textarea.setSelectionRange(2, 2) // After "Te"
    fireEvent.keyDown(textarea, { key: 'Tab' })

    // The cursor position update happens in requestAnimationFrame
    await new Promise(resolve => requestAnimationFrame(resolve))

    expect(textarea.selectionStart).toBe(4)
    expect(textarea.selectionEnd).toBe(4)
  })
})
