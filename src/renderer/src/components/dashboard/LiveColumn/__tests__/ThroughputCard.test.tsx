import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThroughputCard } from '../ThroughputCard'
import type { CompletionBucket } from '../../../../../../shared/ipc-channels'

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false
}))

function bucket(date: Date, success = 0, failed = 0): CompletionBucket {
  return {
    hour: date.toISOString(),
    successCount: success,
    failedCount: failed
  }
}

describe('ThroughputCard - computeDelta via rendered output', () => {
  let realDate: typeof Date

  beforeEach(() => {
    realDate = global.Date
  })

  afterEach(() => {
    global.Date = realDate
    vi.useRealTimers()
  })

  it('renders without a delta indicator when there is no data to compare', () => {
    render(<ThroughputCard throughputData={[]} />)
    expect(screen.queryByText(/vs yesterday/)).not.toBeInTheDocument()
  })

  it('renders without a delta indicator when both windows total zero', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    render(<ThroughputCard throughputData={[bucket(today, 0, 0), bucket(yesterday, 0, 0)]} />)
    expect(screen.queryByText(/vs yesterday/)).not.toBeInTheDocument()
  })

  it('renders a positive delta when today exceeds the same window yesterday', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    render(<ThroughputCard throughputData={[bucket(today, 5, 0), bucket(yesterday, 1, 0)]} />)
    const delta = screen.queryByText(/vs yesterday/)
    expect(delta).not.toBeNull()
    expect(delta?.textContent ?? '').toMatch(/^\+/)
  })

  it('renders a negative delta when today trails yesterday in the same window', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    render(<ThroughputCard throughputData={[bucket(today, 1, 0), bucket(yesterday, 5, 0)]} />)
    const delta = screen.queryByText(/vs yesterday/)
    expect(delta).not.toBeNull()
    expect(delta?.textContent ?? '').toMatch(/^-/)
  })

  it('renders without a delta indicator when only one bucket is present', () => {
    const today = new Date()
    render(<ThroughputCard throughputData={[bucket(today, 3, 0)]} />)
    expect(screen.queryByText(/vs yesterday/)).not.toBeInTheDocument()
  })
})
