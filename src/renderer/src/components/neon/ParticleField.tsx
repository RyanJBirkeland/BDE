import { useMemo } from 'react'
import { NEON_ACCENTS, neonVar } from './types'

interface ParticleFieldProps {
  density?: number
}

const DRIFT_ANIMATIONS = ['neon-particle-drift-1', 'neon-particle-drift-2', 'neon-particle-drift-3']
const DURATION_BASE_S = 20
const DURATION_RANGE_S = 20
const DELAY_RANGE_S = -30
const SIZE_MIN_PX = 2
const SIZE_RANGE_PX = 2
const TOP_OFFSET_PCT = 20
const TOP_RANGE_PCT = 80

export function ParticleField({ density = 18 }: ParticleFieldProps) {
  const particles = useMemo(() => {
    return Array.from({ length: density }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${TOP_OFFSET_PCT + Math.random() * TOP_RANGE_PCT}%`,
      accent: NEON_ACCENTS[i % NEON_ACCENTS.length],
      duration: `${DURATION_BASE_S + Math.random() * DURATION_RANGE_S}s`,
      delay: `${Math.random() * DELAY_RANGE_S}s`,
      animation: DRIFT_ANIMATIONS[i % DRIFT_ANIMATIONS.length],
      size: `${SIZE_MIN_PX + Math.random() * SIZE_RANGE_PX}px`
    }))
  }, [density])

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0
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
            willChange: 'transform'
          }}
        />
      ))}
    </div>
  )
}
