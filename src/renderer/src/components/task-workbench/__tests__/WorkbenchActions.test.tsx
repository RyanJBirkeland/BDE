import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { WorkbenchActions } from '../WorkbenchActions'
import { useTaskWorkbenchStore } from '../../../stores/taskWorkbench'

describe('WorkbenchActions', () => {
  const defaultProps = {
    onSaveBacklog: vi.fn(),
    onQueueNow: vi.fn(),
    submitting: false
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useTaskWorkbenchStore.getState().resetForm()
  })

  it('renders save and queue buttons', () => {
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Save to Backlog')).toBeInTheDocument()
    expect(screen.getByText('Queue Now')).toBeInTheDocument()
  })

  it('Save to Backlog disabled when no title-present check passes', () => {
    // Default state: structuralChecks is empty, so titlePasses = false
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Save to Backlog')).toBeDisabled()
  })

  it('Queue Now enabled when structuralChecks is empty (every on empty = true)', () => {
    // noTier1Fails = [].every(...) = true, so canQueue is true
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).not.toBeDisabled()
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

  it('all buttons disabled when submitting=true', () => {
    useTaskWorkbenchStore.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} submitting={true} />)
    expect(screen.getByText('Save to Backlog')).toBeDisabled()
    expect(screen.getByText('Creating...')).toBeDisabled()
  })

  it('shows "Creating..." on Queue Now when submitting', () => {
    render(<WorkbenchActions {...defaultProps} submitting={true} />)
    expect(screen.getByText('Creating...')).toBeInTheDocument()
    expect(screen.queryByText('Queue Now')).not.toBeInTheDocument()
  })

  it('Queue Now enabled when advisory checks are warn status (test profile)', () => {
    useTaskWorkbenchStore.setState({
      specType: 'test',
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo-selected', label: 'Repo', tier: 1, status: 'pass', message: 'OK' },
        {
          id: 'spec-present',
          label: 'Spec',
          tier: 1,
          status: 'warn',
          message: 'Short spec (advisory)'
        },
        {
          id: 'spec-structure',
          label: 'Structure',
          tier: 1,
          status: 'warn',
          message: 'No headings (advisory)'
        }
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
