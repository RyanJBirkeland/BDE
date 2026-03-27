import { useState, useId } from 'react'
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

export interface ChartBar {
  value: number
  accent?: NeonAccent
  label?: string
}

interface MiniChartProps {
  data: ChartBar[]
  height?: number
}

/** Padding inside the SVG so dots at edges aren't clipped. */
const PAD = { top: 8, right: 8, bottom: 16, left: 8 }
const SVG_WIDTH = 400

/** Build a smooth cubic bezier path through points. */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return ''
  const d: string[] = [`M ${points[0][0]},${points[0][1]}`]
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    const cpx = (x1 - x0) * 0.4
    d.push(`C ${x0 + cpx},${y0} ${x1 - cpx},${y1} ${x1},${y1}`)
  }
  return d.join(' ')
}

export function MiniChart({ data, height = 80 }: MiniChartProps) {
  const uid = useId()
  const [hover, setHover] = useState<number | null>(null)

  if (data.length === 0) {
    return (
      <div
        style={{
          color: tokens.neon.textDim,
          fontSize: tokens.size.xs,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        No data
      </div>
    )
  }

  const accent: NeonAccent = data[0]?.accent ?? 'cyan'
  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const plotW = SVG_WIDTH - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  // Map data to SVG coordinates
  const points: [number, number][] = data.map((d, i) => {
    const x = PAD.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW)
    const y = PAD.top + plotH - (d.value / maxValue) * plotH
    return [x, y]
  })

  const linePath = smoothPath(points)

  // Closed path for gradient fill (line + bottom edge)
  const fillPath =
    linePath +
    ` L ${points[points.length - 1][0]},${height} L ${points[0][0]},${height} Z`

  return (
    <div style={{ height, position: 'relative' }}>
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        <defs>
          {/* Gradient fill under the curve */}
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={neonVar(accent, 'color')} stopOpacity="0.35" />
            <stop offset="100%" stopColor={neonVar(accent, 'color')} stopOpacity="0.02" />
          </linearGradient>
          {/* Glow filter for the line */}
          <filter id={`${uid}-glow`}>
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Gradient fill area */}
        <path d={fillPath} fill={`url(#${uid}-fill)`} />

        {/* Glowing line */}
        <path
          d={linePath}
          fill="none"
          stroke={neonVar(accent, 'color')}
          strokeWidth="2"
          filter={`url(#${uid}-glow)`}
          vectorEffect="non-scaling-stroke"
        />

        {/* Data point dots + invisible hit areas */}
        {points.map(([x, y], i) => (
          <g key={i} data-role="chart-bar">
            {/* Larger invisible circle for easier hover */}
            <circle
              cx={x}
              cy={y}
              r={12}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            {/* Visible dot */}
            <circle
              cx={x}
              cy={y}
              r={hover === i ? 5 : 3}
              fill={neonVar(accent, 'color')}
              style={{
                filter: `drop-shadow(0 0 ${hover === i ? '6px' : '3px'} ${neonVar(accent, 'color')})`,
                transition: 'r 200ms ease, filter 200ms ease',
                pointerEvents: 'none'
              }}
            />
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hover !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${(points[hover][0] / SVG_WIDTH) * 100}%`,
            top: 0,
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.85)',
            border: `1px solid ${neonVar(accent, 'color')}`,
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: tokens.size.xs,
            color: neonVar(accent, 'color'),
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <strong>{data[hover].value}</strong>
          {data[hover].label && (
            <span style={{ opacity: 0.7, marginLeft: 6 }}>
              {formatHourLabel(data[hover].label!)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** Format ISO hour string to readable time. */
function formatHourLabel(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}
