import { Component, ErrorInfo, ReactNode } from 'react'
import { tokens } from '../../design-system/tokens'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  name?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.name ?? 'unknown'}]`, error, info)
  }

  handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              padding: tokens.space[4],
              color: tokens.color.danger,
              fontFamily: tokens.font.code,
              fontSize: tokens.size.sm
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: tokens.space[1] }}>
              {this.props.name ? `${this.props.name} crashed` : 'Something went wrong'}
            </div>
            <div style={{ opacity: 0.7, marginBottom: tokens.space[3] }}>
              {this.state.error.message}
            </div>
            <button
              onClick={this.handleReset}
              style={{
                padding: `${tokens.space[1]} ${tokens.space[3]}`,
                backgroundColor: tokens.color.accent,
                color: tokens.color.bg,
                border: 'none',
                borderRadius: tokens.radius.sm,
                cursor: 'pointer',
                fontFamily: tokens.font.ui,
                fontSize: tokens.size.sm
              }}
            >
              Try Again
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
