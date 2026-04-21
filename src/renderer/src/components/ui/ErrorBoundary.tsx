import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode | undefined
  name?: string | undefined
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.name ?? 'unknown'}]`, error, info)
  }

  handleReset = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="error-boundary">
            <div className="error-boundary__title">
              {this.props.name ? `${this.props.name} crashed` : 'Something went wrong'}
            </div>
            <div className="error-boundary__message">{this.state.error.message}</div>
            <button className="bde-btn bde-btn--primary bde-btn--sm" onClick={this.handleReset}>
              Try Again
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
