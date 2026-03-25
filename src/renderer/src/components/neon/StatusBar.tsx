import { type ReactNode } from 'react';

interface StatusBarProps {
  title: string;
  status: 'ok' | 'error' | 'warning';
  children?: ReactNode;
}

const STATUS_COLORS = {
  ok: 'var(--neon-cyan)',
  error: 'var(--neon-red)',
  warning: 'var(--neon-orange)',
} as const;

const STATUS_GLOWS = {
  ok: '0 0 8px var(--neon-cyan)',
  error: '0 0 8px var(--neon-red)',
  warning: '0 0 8px var(--neon-orange)',
} as const;

export function StatusBar({ title, status, children }: StatusBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 16px',
      borderBottom: '1px solid var(--neon-purple-border)',
    }}>
      <div
        data-role="status-dot"
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: STATUS_COLORS[status],
          boxShadow: STATUS_GLOWS[status],
          animation: 'neon-breathe 2s ease-in-out infinite',
        }}
      />
      <span style={{
        color: 'var(--neon-purple)',
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '2px',
        fontWeight: 600,
      }}>{title}</span>
      {children && (
        <span style={{
          marginLeft: 'auto',
          color: 'rgba(255, 255, 255, 0.3)',
          fontSize: '10px',
          fontFamily: 'var(--font-code)',
        }}>{children}</span>
      )}
    </div>
  );
}
