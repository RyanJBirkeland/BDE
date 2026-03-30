import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlaygroundCard } from '../PlaygroundCard'

describe('PlaygroundCard', () => {
  const onClick = vi.fn()
  const defaultProps = {
    filename: 'preview.html',
    sizeBytes: 1234,
    onClick,
  }

  it('renders filename and file size', () => {
    render(<PlaygroundCard {...defaultProps} />)
    expect(screen.getByText('preview.html')).toBeTruthy()
    expect(screen.getByText('1.2 KB')).toBeTruthy()
  })

  it('renders with proper aria-label', () => {
    render(<PlaygroundCard {...defaultProps} />)
    const button = screen.getByLabelText('Preview preview.html')
    expect(button).toBeTruthy()
  })

  it('calls onClick when clicked', () => {
    render(<PlaygroundCard {...defaultProps} />)
    const card = screen.getByTestId('playground-card')
    fireEvent.click(card)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders Preview hint text', () => {
    render(<PlaygroundCard {...defaultProps} />)
    expect(screen.getByText('Preview')).toBeTruthy()
  })

  it('formats bytes correctly', () => {
    const { rerender } = render(<PlaygroundCard {...defaultProps} sizeBytes={500} />)
    expect(screen.getByText('500 B')).toBeTruthy()

    rerender(<PlaygroundCard {...defaultProps} sizeBytes={2048} />)
    expect(screen.getByText('2.0 KB')).toBeTruthy()

    rerender(<PlaygroundCard {...defaultProps} sizeBytes={1048576} />)
    expect(screen.getByText('1.0 MB')).toBeTruthy()
  })

  it('has button role for accessibility', () => {
    render(<PlaygroundCard {...defaultProps} />)
    const button = screen.getByRole('button')
    expect(button).toBeTruthy()
  })

  it('truncates long filenames with ellipsis', () => {
    const longFilename = 'very-long-filename-that-should-be-truncated-with-ellipsis.html'
    render(<PlaygroundCard {...defaultProps} filename={longFilename} />)
    const filenameElement = screen.getByText(longFilename)
    const styles = window.getComputedStyle(filenameElement)
    expect(styles.overflow).toBe('hidden')
    expect(styles.textOverflow).toBe('ellipsis')
    expect(styles.whiteSpace).toBe('nowrap')
  })
})
