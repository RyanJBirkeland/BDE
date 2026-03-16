import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../ErrorBoundary'

function ThrowingComponent({ message }: { message: string }): React.JSX.Element {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  // Suppress React error boundary console.error noise
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>OK</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  it('catches error and shows default fallback', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Boom!" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Boom!')).toBeInTheDocument()
  })

  it('shows boundary name in fallback when provided', () => {
    render(
      <ErrorBoundary name="MyWidget">
        <ThrowingComponent message="crash" />
      </ErrorBoundary>
    )
    expect(screen.getByText('MyWidget crashed')).toBeInTheDocument()
  })

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <ThrowingComponent message="oops" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Custom error UI')).toBeInTheDocument()
  })
})
