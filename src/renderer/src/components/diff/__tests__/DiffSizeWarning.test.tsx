import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiffSizeWarning } from '../DiffSizeWarning'

describe('DiffSizeWarning', () => {
  it('displays size in bytes when under 1 KB', () => {
    render(<DiffSizeWarning sizeBytes={512} onLoadAnyway={vi.fn()} />)
    expect(screen.getByText(/512 B/)).toBeInTheDocument()
  })

  it('displays size in KB when between 1 KB and 1 MB', () => {
    render(<DiffSizeWarning sizeBytes={2048} onLoadAnyway={vi.fn()} />)
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument()
  })

  it('displays size in MB when 1 MB or larger', () => {
    render(<DiffSizeWarning sizeBytes={1024 * 1024 * 3} onLoadAnyway={vi.fn()} />)
    expect(screen.getByText(/3\.0 MB/)).toBeInTheDocument()
  })

  it('renders the load-anyway button', () => {
    render(<DiffSizeWarning sizeBytes={1024} onLoadAnyway={vi.fn()} />)
    expect(screen.getByRole('button', { name: /load anyway/i })).toBeInTheDocument()
  })

  it('calls onLoadAnyway when button is clicked', async () => {
    const user = userEvent.setup()
    const onLoadAnyway = vi.fn()
    render(<DiffSizeWarning sizeBytes={1024} onLoadAnyway={onLoadAnyway} />)
    await user.click(screen.getByRole('button', { name: /load anyway/i }))
    expect(onLoadAnyway).toHaveBeenCalledOnce()
  })

  it('displays the warning message about slow editor', () => {
    render(<DiffSizeWarning sizeBytes={5000} onLoadAnyway={vi.fn()} />)
    expect(screen.getByText(/may slow down the editor/i)).toBeInTheDocument()
  })
})
