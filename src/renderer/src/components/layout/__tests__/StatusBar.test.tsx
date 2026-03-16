import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar } from '../StatusBar'

describe('StatusBar', () => {
  it('shows Connected when status is connected', () => {
    render(<StatusBar status="connected" sessionCount={0} model="sonnet" onReconnect={() => {}} />)
    expect(screen.getByText('● Connected')).toBeInTheDocument()
  })

  it('shows Disconnected when status is disconnected', () => {
    render(<StatusBar status="disconnected" sessionCount={0} model="sonnet" onReconnect={() => {}} />)
    expect(screen.getByText('● Disconnected')).toBeInTheDocument()
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
})
