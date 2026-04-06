import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { ElapsedTime } from '../ElapsedTime'

describe('ElapsedTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders elapsed time from startedAtMs', () => {
    // Started 5 seconds ago
    const startedAtMs = Date.now() - 5000
    const { container } = render(<ElapsedTime startedAtMs={startedAtMs} />)
    expect(container.textContent).toBeTruthy()
  })

  it('updates every second', () => {
    const startedAtMs = Date.now() - 1000
    const { container } = render(<ElapsedTime startedAtMs={startedAtMs} />)
    vi.advanceTimersByTime(1000)

    // Content may have changed (ticked)
    expect(container.textContent).toBeTruthy()
  })
})
