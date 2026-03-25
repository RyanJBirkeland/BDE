import { useMemo } from 'react';
import { NEON_ACCENTS, neonVar } from './types';

interface ParticleFieldProps {
  density?: number;
}

const DRIFT_ANIMATIONS = ['neon-particle-drift-1', 'neon-particle-drift-2', 'neon-particle-drift-3'];

export function ParticleField({ density = 18 }: ParticleFieldProps) {
  const particles = useMemo(() => {
    return Array.from({ length: density }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${20 + Math.random() * 80}%`,
      accent: NEON_ACCENTS[i % NEON_ACCENTS.length],
      duration: `${20 + Math.random() * 20}s`,
      delay: `${Math.random() * -30}s`,
      animation: DRIFT_ANIMATIONS[i % DRIFT_ANIMATIONS.length],
      size: `${2 + Math.random() * 2}px`,
    }));
  }, [density]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0,
      }}
    >
      {particles.map((p) => (
        <div
          key={p.id}
          data-role="particle"
          style={{
            position: 'absolute',
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: neonVar(p.accent, 'color'),
            boxShadow: neonVar(p.accent, 'glow'),
            animation: `${p.animation} ${p.duration} ease-in-out ${p.delay} infinite`,
            willChange: 'transform',
          }}
        />
      ))}
    </div>
  );
}
