import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { WorkbenchActions } from '../WorkbenchActions'
import { useTaskWorkbenchStore } from '../../../stores/taskWorkbench'

describe('WorkbenchActions', () => {
  const defaultProps = {
    onSaveBacklog: vi.fn(),
    onQueueNow: vi.fn(),
    onLaunch: vi.fn(),
    submitting: false
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useTaskWorkbenchStore.getState().resetForm()
  })

  it('renders all three buttons', () => {
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Save to Backlog')).toBeInTheDocument()
    expect(screen.getByText('Queue Now')).toBeInTheDocument()
    expect(screen.getByText('Launch')).toBeInTheDocument()
  })

  it('Save to Backlog disabled when no title-present check passes', () => {
    // Default state: structuralChecks is empty, so titlePasses = false
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Save to Backlog')).toBeDisabled()
  })

  it('Queue Now and Launch enabled when structuralChecks is empty (every on empty = true)', () => {
    // allTier1Pass = [].every(...) = true, so canQueue and canLaunch are true
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).not.toBeDisabled()
    expect(screen.getByText('Launch')).not.toBeDisabled()
  })

  it('all buttons disabled when structural checks have failures', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'fail', message: 'Missing' },
        { id: 'repo-selected', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Save to Backlog')).toBeDisabled()
    expect(screen.getByText('Queue Now')).toBeDisabled()
    expect(screen.getByText('Launch')).toBeDisabled()
  })

  it('Save to Backlog enabled when title check passes', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo-selected', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Save to Backlog')).not.toBeDisabled()
  })

  it('Queue Now disabled when not all tier 1 pass', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo-selected', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).toBeDisabled()
  })

  it('Queue Now enabled when all tier 1 pass and no tier 3 fails', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo-selected', label: 'Repo', tier: 1, status: 'pass', message: 'OK' }
      ],
      operationalChecks: []
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).not.toBeDisabled()
  })

  it('Queue Now disabled when tier 3 has fails', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ],
      operationalChecks: [
        { id: 'auth', label: 'Auth', tier: 3, status: 'fail', message: 'No auth' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).toBeDisabled()
  })

  it('Launch enabled when all tier 1 pass and no semantic fails and no tier 3 fails', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ],
      semanticChecks: [{ id: 'clarity', label: 'Clarity', tier: 2, status: 'pass', message: 'OK' }],
      operationalChecks: []
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Launch')).not.toBeDisabled()
  })

  it('Launch disabled when semantic checks have fails', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'fail', message: 'Unclear' }
      ],
      operationalChecks: []
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Launch')).toBeDisabled()
  })

  it('Launch allowed when semantic checks have warnings (not fails)', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ],
      semanticChecks: [
        { id: 'clarity', label: 'Clarity', tier: 2, status: 'warn', message: 'Vague' }
      ],
      operationalChecks: []
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Launch')).not.toBeDisabled()
  })

  it('Launch enabled when semantic checks are empty', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ],
      semanticChecks: [],
      operationalChecks: []
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Launch')).not.toBeDisabled()
  })

  it('calls onSaveBacklog when Save to Backlog clicked', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    fireEvent.click(screen.getByText('Save to Backlog'))
    expect(defaultProps.onSaveBacklog).toHaveBeenCalledTimes(1)
  })

  it('calls onQueueNow when Queue Now clicked', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    fireEvent.click(screen.getByText('Queue Now'))
    expect(defaultProps.onQueueNow).toHaveBeenCalledTimes(1)
  })

  it('calls onLaunch when Launch clicked', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    fireEvent.click(screen.getByText('Launch'))
    expect(defaultProps.onLaunch).toHaveBeenCalledTimes(1)
  })

  it('all buttons disabled when submitting=true', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} submitting={true} />)
    expect(screen.getByText('Save to Backlog')).toBeDisabled()
    expect(screen.getByText('Creating...')).toBeDisabled()
    expect(screen.getByText('Launching...')).toBeDisabled()
  })

  it('shows "Creating..." on Queue Now when submitting', () => {
    render(<WorkbenchActions {...defaultProps} submitting={true} />)
    expect(screen.getByText('Creating...')).toBeInTheDocument()
    expect(screen.queryByText('Queue Now')).not.toBeInTheDocument()
  })

  it('shows "Launching..." on Launch when submitting', () => {
    render(<WorkbenchActions {...defaultProps} submitting={true} />)
    expect(screen.getByText('Launching...')).toBeInTheDocument()
    expect(screen.queryByText('Launch')).not.toBeInTheDocument()
  })

  it('Launch disabled when tier 3 operational check fails even if tier 1 passes', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ],
      semanticChecks: [],
      operationalChecks: [
        { id: 'slots', label: 'Agent Slots', tier: 3, status: 'fail', message: 'No slots' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Launch')).toBeDisabled()
  })

  it('Queue Now enabled when advisory checks are warn status (test profile)', () => {
    useTaskWorkbenchStore.setState({
      specType: 'test',
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo-selected', label: 'Repo', tier: 1, status: 'pass', message: 'OK' },
        { id: 'spec-present', label: 'Spec', tier: 1, status: 'warn', message: 'Short spec (advisory)' },
        { id: 'spec-structure', label: 'Structure', tier: 1, status: 'warn', message: 'No headings (advisory)' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).not.toBeDisabled()
  })

  it('Queue Now disabled when required checks fail (feature profile)', () => {
    useTaskWorkbenchStore.setState({
      specType: 'feature',
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo-selected', label: 'Repo', tier: 1, status: 'pass', message: 'OK' },
        { id: 'spec-present', label: 'Spec', tier: 1, status: 'fail', message: 'Too short' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).toBeDisabled()
  })
})
