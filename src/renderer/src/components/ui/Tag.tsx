interface TagProps {
  children: React.ReactNode
}

export function Tag({ children }: TagProps): React.JSX.Element {
  return (
    <span
      style={{
        padding: '1px 7px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--fg-2)',
        background: 'var(--surf-2)',
        border: '1px solid var(--line)',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        lineHeight: 1.6,
      }}
    >
      {children}
    </span>
  )
}
