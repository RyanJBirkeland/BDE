import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../lib/github-api', () => ({}))

import { PRStationChecks } from '../PRStationChecks'

const checks = [
  { name: 'CI Build', status: 'completed', conclusion: 'success', html_url: 'https://github.com/checks/1' },
  { name: 'Lint', status: 'in_progress', conclusion: null, html_url: 'https://github.com/checks/2' },
  { name: 'Tests', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/checks/3' },
]

describe('PRStationChecks', () => {
  it('renders check names', () => {
    render(<PRStationChecks checks={checks} loading={false} />)
    expect(screen.getByText('CI Build')).toBeInTheDocument()
    expect(screen.getByText('Lint')).toBeInTheDocument()
    expect(screen.getByText('Tests')).toBeInTheDocument()
  })

  it('shows skeleton during loading', () => {
    const { container } = render(<PRStationChecks checks={[]} loading={true} />)
    expect(container.querySelector('.sprint-board__skeleton')).toBeTruthy()
  })

  it('shows empty state when no checks', () => {
    render(<PRStationChecks checks={[]} loading={false} />)
    expect(screen.getByText(/no check/i)).toBeInTheDocument()
  })
})
