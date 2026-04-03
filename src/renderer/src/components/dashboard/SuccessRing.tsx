import { neonVar } from '../neon/types'

interface SuccessRingProps {
  rate: number | null
  done: number
  failed: number
}

/** SVG donut ring showing success rate. */
export function SuccessRing({ rate, done, failed }: SuccessRingProps): React.JSX.Element {
  if (rate === null) {
    return <div className="dashboard-ring-empty">No terminal tasks</div>
  }

  const size = 64
  const stroke = 6
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const filled = (rate / 100) * circ
  const accent = rate >= 80 ? 'cyan' : rate >= 50 ? 'orange' : 'red'

  return (
    <div className="dashboard-ring">
      <svg width={size} height={size} className="dashboard-ring__svg">
        <circle cx={size / 2} cy={size / 2} r={r} className="dashboard-ring__bg" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={neonVar(accent, 'color')}
          strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 4px ${neonVar(accent, 'color')})`,
            transition: 'stroke-dasharray 500ms ease'
          }}
        />
      </svg>
      <div>
        <div
          className="dashboard-ring__rate"
          style={{
            color: neonVar(accent, 'color'),
            textShadow: neonVar(accent, 'glow')
          }}
        >
          {rate}%
        </div>
        <div className="dashboard-ring__breakdown">
          {done}✓ {failed}✗
        </div>
      </div>
    </div>
  )
}
