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
            <div style={{ opacity: 0.7 }}>{this.state.error.message}</div>
          </div>
        )
      )
    }
    return this.props.children
  }
}
