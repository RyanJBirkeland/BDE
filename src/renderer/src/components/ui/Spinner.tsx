type SpinnerProps = {
  size?: 'sm' | 'md' | 'lg'
  color?: string
}

export function Spinner({ size = 'md', color }: SpinnerProps) {
  return (
    <span
      className={`bde-spinner bde-spinner--${size}`}
      style={color ? { borderTopColor: color } : undefined}
    />
  )
}
