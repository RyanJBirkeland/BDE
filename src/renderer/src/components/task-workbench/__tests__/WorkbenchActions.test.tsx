import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { WorkbenchActions } from '../WorkbenchActions'
import { useTaskWorkbenchStore } from '../../../stores/taskWorkbench'
import { useTaskWorkbenchValidation } from '../../../stores/taskWorkbenchValidation'

// 50+ character spec to satisfy minimum length validation
const VALID_SPEC = 'This is a valid spec with enough content to pass the fifty character minimum.'

describe('WorkbenchActions', () => {
  const defaultProps = {
    onSaveBacklog: vi.fn(),
    onQueueNow: vi.fn(),
    submitting: false
  }

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

  it('Queue Now disabled when spec is too short (default empty state)', () => {
    // Default spec is empty string — must be at least 50 chars to queue
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).toBeDisabled()
  })

  it('Queue Now disabled when repo is empty', () => {
    useTaskWorkbenchStore.setState({ repo: '', spec: VALID_SPEC })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).toBeDisabled()
  })

  it('all buttons disabled when structural checks have failures', () => {
    useTaskWorkbenchValidation.setState({
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
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo-selected', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Save to Backlog')).not.toBeDisabled()
  })

  it('Queue Now disabled when not all tier 1 pass', () => {
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo-selected', label: 'Repo', tier: 1, status: 'fail', message: 'Missing' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).toBeDisabled()
  })

  it('Queue Now enabled when all tier 1 pass, no tier 3 fails, repo set, and spec long enough', () => {
    useTaskWorkbenchStore.setState({ repo: 'FLEET', spec: VALID_SPEC })
    useTaskWorkbenchValidation.setState({
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
    useTaskWorkbenchValidation.setState({
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
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    fireEvent.click(screen.getByText('Save to Backlog'))
    expect(defaultProps.onSaveBacklog).toHaveBeenCalledTimes(1)
  })

  it('calls onQueueNow when Queue Now clicked', () => {
    useTaskWorkbenchStore.setState({ repo: 'FLEET', spec: VALID_SPEC })
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    fireEvent.click(screen.getByText('Queue Now'))
    expect(defaultProps.onQueueNow).toHaveBeenCalledTimes(1)
  })

  it('all buttons disabled when submitting=true', () => {
    useTaskWorkbenchValidation.setState({
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
    useTaskWorkbenchStore.setState({ repo: 'FLEET', spec: VALID_SPEC, specType: 'test' })
    useTaskWorkbenchValidation.setState({
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
    useTaskWorkbenchStore.setState({ specType: 'feature' })
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
        { id: 'repo-selected', label: 'Repo', tier: 1, status: 'pass', message: 'OK' },
        { id: 'spec-present', label: 'Spec', tier: 1, status: 'fail', message: 'Too short' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Queue Now')).toBeDisabled()
  })

  it('shows hint when spec is too short', () => {
    useTaskWorkbenchStore.setState({ repo: 'FLEET', spec: 'too short' })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Spec must be at least 50 characters')).toBeInTheDocument()
  })

  it('shows hint when repo is empty', () => {
    useTaskWorkbenchStore.setState({ repo: '', spec: VALID_SPEC })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.getByText('Select a repository')).toBeInTheDocument()
  })

  it('shows no hint when all validations pass', () => {
    useTaskWorkbenchStore.setState({ repo: 'FLEET', spec: VALID_SPEC })
    useTaskWorkbenchValidation.setState({
      structuralChecks: [
        { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' }
      ]
    })
    render(<WorkbenchActions {...defaultProps} />)
    expect(screen.queryByText('Spec must be at least 50 characters')).not.toBeInTheDocument()
    expect(screen.queryByText('Select a repository')).not.toBeInTheDocument()
  })
})
