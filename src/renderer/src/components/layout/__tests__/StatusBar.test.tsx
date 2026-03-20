import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar } from '../StatusBar'

describe('StatusBar', () => {
  it('shows Gateway when status is connected', () => {
    render(<StatusBar status="connected" sessionCount={0} model="sonnet" onReconnect={() => {}} />)
    expect(screen.getByText('Gateway')).toBeInTheDocument()
  })

  it('shows Disconnected when status is disconnected', () => {
    render(<StatusBar status="disconnected" sessionCount={0} model="sonnet" onReconnect={() => {}} />)
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })

  it('shows Not Configured when status is not-configured', () => {
    render(<StatusBar status="not-configured" sessionCount={0} model="sonnet" onReconnect={() => {}} />)
    expect(screen.getByText('Not Configured')).toBeInTheDocument()
  })

  it('shows Connecting when status is connecting', () => {
    render(<StatusBar status="connecting" sessionCount={0} model="sonnet" onReconnect={() => {}} />)
    expect(screen.getByText('Connecting')).toBeInTheDocument()
  })

  it('shows Error when status is error', () => {
    render(<StatusBar status="error" sessionCount={0} model="sonnet" onReconnect={() => {}} />)
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('shows model name', () => {
    render(<StatusBar status="connected" sessionCount={0} model="opus" onReconnect={() => {}} />)
    expect(screen.getByText('opus')).toBeInTheDocument()
  })

  it('shows session count when > 0', () => {
    render(<StatusBar status="connected" sessionCount={3} model="sonnet" onReconnect={() => {}} />)
    expect(screen.getByText('3 sessions')).toBeInTheDocument()
  })

  it('uses singular when sessionCount is 1', () => {
    render(<StatusBar status="connected" sessionCount={1} model="sonnet" onReconnect={() => {}} />)
    expect(screen.getByText('1 session')).toBeInTheDocument()
  })

  it('does not show session count when 0', () => {
    render(<StatusBar status="connected" sessionCount={0} model="sonnet" onReconnect={() => {}} />)
    expect(screen.queryByText(/session/)).not.toBeInTheDocument()
  })

  it('disables button when not-configured', () => {
    render(<StatusBar status="not-configured" sessionCount={0} model="sonnet" onReconnect={() => {}} />)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })
})
