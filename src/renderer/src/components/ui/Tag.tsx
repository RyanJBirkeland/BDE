import React from 'react'

interface TagProps {
  children: React.ReactNode
}

export function Tag({ children }: TagProps): React.JSX.Element {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'var(--fg-3)',
        background: 'var(--surf-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm)',
        padding: '1px var(--s-1)',
        lineHeight: 1.4,
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  )
}
