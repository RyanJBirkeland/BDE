interface EmptyStateProps {
  onCreateTerminal: (shell?: string) => void
}

export function EmptyState({ onCreateTerminal }: EmptyStateProps): React.JSX.Element {
  const shells = [
    { label: 'zsh', value: '/bin/zsh' },
    { label: 'bash', value: '/bin/bash' },
    { label: 'node', value: 'node' },
    { label: 'python3', value: 'python3' }
  ]

  return (
    <div className="terminal-empty-state">
      <div className="terminal-empty-state__icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </div>
      <p className="terminal-empty-state__title">No terminals open</p>
      <p className="terminal-empty-state__hint">
        Press <kbd>⌘T</kbd> to open a new terminal
      </p>
      <p className="terminal-empty-state__subtitle">or choose a shell:</p>
      <div className="terminal-empty-state__actions">
        {shells.map((shell) => (
          <button
            key={shell.value}
            className="terminal-empty-state__shell-btn"
            onClick={() => onCreateTerminal(shell.value)}
          >
            {shell.label}
          </button>
        ))}
      </div>
    </div>
  )
}
