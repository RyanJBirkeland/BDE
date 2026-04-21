import type { DailySuccessRate } from '../../../../shared/ipc-channels'

interface SuccessRateChartProps {
  data: DailySuccessRate[]
  height?: number | undefined
}

const SVG_W = 520
const PAD = { top: 20, right: 10, bottom: 18, left: 32 }

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function avg(arr: number[]): number | null {
  return arr.length === 0 ? null : arr.reduce((s, n) => s + n, 0) / arr.length
}

export function SuccessRateChart({ data, height = 140 }: SuccessRateChartProps): React.JSX.Element {
  const plotW = SVG_W - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  // Y-axis fixed at [0, 100] — never auto-scale
  const y = (value: number): number => PAD.top + plotH - (value / 100) * plotH

  const nonNull = data.filter(
    (d): d is DailySuccessRate & { successRate: number } => d.successRate != null
  )
  const last7 = data
    .slice(-7)
    .filter((d): d is DailySuccessRate & { successRate: number } => d.successRate != null)
  const prior7 = data
    .slice(-14, -7)
    .filter((d): d is DailySuccessRate & { successRate: number } => d.successRate != null)

  const successRate7dAvg = avg(last7.map((d) => d.successRate))
  const prior7dAvg = avg(prior7.map((d) => d.successRate))
  const delta =
    successRate7dAvg != null && prior7dAvg != null ? successRate7dAvg - prior7dAvg : null

  // Empty state
  if (nonNull.length === 0) {
    return (
      <div
        style={{
          position: 'relative',
          fontFamily: 'var(--bde-font-code)',
          fontSize: 10,
          color: 'var(--bde-text-muted)',
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px dashed #1e293b',
          borderRadius: 4
        }}
      >
        No completed tasks in the last 14 days
      </div>
    )
  }

  // Build trend path with gaps for null values
  // Multiple M commands when there are gaps
  let trendPath = ''
  let inSegment = false
  for (let i = 0; i < data.length; i++) {
    const d = data[i]
    if (!d) continue
    const cx = data.length > 1 ? PAD.left + (i / (data.length - 1)) * plotW : PAD.left
    if (d.successRate != null) {
      const cy = y(d.successRate)
      if (!inSegment) {
        trendPath += `M ${cx} ${cy} `
        inSegment = true
      } else {
        trendPath += `L ${cx} ${cy} `
      }
    } else {
      inSegment = false
    }
  }

  // Build fill path for gradient (optional visual)
  let fillPath = ''
  let fillInSegment = false
  let segmentStartX = 0
  for (let i = 0; i < data.length; i++) {
    const d = data[i]
    if (!d) continue
    const cx = data.length > 1 ? PAD.left + (i / (data.length - 1)) * plotW : PAD.left
    if (d.successRate != null) {
      const cy = y(d.successRate)
      if (!fillInSegment) {
        segmentStartX = cx
        fillPath += `M ${cx} ${PAD.top + plotH} L ${cx} ${cy} `
        fillInSegment = true
      } else {
        fillPath += `L ${cx} ${cy} `
        // If next point is null or end, close the segment
        if (i === data.length - 1 || data[i + 1]?.successRate == null) {
          fillPath += `L ${cx} ${PAD.top + plotH} L ${segmentStartX} ${PAD.top + plotH} Z `
          fillInSegment = false
        }
      }
    } else {
      fillInSegment = false
    }
  }

  // X-axis labels: first, mid, last
  const xLabels: Array<{ i: number; label: string }> = []
  if (data.length > 0) {
    const first = data[0]
    if (first) xLabels.push({ i: 0, label: formatDateLabel(first.date) })
    if (data.length > 2) {
      const mid = Math.floor((data.length - 1) / 2)
      const midData = data[mid]
      if (midData) xLabels.push({ i: mid, label: formatDateLabel(midData.date) })
    }
    if (data.length > 1) {
      const last = data[data.length - 1]
      if (last) xLabels.push({ i: data.length - 1, label: formatDateLabel(last.date) })
    }
  }

  // Delta display
  let deltaEl: React.ReactNode
  if (delta == null) {
    deltaEl = <span style={{ color: 'var(--bde-text-dim)' }}>— steady</span>
  } else if (Math.abs(delta) < 0.5) {
    deltaEl = <span style={{ color: 'var(--bde-text-dim)' }}>— steady</span>
  } else if (delta > 0) {
    deltaEl = (
      <span style={{ color: 'var(--bde-success)' }}>▲ +{delta.toFixed(1)}% vs prior wk</span>
    )
  } else {
    deltaEl = <span style={{ color: 'var(--bde-danger)' }}>▼ {delta.toFixed(1)}% vs prior wk</span>
  }

  return (
    <div
      style={{
        position: 'relative',
        fontFamily: 'var(--bde-font-code)',
        fontSize: 10,
        color: 'var(--bde-text-muted)'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6
        }}
      >
        <div>
          <strong style={{ color: 'var(--bde-success)', fontSize: 20, fontWeight: 700 }}>
            {successRate7dAvg != null ? successRate7dAvg.toFixed(1) : '—'}%
          </strong>
          <span style={{ color: 'var(--bde-text-dim)', marginLeft: 6 }}>7d avg</span>
        </div>
        <div>{deltaEl}</div>
      </div>

      {/* Chart */}
      <svg
        viewBox={`0 0 ${SVG_W} ${height}`}
        width="100%"
        height={height}
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id="success-rate-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--bde-success)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--bde-success)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Axes */}
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={height - PAD.bottom}
          stroke="var(--bde-border)"
        />
        <line
          x1={PAD.left}
          y1={height - PAD.bottom}
          x2={SVG_W - PAD.right}
          y2={height - PAD.bottom}
          stroke="var(--bde-border)"
        />

        {/* Gridlines at 100% and 75% */}
        <line
          x1={PAD.left}
          y1={y(100)}
          x2={SVG_W - PAD.right}
          y2={y(100)}
          stroke="var(--bde-border)"
          strokeDasharray="2 3"
        />
        <line
          x1={PAD.left}
          y1={y(75)}
          x2={SVG_W - PAD.right}
          y2={y(75)}
          stroke="var(--bde-border)"
          strokeDasharray="2 3"
        />

        {/* Y-axis tick labels */}
        <text
          x={PAD.left - 6}
          y={y(100) + 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--bde-text-dim)"
        >
          100%
        </text>
        <text
          x={PAD.left - 6}
          y={y(75) + 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--bde-text-dim)"
        >
          75%
        </text>
        <text
          x={PAD.left - 6}
          y={height - PAD.bottom + 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--bde-text-dim)"
        >
          0%
        </text>

        {/* Gradient fill */}
        {fillPath && <path d={fillPath.trim()} fill="url(#success-rate-gradient)" />}

        {/* Trend line */}
        <path
          data-role="trend-line"
          d={trendPath.trim()}
          fill="none"
          stroke="var(--bde-success)"
          strokeWidth={1.5}
        />

        {/* Data points */}
        {data.map((d, i) => {
          if (d.successRate == null) return null
          const cx = data.length > 1 ? PAD.left + (i / (data.length - 1)) * plotW : PAD.left
          const cy = y(d.successRate)
          return (
            <circle
              key={i}
              data-testid={`point-${i}`}
              cx={cx}
              cy={cy}
              r={2.5}
              fill="var(--bde-success)"
              stroke="var(--bde-bg)"
              strokeWidth={1}
            />
          )
        })}

        {/* X-axis labels */}
        {xLabels.map(({ i, label }) => {
          const cx = data.length > 1 ? PAD.left + (i / (data.length - 1)) * plotW : PAD.left
          return (
            <text
              key={i}
              x={cx}
              y={height - 4}
              textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
              fontSize="9"
              fill="var(--bde-text-dim)"
            >
              {label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
