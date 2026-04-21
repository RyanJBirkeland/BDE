import { useMemo } from 'react'
import type { LoadSample } from '../../../../shared/ipc-channels'
import './LoadAverageChart.css'

interface LoadAverageChartProps {
  samples: LoadSample[]
  cpuCount: number
  height?: number | undefined
}

const SVG_W = 520
const PAD = { top: 20, right: 10, bottom: 18, left: 36 }
const NICE = [4, 8, 16, 32, 64, 128, 256, 512, 1024]

function niceMax(peak: number): number {
  for (const n of NICE) if (peak <= n) return n
  return Math.ceil(peak / 100) * 100
}

type Severity = 'green' | 'amber' | 'red'
type Trend = 'cooling' | 'steady' | 'climbing'

function severityOf(load1: number, cpuCount: number): Severity {
  if (load1 < cpuCount) return 'green'
  if (load1 < 2 * cpuCount) return 'amber'
  return 'red'
}

function trendOf(load1: number, load5: number): Trend {
  if (load1 < load5) return 'cooling'
  if (load5 > 0 && load1 > load5 * 1.05) return 'climbing'
  return 'steady'
}

function severityColor(sev: Severity): string {
  if (sev === 'green') return 'var(--bde-success)'
  if (sev === 'amber') return 'var(--bde-warning)'
  return 'var(--bde-danger)'
}

const LINE1_COLOR = 'var(--bde-danger)'
const LINE5_COLOR = 'var(--bde-accent)'
const LINE15_COLOR = 'var(--bde-text-dim)'
const SATURATION_COLOR = 'var(--bde-warning)'

export function LoadAverageChart({
  samples,
  cpuCount,
  height = 140
}: LoadAverageChartProps): React.JSX.Element {
  const latest = samples.length > 0 ? samples[samples.length - 1] : null

  const yMax = useMemo(() => {
    const floor = Math.max(cpuCount * 1.5, 4)
    if (samples.length === 0) return floor
    const peak = Math.max(...samples.flatMap((s) => [s.load1, s.load5, s.load15]))
    return Math.max(floor, niceMax(peak))
  }, [samples, cpuCount])

  if (samples.length < 2 || !latest) {
    return (
      <div className="load-average-chart__empty">
        <div className="load-average-chart__empty-placeholder" style={{ height }}>
          Collecting samples...
        </div>
      </div>
    )
  }

  const sev = severityOf(latest.load1, cpuCount)
  const trend = trendOf(latest.load1, latest.load5)

  const plotW = SVG_W - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  const xOf = (i: number): number =>
    samples.length === 1 ? PAD.left + plotW / 2 : PAD.left + (i / (samples.length - 1)) * plotW
  const yOf = (v: number): number => PAD.top + plotH - (v / yMax) * plotH

  const buildPath = (key: 'load1' | 'load5' | 'load15'): string => {
    return samples
      .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)},${yOf(s[key]).toFixed(1)}`)
      .join(' ')
  }

  const saturationY = yOf(cpuCount)

  const trendLabel =
    trend === 'cooling' ? '▼ cooling' : trend === 'climbing' ? '▲ climbing' : '— steady'
  const trendColor =
    trend === 'cooling'
      ? 'var(--bde-success)'
      : trend === 'climbing'
        ? 'var(--bde-danger)'
        : 'var(--bde-text-dim)'

  return (
    <div
      style={{
        position: 'relative',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 10,
        color: 'var(--bde-text-muted)'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6
        }}
      >
        <div>
          <strong
            data-testid="load-value"
            className={`load-chart__value load-chart__value--${sev}`}
            style={{ color: severityColor(sev), fontSize: 20, fontWeight: 700 }}
          >
            {latest.load1.toFixed(2)}
          </strong>
          <span style={{ color: 'var(--bde-text-dim)', marginLeft: 6 }}>1-min</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: trendColor, fontSize: 10 }}>{trendLabel}</div>
          <div style={{ color: 'var(--bde-text-dim)', fontSize: 9 }}>
            {latest.load5.toFixed(2)} · {latest.load15.toFixed(2)} (5m · 15m)
          </div>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${SVG_W} ${height}`}
        width="100%"
        height={height}
        style={{ display: 'block' }}
      >
        {/* axes */}
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
        {/* gridlines */}
        <line
          x1={PAD.left}
          y1={yOf(yMax)}
          x2={SVG_W - PAD.right}
          y2={yOf(yMax)}
          stroke="var(--bde-border)"
          strokeDasharray="2 3"
        />
        <line
          x1={PAD.left}
          y1={yOf(yMax / 2)}
          x2={SVG_W - PAD.right}
          y2={yOf(yMax / 2)}
          stroke="var(--bde-border)"
          strokeDasharray="2 3"
        />
        {/* Y tick labels */}
        <text
          x={PAD.left - 6}
          y={yOf(yMax) + 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--bde-text-dim)"
          data-testid="y-max-value"
        >
          {yMax}
        </text>
        <text
          x={PAD.left - 6}
          y={yOf(yMax / 2) + 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--bde-text-dim)"
        >
          {yMax / 2}
        </text>
        <text
          x={PAD.left - 6}
          y={height - PAD.bottom + 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--bde-text-dim)"
        >
          0
        </text>
        {/* Saturation reference line */}
        <line
          data-role="saturation-line"
          x1={PAD.left}
          y1={saturationY}
          x2={SVG_W - PAD.right}
          y2={saturationY}
          stroke={SATURATION_COLOR}
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.6"
        />
        <text
          x={PAD.left - 6}
          y={saturationY + 3}
          textAnchor="end"
          fontSize="9"
          fill={SATURATION_COLOR}
        >
          {cpuCount}
        </text>
        {/* Lines (draw 15 first, then 5, then 1 so 1-min is on top) */}
        <path
          data-role="line-15min"
          d={buildPath('load15')}
          stroke={LINE15_COLOR}
          strokeWidth="1.5"
          fill="none"
        />
        <path
          data-role="line-5min"
          d={buildPath('load5')}
          stroke={LINE5_COLOR}
          strokeWidth="1.5"
          fill="none"
          opacity="0.6"
        />
        <path
          data-role="line-1min"
          d={buildPath('load1')}
          stroke={LINE1_COLOR}
          strokeWidth="2"
          fill="none"
        />
        {/* X-axis labels: -10m, -5m, now */}
        <text
          x={PAD.left}
          y={height - 4}
          textAnchor="start"
          fontSize="9"
          fill="var(--bde-text-dim)"
        >
          -10m
        </text>
        <text
          x={PAD.left + plotW / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize="9"
          fill="var(--bde-text-dim)"
        >
          -5m
        </text>
        <text
          x={SVG_W - PAD.right}
          y={height - 4}
          textAnchor="end"
          fontSize="9"
          fill="var(--bde-text-dim)"
        >
          now
        </text>
      </svg>
      <div style={{ marginTop: 6, fontSize: 9, color: 'var(--bde-text-dim)' }}>
        <span style={{ color: LINE1_COLOR }}>▪ 1-min</span>
        {'   '}
        <span style={{ color: LINE5_COLOR }}>▪ 5-min</span>
        {'   '}
        <span style={{ color: LINE15_COLOR }}>▪ 15-min</span>
        {'   ·   '}
        <span style={{ color: SATURATION_COLOR }}>▪ cores (saturation)</span>
      </div>
    </div>
  )
}
