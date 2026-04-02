type DividerProps = {
  direction?: 'horizontal' | 'vertical'
}

export function Divider({ direction = 'horizontal' }: DividerProps) {
  return <div className={`bde-divider bde-divider--${direction}`} />
}
