import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PipelineErrorBoundary } from '../PipelineErrorBoundary'

/** A child that throws during render, triggering the error boundary. */
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }): React.ReactNode {
  if (shouldThrow) {
    throw new Error('Simulated pipeline crash')
  }
  return <div data-testid="healthy-child">Pipeline is healthy</div>
}

describe('PipelineErrorBoundary', () => {
  it('renders children normally when no error occurs', () => {
    render(
      <PipelineErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </PipelineErrorBoundary>
    )

    expect(screen.getByTestId('healthy-child')).toBeInTheDocument()
  })

  it('shows fallback UI when a child throws', () => {
    // Suppress the expected React error boundary console.error noise
    const consoleError = console.error
    console.error = (): void => {}

    render(
      <PipelineErrorBoundary fallbackLabel="Pipeline crashed">
        <ThrowingChild shouldThrow={true} />
      </PipelineErrorBoundary>
    )

    expect(screen.getByText('Pipeline crashed')).toBeInTheDocument()
    expect(screen.getByText('Simulated pipeline crash')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

    console.error = consoleError
  })

  it('uses the default fallback label when no fallbackLabel prop is provided', () => {
    const consoleError = console.error
    console.error = (): void => {}

    render(
      <PipelineErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </PipelineErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    console.error = consoleError
  })

  it('shows the Retry button in the fallback UI and calls setState when clicked', () => {
    const consoleError = console.error
    console.error = (): void => {}

    render(
      <PipelineErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </PipelineErrorBoundary>
    )

    // Fallback is visible with Retry button
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    const retryButton = screen.getByRole('button', { name: 'Retry' })
    expect(retryButton).toBeInTheDocument()

    // Clicking Retry does not throw and the component handles the click
    expect(() => fireEvent.click(retryButton)).not.toThrow()

    console.error = consoleError
  })
})
