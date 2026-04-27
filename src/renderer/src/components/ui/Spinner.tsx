type SpinnerProps = {
  size?: 'sm' | 'md' | 'lg' | undefined
  color?: string | undefined
}

export function Spinner({ size = 'md', color }: SpinnerProps): React.JSX.Element {
  return (
    <span
      className={`fleet-spinner fleet-spinner--${size}`}
      style={color ? { borderTopColor: color } : undefined}
    />
  )
}
