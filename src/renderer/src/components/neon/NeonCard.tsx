// src/renderer/src/components/neon/NeonCard.tsx
import { type ReactNode } from 'react';
import { type NeonAccent, neonVar } from './types';

interface NeonCardProps {
  accent?: NeonAccent;
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function NeonCard({
  accent = 'purple',
  title,
  icon,
  action,
  children,
  className = '',
  style,
}: NeonCardProps) {
  const cardStyle: React.CSSProperties = {
    '--card-accent': neonVar(accent, 'color'),
    '--card-accent-border': neonVar(accent, 'border'),
    '--card-accent-surface': neonVar(accent, 'surface'),
    '--card-accent-glow': neonVar(accent, 'glow'),
    background: `linear-gradient(135deg, ${neonVar(accent, 'surface')}, rgba(10, 0, 21, 0.6))`,
    border: `1px solid ${neonVar(accent, 'border')}`,
    borderRadius: '14px',
    backdropFilter: 'var(--neon-glass-blur)',
    WebkitBackdropFilter: 'var(--neon-glass-blur)',
    boxShadow: `var(--neon-glass-shadow), var(--neon-glass-edge)`,
    padding: title ? '0' : '14px',
    overflow: 'hidden',
    transition: 'box-shadow 150ms ease, transform 150ms ease',
    ...style,
  } as React.CSSProperties;

  return (
    <div className={`neon-card ${className}`.trim()} style={cardStyle}>
      {title && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '10px 14px',
          borderBottom: `1px solid ${neonVar(accent, 'border')}`,
        }}>
          {icon && <span style={{ color: neonVar(accent, 'color'), display: 'flex' }}>{icon}</span>}
          <span style={{
            color: neonVar(accent, 'color'),
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            fontWeight: 600,
          }}>{title}</span>
          {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
        </div>
      )}
      <div style={{ padding: title ? '14px' : '0' }}>
        {children}
      </div>
    </div>
  );
}
