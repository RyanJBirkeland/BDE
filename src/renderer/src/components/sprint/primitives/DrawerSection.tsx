interface DrawerSectionProps {
  eyebrow: string
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}

export function DrawerSection({ eyebrow, title, right, children }: DrawerSectionProps): React.JSX.Element {
  return (
    <section
      style={{
        padding: 'var(--s-3) var(--s-4)',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
        <span className="fleet-eyebrow">{eyebrow}</span>
        {right && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)' }}>
            {right}
          </span>
        )}
      </div>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
        {title}
      </span>
      {children}
    </section>
  )
}
