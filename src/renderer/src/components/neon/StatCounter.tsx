import { type NeonAccent, neonVar } from './types';

interface StatCounterProps {
  label: string;
  value: number | string;
  accent: NeonAccent;
  suffix?: string;
  trend?: {
    direction: 'up' | 'down';
    label: string;
  };
  icon?: React.ReactNode;
}

export function StatCounter({ label, value, accent, suffix, trend, icon }: StatCounterProps) {
  return (
    <div style={{
      background: neonVar(accent, 'surface'),
      border: `1px solid ${neonVar(accent, 'border')}`,
      borderRadius: '10px',
      padding: '12px',
    }}>
      <div data-role="stat-label" style={{
        color: neonVar(accent, 'color'),
        fontSize: '9px',
        textTransform: 'uppercase',
        letterSpacing: '1.5px',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}>
        {icon}
        {label}
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '4px',
        marginTop: '4px',
      }}>
        <span style={{
          color: '#fff',
          fontSize: '22px',
          fontWeight: 800,
          textShadow: neonVar(accent, 'glow'),
        }}>{value}</span>
        {suffix && (
          <span style={{
            color: neonVar(accent, 'color'),
            fontSize: '10px',
            opacity: 0.6,
          }}>{suffix}</span>
        )}
      </div>
      {trend && (
        <div style={{
          color: trend.direction === 'down' ? 'var(--neon-cyan)' : 'var(--neon-red)',
          fontSize: '10px',
          marginTop: '4px',
          opacity: 0.7,
        }}>
          {trend.direction === 'down' ? '↓' : '↑'} {trend.label}
        </div>
      )}
    </div>
  );
}
