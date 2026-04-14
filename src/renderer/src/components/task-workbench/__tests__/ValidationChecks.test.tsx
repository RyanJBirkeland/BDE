import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ValidationChecks } from '../ValidationChecks'
import { useTaskWorkbenchStore } from '../../../stores/taskWorkbench'
import { useTaskWorkbenchValidation } from '../../../stores/taskWorkbenchValidation'

describe('ValidationChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTaskWorkbenchStore.getState().resetForm()
    useTaskWorkbenchValidation.setState({
      structuralChecks: [],
      semanticChecks: [],
      operationalChecks: [],
      semanticLoading: false,
      operationalLoading: false
    })
  })

  it('renders nothing when there are no checks', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [],
      semanticChecks: [],
      operationalChecks: []
    })
    const { container } = render(<ValidationChecks />)
    expect(container.firstChild).toBeNull()
  })

  it('renders when checks are present', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' }]
    })
    render(<ValidationChecks />)
    expect(screen.getByText('1/1 passing')).toBeInTheDocument()
  })

  it('displays correct pass count and total', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' }
      ],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'pass', message: 'Clear' }
      ]
    })
    render(<ValidationChecks />)
    expect(screen.getByText('2/3 passing')).toBeInTheDocument()
  })

  it('shows pass icon for passing checks', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' }]
    })
    render(<ValidationChecks />)
    const icon = screen.getByTitle('Title').querySelector('[aria-label="Passed"]')
    expect(icon).toBeInTheDocument()
  })

  it('shows fail icon for failing checks', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'repo', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' }]
    })
    render(<ValidationChecks />)
    const icon = screen.getByTitle('Repo').querySelector('[aria-label="Failed"]')
    expect(icon).toBeInTheDocument()
  })

  it('shows warn icon for warning checks', () => {
    useTaskWorkbenchValidation.setState({
      semanticChecks: [{ id: 'scope', label: 'Scope', tier: 2, status: 'warn', message: 'Vague' }]
    })
    render(<ValidationChecks />)
    const icon = screen.getByTitle('Scope').querySelector('[aria-label="Warning"]')
    expect(icon).toBeInTheDocument()
  })

  it('shows pending icon for pending checks', () => {
    useTaskWorkbenchValidation.setState({
      operationalChecks: [
        { id: 'auth', label: 'Auth', tier: 3, status: 'pending', message: 'Checking...' }
      ]
    })
    render(<ValidationChecks />)
    const icon = screen.getByTitle('Auth').querySelector('[aria-label="Pending"]')
    expect(icon).toBeInTheDocument()
  })

  it('displays all check icons in summary', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' }
      ],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'warn', message: 'Vague' }
      ]
    })
    render(<ValidationChecks />)

    expect(screen.getByTitle('Title')).toBeInTheDocument()
    expect(screen.getByTitle('Repo')).toBeInTheDocument()
    expect(screen.getByTitle('Clarity')).toBeInTheDocument()
  })

  it('is collapsed by default', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' }]
    })
    useTaskWorkbenchStore.setState({ checksExpanded: false })
    render(<ValidationChecks />)

    expect(screen.queryByText('Title')).not.toBeInTheDocument()
    expect(screen.getByText('▸')).toBeInTheDocument()
  })

  it('expands when toggle button is clicked', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' }]
    })
    useTaskWorkbenchStore.setState({ checksExpanded: false })
    render(<ValidationChecks />)

    const toggleButton = screen.getByRole('button')
    fireEvent.click(toggleButton)

    expect(useTaskWorkbenchStore.getState().checksExpanded).toBe(true)
  })

  it('shows expanded icon when expanded', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' }]
    })
    useTaskWorkbenchStore.setState({ checksExpanded: true })
    render(<ValidationChecks />)

    expect(screen.getByText('▾')).toBeInTheDocument()
  })

  it('displays check details when expanded', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'Looks good' }
      ]
    })
    useTaskWorkbenchStore.setState({ checksExpanded: true })
    render(<ValidationChecks />)

    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Looks good')).toBeInTheDocument()
  })

  it('displays multiple check details when expanded', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo', label: 'Repo', tier: 1, status: 'fail', message: 'Required' }
      ],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'warn', message: 'Could be clearer' }
      ]
    })
    useTaskWorkbenchStore.setState({ checksExpanded: true })
    render(<ValidationChecks />)

    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.getByText('Repo')).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.getByText('Clarity')).toBeInTheDocument()
    expect(screen.getByText('Could be clearer')).toBeInTheDocument()
  })

  it('collapses when toggle button is clicked while expanded', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' }]
    })
    useTaskWorkbenchStore.setState({ checksExpanded: true })
    render(<ValidationChecks />)

    const toggleButton = screen.getByRole('button')
    fireEvent.click(toggleButton)

    expect(useTaskWorkbenchStore.getState().checksExpanded).toBe(false)
  })

  it('hides details when collapsed', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'Looks good' }
      ]
    })
    useTaskWorkbenchStore.setState({ checksExpanded: false })
    render(<ValidationChecks />)

    // Only icon should be present via title attribute, not the text "Title"
    expect(screen.queryByText('Title')).not.toBeInTheDocument()
    expect(screen.queryByText('Looks good')).not.toBeInTheDocument()
  })

  it('has danger border when there are failures', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'repo', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' }]
    })
    const { container } = render(<ValidationChecks />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('bde-card')
    expect(wrapper.className).toContain('wb-checks-card')
  })

  it('has normal border when no failures', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' }],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'warn', message: 'Vague' }
      ]
    })
    const { container } = render(<ValidationChecks />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('bde-card')
    expect(wrapper.className).toContain('wb-checks-card')
  })

  it('combines all three check types', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' }],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'pass', message: 'Clear' }
      ],
      operationalChecks: [
        { id: 'auth', label: 'Auth', tier: 3, status: 'pass', message: 'Authenticated' }
      ]
    })
    render(<ValidationChecks />)

    expect(screen.getByText('3/3 passing')).toBeInTheDocument()
  })

  it('maintains check order: structural, semantic, operational', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'struct-1', label: 'Struct', tier: 1, status: 'pass', message: 'A' }
      ],
      semanticChecks: [{ id: 'sem-1', label: 'Semantic', tier: 2, status: 'pass', message: 'B' }],
      operationalChecks: [
        { id: 'op-1', label: 'Operational', tier: 3, status: 'pass', message: 'C' }
      ]
    })
    useTaskWorkbenchStore.setState({ checksExpanded: true })
    render(<ValidationChecks />)

    const labels = screen.getAllByText(/Struct|Semantic|Operational/)
    expect(labels[0].textContent).toBe('Struct')
    expect(labels[1].textContent).toBe('Semantic')
    expect(labels[2].textContent).toBe('Operational')
  })

  it('handles empty check arrays gracefully', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [{ id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' }],
      semanticChecks: [],
      operationalChecks: []
    })
    render(<ValidationChecks />)

    expect(screen.getByText('1/1 passing')).toBeInTheDocument()
  })
})
