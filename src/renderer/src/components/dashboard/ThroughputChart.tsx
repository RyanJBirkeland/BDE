import { useMemo, useState, useRef, useEffect } from 'react'
import type { CompletionBucket } from '../../../../shared/ipc-channels'
import { neonVar } from '../neon/types'
import './ThroughputChart.css'

interface ThroughputChartProps {
  data: CompletionBucket[]
  height?: number | undefined
}

interface HourSlot {
  hour: string
  label: string
  successCount: number
  failedCount: number
  present: boolean
}

const NICE = [5, 10, 20, 50, 100, 200, 500, 1000]
const PAD = { top: 14, right: 10, bottom: 18, left: 32 }
const SVG_W = 520

function niceMax(peak: number): number {
  for (const n of NICE) if (peak <= n) return n
  return Math.ceil(peak / 100) * 100
}

function formatLocalHourIso(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00:00`
}

function buildScaffold(data: CompletionBucket[]): HourSlot[] {
  const byHour = new Map<string, CompletionBucket>()
  for (const d of data) byHour.set(d.hour, d)

  const now = new Date()
  now.setMinutes(0, 0, 0)
  const slots: HourSlot[] = []
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000)
    const iso = formatLocalHourIso(d)
    const bucket = byHour.get(iso)
    const h = d.getHours()
    const label = h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`
    slots.push({
      hour: iso,
      label,
      successCount: bucket?.successCount ?? 0,
      failedCount: bucket?.failedCount ?? 0,
      present: !!bucket
    })
  }
  return slots
}

export function ThroughputChart({ data, height = 140 }: ThroughputChartProps): React.JSX.Element {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [isNarrow, setIsNarrow] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setIsNarrow(width < 300)
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const slots = useMemo(() => buildScaffold(data), [data])
  const totals = useMemo(() => slots.map((s) => s.successCount + s.failedCount), [slots])
  const peak = Math.max(...totals, 0)
  const yMax = Math.max(niceMax(peak), 5)
  const lastHour = totals[totals.length - 1] ?? 0
  const sum = totals.reduce((a, b) => a + b, 0)
  const avg = sum / 24
  const peakIdx = totals.indexOf(peak)
  const peakLabel = peakIdx >= 0 ? (slots[peakIdx]?.label ?? '') : ''
  const allZero = sum === 0

  const plotW = SVG_W - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const barW = plotW / 24 - 2
  const cx = (i: number): number => PAD.left + (i * plotW) / 24 + 1
  const y = (v: number): number => PAD.top + plotH - (v / yMax) * plotH

  return (
    <div
      ref={containerRef}
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
            style={{ color: 'var(--bde-text)', fontSize: isNarrow ? 24 : 20, fontWeight: 700 }}
          >
            {lastHour}
          </strong>
          <span style={{ color: 'var(--bde-text-dim)', marginLeft: 6 }}> last hour</span>
        </div>
        <div style={{ color: 'var(--bde-text-dim)' }}>
          {avg.toFixed(1)}/hr avg · peak {peak} @ {peakLabel}
        </div>
      </div>
      {allZero ? (
        <div
          style={{
            height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--bde-text-dim)',
            border: '1px dashed var(--bde-border)',
            borderRadius: 4
          }}
        >
          No completions in the last 24h
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${SVG_W} ${height}`}
          width="100%"
          height={height}
          style={{ display: 'block' }}
        >
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
          <line
            x1={PAD.left}
            y1={y(yMax)}
            x2={SVG_W - PAD.right}
            y2={y(yMax)}
            stroke="var(--bde-border)"
            strokeDasharray="2 3"
          />
          <line
            x1={PAD.left}
            y1={y(yMax / 2)}
            x2={SVG_W - PAD.right}
            y2={y(yMax / 2)}
            stroke="var(--bde-border)"
            strokeDasharray="2 3"
          />
          <text
            x={PAD.left - 6}
            y={y(yMax) + 3}
            textAnchor="end"
            fontSize="9"
            fill="var(--bde-text-dim)"
            data-testid="y-max"
          >
            {yMax}
          </text>
          <text
            x={PAD.left - 6}
            y={y(yMax / 2) + 3}
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
          {slots.map((s, i) => {
            const total = s.successCount + s.failedCount
            const successH = plotH * (s.successCount / yMax)
            const failedH = plotH * (s.failedCount / yMax)
            return (
              <g
                key={i}
                data-role="hour-slot"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              >
                {total > 0 && (
                  <>
                    <rect
                      data-role="bar-success"
                      x={cx(i)}
                      y={y(s.successCount)}
                      width={barW}
                      height={successH}
                      fill={neonVar('cyan', 'color')}
                    />
                    {s.failedCount > 0 && (
                      <rect
                        data-role="bar-failed"
                        x={cx(i)}
                        y={y(s.successCount + s.failedCount)}
                        width={barW}
                        height={failedH}
                        fill={neonVar('red', 'color')}
                      />
                    )}
                  </>
                )}
                <rect x={cx(i)} y={PAD.top} width={barW} height={plotH} fill="transparent" />
              </g>
            )
          })}
          {[0, 6, 12, 18, 23].map((i) => (
            <text
              key={i}
              x={cx(i) + barW / 2}
              y={height - 4}
              textAnchor="middle"
              fontSize="9"
              fill="var(--bde-text-dim)"
            >
              {i === 23 ? 'now' : slots[i]?.label}
            </text>
          ))}
        </svg>
      )}
      {hoverIdx !== null && slots[hoverIdx] && !allZero && (
        <div
          style={{
            position: 'absolute',
            top: 32,
            right: 8,
            background: 'var(--bde-surface)',
            border: '1px solid var(--bde-border)',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 9,
            color: 'var(--bde-text)'
          }}
        >
          {slots[hoverIdx].label}: {slots[hoverIdx].successCount} done,{' '}
          {slots[hoverIdx].failedCount} failed
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 9, color: 'var(--bde-text-dim)' }}>
        <span style={{ color: neonVar('cyan', 'color') }}>▪ success</span>
        {'  '}
        <span style={{ color: neonVar('red', 'color') }}>▪ failed</span>
      </div>
    </div>
  )
}
