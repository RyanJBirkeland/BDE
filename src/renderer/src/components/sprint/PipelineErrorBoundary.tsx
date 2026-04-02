import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackLabel?: string
}
interface State {
  hasError: boolean
  error: Error | null
}

export class PipelineErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleRetry = () => this.setState({ hasError: false, error: null })

  render() {
    if (this.state.hasError) {
      return (
        <div className="pipeline-error-boundary">
          <span className="pipeline-error-boundary__title">
            {this.props.fallbackLabel ?? 'Something went wrong'}
          </span>
          <span className="pipeline-error-boundary__message">{this.state.error?.message}</span>
          <button className="pipeline-error-boundary__retry" onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
