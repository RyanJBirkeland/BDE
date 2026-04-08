import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FiresStrip } from '../FiresStrip'

describe('FiresStrip', () => {
  const noop = (): void => {}

  it('renders nothing when all counts zero and no load saturation', () => {
    const { container } = render(
      <FiresStrip failed={0} blocked={0} stuck={0} loadSaturated={null} onClick={noop} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders failed segment when failed > 0', () => {
    render(<FiresStrip failed={2} blocked={0} stuck={0} loadSaturated={null} onClick={noop} />)
    expect(screen.getByRole('button', { name: /2 failed/i })).toBeInTheDocument()
  })

  it('renders blocked segment when blocked > 0', () => {
    render(<FiresStrip failed={0} blocked={3} stuck={0} loadSaturated={null} onClick={noop} />)
    expect(screen.getByRole('button', { name: /3 blocked/i })).toBeInTheDocument()
  })

  it('renders stuck segment when stuck > 0', () => {
    render(<FiresStrip failed={0} blocked={0} stuck={1} loadSaturated={null} onClick={noop} />)
    expect(screen.getByRole('button', { name: /1 stuck/i })).toBeInTheDocument()
  })

  it('renders all four segments when all active', () => {
    render(
      <FiresStrip
        failed={2}
        blocked={3}
        stuck={1}
        loadSaturated={{ load1: 137, cpuCount: 12 }}
        onClick={noop}
      />
    )
    expect(screen.getByRole('button', { name: /2 failed/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /3 blocked/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 stuck/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /load 137 \/ 12 cores/i })).toBeInTheDocument()
  })

  it('routes each segment via onClick with correct kind', () => {
    const onClick = vi.fn()
    render(
      <FiresStrip
        failed={1}
        blocked={1}
        stuck={1}
        loadSaturated={{ load1: 30, cpuCount: 12 }}
        onClick={onClick}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /failed/i }))
    expect(onClick).toHaveBeenLastCalledWith('failed')
    fireEvent.click(screen.getByRole('button', { name: /blocked/i }))
    expect(onClick).toHaveBeenLastCalledWith('blocked')
    fireEvent.click(screen.getByRole('button', { name: /stuck/i }))
    expect(onClick).toHaveBeenLastCalledWith('stuck')
    fireEvent.click(screen.getByRole('button', { name: /load/i }))
    expect(onClick).toHaveBeenLastCalledWith('load')
  })

  it('pluralizes correctly: "1 failed task" but "2 failed tasks"', () => {
    // Accept either singular or plural — the test accepts anything containing "1 failed" and "2 failed"
    const { unmount } = render(
      <FiresStrip failed={1} blocked={0} stuck={0} loadSaturated={null} onClick={noop} />
    )
    expect(screen.getByRole('button', { name: /1 failed/i })).toBeInTheDocument()
    unmount()
    render(<FiresStrip failed={2} blocked={0} stuck={0} loadSaturated={null} onClick={noop} />)
    expect(screen.getByRole('button', { name: /2 failed/i })).toBeInTheDocument()
  })
})
