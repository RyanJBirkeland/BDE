import type { JSX } from 'react'

interface Props {
  branch: string
  targetBranch?: string | undefined
}

/**
 * Small chip showing the branch → target relationship.
 * V2: mono 10px, 1px solid --line border, radius 999, padding 1px 7px.
 */
export function BranchBar({ branch, targetBranch = 'main' }: Props): JSX.Element {
  return (
    <span
      aria-label={`Branch ${branch} targeting ${targetBranch}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--s-1)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-2xs)',
        background: 'var(--surf-1)',
        border: '1px solid var(--line)',
        borderRadius: 999,
        padding: '1px 7px',
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ color: 'var(--fg-2)' }}>{branch}</span>
      <span style={{ color: 'var(--fg-4)' }}>→</span>
      <span style={{ color: 'var(--fg-2)' }}>{targetBranch}</span>
    </span>
  )
}
