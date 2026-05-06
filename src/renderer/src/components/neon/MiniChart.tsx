import { useState, useId } from 'react'
import { type NeonAccent, neonVar } from './types'

export interface ChartBar {
  value: number
  accent?: string | undefined
  label?: string | undefined
}

interface MiniChartProps {
  data: ChartBar[]
  height?: number | undefined
}

/** Padding inside the SVG so dots at edges aren't clipped. */
const PAD = { top: 8, right: 8, bottom: 16, left: 8 }
const SVG_WIDTH = 400

/** Build a smooth cubic bezier path through points. */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return ''
  const first = points[0]
  if (!first) return ''
  const d: string[] = [`M ${first[0]},${first[1]}`]
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i]
    const next = points[i + 1]
    if (!curr || !next) continue
    const [x0, y0] = curr
    const [x1, y1] = next
    const cpx = (x1 - x0) * 0.4
    d.push(`C ${x0 + cpx},${y0} ${x1 - cpx},${y1} ${x1},${y1}`)
  }
  return d.join(' ')
}

export function MiniChart({ data, height = 80 }: MiniChartProps): React.JSX.Element {
  const uid = useId()
  const [hover, setHover] = useState<number | null>(null)

  if (data.length === 0) {
    return (
      <div className="mini-chart-empty" style={{ height }}>
        No data
      </div>
    )
  }

  const accent: NeonAccent = (data[0]?.accent as NeonAccent | undefined) ?? 'cyan'
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
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  const fillPath =
    firstPoint && lastPoint
      ? linePath + ` L ${lastPoint[0]},${height} L ${firstPoint[0]},${height} Z`
      : linePath

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
        </defs>

        {/* Gradient fill area */}
        <path d={fillPath} fill={`url(#${uid}-fill)`} />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={neonVar(accent, 'color')}
          strokeWidth="2"
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
                transition: 'r 200ms ease',
                pointerEvents: 'none'
              }}
            />
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hover !== null && points[hover] && data[hover] && (
        <div
          className="mini-chart-tooltip"
          style={{
            left: `${((points[hover]?.[0] ?? 0) / SVG_WIDTH) * 100}%`,
            borderColor: neonVar(accent, 'color'),
            color: neonVar(accent, 'color')
          }}
        >
          <strong>{formatValue(data[hover]?.value ?? 0)}</strong>
          {data[hover]?.label && (
            <span style={{ opacity: 0.7, marginLeft: 6 }}>{formatLabel(data[hover]!.label!)}</span>
          )}
        </div>
      )}
    </div>
  )
}

/** Format a number for tooltip display — integers stay as-is, floats get 2 decimals. */
function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

/** Format a label for tooltip display — ISO dates become readable times, everything else passes through. */
function formatLabel(label: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(label)) {
    const d = new Date(label)
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }
  }
  return label
}
