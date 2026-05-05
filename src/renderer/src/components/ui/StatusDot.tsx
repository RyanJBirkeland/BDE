export type StatusDotKind = 'running' | 'queued' | 'review' | 'blocked' | 'failed' | 'done'

interface StatusDotProps {
  kind: StatusDotKind
  size?: number
}

export function StatusDot({ kind, size = 6 }: StatusDotProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`fleet-dot fleet-dot--${kind}`}
      style={{ width: size, height: size, flexShrink: 0, display: 'inline-block' }}
    />
  )
}
