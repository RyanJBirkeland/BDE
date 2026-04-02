import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ReadinessChecks } from '../ReadinessChecks'
import { useTaskWorkbenchStore } from '../../../stores/taskWorkbench'

describe('ReadinessChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTaskWorkbenchStore.getState().resetForm()
  })

  it('renders nothing when there are no checks', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [],
      semanticChecks: [],
      operationalChecks: [],
    })
    const { container } = render(<ReadinessChecks />)
    expect(container.firstChild).toBeNull()
  })

  it('renders when checks are present', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      ],
    })
    render(<ReadinessChecks />)
    expect(screen.getByText('1/1 passing')).toBeInTheDocument()
  })

  it('displays correct pass count and total', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' },
      ],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'pass', message: 'Clear' },
      ],
    })
    render(<ReadinessChecks />)
    expect(screen.getByText('2/3 passing')).toBeInTheDocument()
  })

  it('shows pass icon for passing checks', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      ],
    })
    render(<ReadinessChecks />)
    const icon = screen.getByTitle('Title').querySelector('[aria-label="Passed"]')
    expect(icon).toBeInTheDocument()
  })

  it('shows fail icon for failing checks', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'repo', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' },
      ],
    })
    render(<ReadinessChecks />)
    const icon = screen.getByTitle('Repo').querySelector('[aria-label="Failed"]')
    expect(icon).toBeInTheDocument()
  })

  it('shows warn icon for warning checks', () => {
    useTaskWorkbenchStore.setState({
      semanticChecks: [
        { id: 'scope', label: 'Scope', tier: 2, status: 'warn', message: 'Vague' },
      ],
    })
    render(<ReadinessChecks />)
    const icon = screen.getByTitle('Scope').querySelector('[aria-label="Warning"]')
    expect(icon).toBeInTheDocument()
  })

  it('shows pending icon for pending checks', () => {
    useTaskWorkbenchStore.setState({
      operationalChecks: [
        { id: 'auth', label: 'Auth', tier: 3, status: 'pending', message: 'Checking...' },
      ],
    })
    render(<ReadinessChecks />)
    const icon = screen.getByTitle('Auth').querySelector('[aria-label="Pending"]')
    expect(icon).toBeInTheDocument()
  })

  it('displays all check icons in summary', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' },
      ],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'warn', message: 'Vague' },
      ],
    })
    render(<ReadinessChecks />)

    expect(screen.getByTitle('Title')).toBeInTheDocument()
    expect(screen.getByTitle('Repo')).toBeInTheDocument()
    expect(screen.getByTitle('Clarity')).toBeInTheDocument()
  })

  it('is collapsed by default', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      ],
      checksExpanded: false,
    })
    render(<ReadinessChecks />)

    expect(screen.queryByText('Title')).not.toBeInTheDocument()
    expect(screen.getByText('▸')).toBeInTheDocument()
  })

  it('expands when toggle button is clicked', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      ],
      checksExpanded: false,
    })
    render(<ReadinessChecks />)

    const toggleButton = screen.getByRole('button')
    fireEvent.click(toggleButton)

    expect(useTaskWorkbenchStore.getState().checksExpanded).toBe(true)
  })

  it('shows expanded icon when expanded', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      ],
      checksExpanded: true,
    })
    render(<ReadinessChecks />)

    expect(screen.getByText('▾')).toBeInTheDocument()
  })

  it('displays check details when expanded', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'Looks good' },
      ],
      checksExpanded: true,
    })
    render(<ReadinessChecks />)

    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Looks good')).toBeInTheDocument()
  })

  it('displays multiple check details when expanded', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo', label: 'Repo', tier: 1, status: 'fail', message: 'Required' },
      ],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'warn', message: 'Could be clearer' },
      ],
      checksExpanded: true,
    })
    render(<ReadinessChecks />)

    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.getByText('Repo')).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.getByText('Clarity')).toBeInTheDocument()
    expect(screen.getByText('Could be clearer')).toBeInTheDocument()
  })

  it('collapses when toggle button is clicked while expanded', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      ],
      checksExpanded: true,
    })
    render(<ReadinessChecks />)

    const toggleButton = screen.getByRole('button')
    fireEvent.click(toggleButton)

    expect(useTaskWorkbenchStore.getState().checksExpanded).toBe(false)
  })

  it('hides details when collapsed', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'Looks good' },
      ],
      checksExpanded: false,
    })
    render(<ReadinessChecks />)

    // Only icon should be present via title attribute, not the text "Title"
    expect(screen.queryByText('Title')).not.toBeInTheDocument()
    expect(screen.queryByText('Looks good')).not.toBeInTheDocument()
  })

  it('has danger border when there are failures', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'repo', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' },
      ],
    })
    const { container } = render(<ReadinessChecks />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('wb-checks--has-fail')
  })

  it('has normal border when no failures', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      ],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'warn', message: 'Vague' },
      ],
    })
    const { container } = render(<ReadinessChecks />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('wb-checks')
    expect(wrapper.className).not.toContain('wb-checks--has-fail')
  })

  it('combines all three check types', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      ],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'pass', message: 'Clear' },
      ],
      operationalChecks: [
        { id: 'auth', label: 'Auth', tier: 3, status: 'pass', message: 'Authenticated' },
      ],
    })
    render(<ReadinessChecks />)

    expect(screen.getByText('3/3 passing')).toBeInTheDocument()
  })

  it('maintains check order: structural, semantic, operational', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'struct-1', label: 'Struct', tier: 1, status: 'pass', message: 'A' },
      ],
      semanticChecks: [
        { id: 'sem-1', label: 'Semantic', tier: 2, status: 'pass', message: 'B' },
      ],
      operationalChecks: [
        { id: 'op-1', label: 'Operational', tier: 3, status: 'pass', message: 'C' },
      ],
      checksExpanded: true,
    })
    render(<ReadinessChecks />)

    const labels = screen.getAllByText(/Struct|Semantic|Operational/)
    expect(labels[0].textContent).toBe('Struct')
    expect(labels[1].textContent).toBe('Semantic')
    expect(labels[2].textContent).toBe('Operational')
  })

  it('handles empty check arrays gracefully', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      ],
      semanticChecks: [],
      operationalChecks: [],
    })
    render(<ReadinessChecks />)

    expect(screen.getByText('1/1 passing')).toBeInTheDocument()
  })
})
