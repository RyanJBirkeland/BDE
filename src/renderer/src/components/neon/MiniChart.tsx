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

export function MiniChart({ data, height = 80 }: MiniChartProps) {
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

  const maxValue = Math.max(...data.map((d) => d.value), 1)

  return (
    <div
      style={{
        display: 'flex',
        gap: '3px',
        alignItems: 'flex-end',
        height
      }}
    >
      {data.map((bar, i) => {
        const accent = bar.accent ?? 'purple'
        const pct = Math.round((bar.value / maxValue) * 100)
        return (
          <div
            key={i}
            data-role="chart-bar"
            title={bar.label ?? `${bar.value}`}
            style={{
              flex: 1,
              height: `${pct}%`,
              background: `linear-gradient(to top, ${neonVar(accent, 'color')}, transparent)`,
              borderRadius: '3px 3px 0 0',
              minHeight: '2px',
              transition: 'height 300ms ease'
            }}
          />
        )
      })}
    </div>
  )
}
