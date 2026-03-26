import { useMemo } from 'react'
import { DollarSign } from 'lucide-react'
import { DashboardCard } from './DashboardCard'
import { useCostDataStore } from '../../stores/costData'
import { tokens } from '../../design-system/tokens'

function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

export function CostSummaryCard(): React.JSX.Element {
  const localAgents = useCostDataStore((s) => s.localAgents)
  const totalCost = useCostDataStore((s) => s.totalCost)

  const avgCost = useMemo(() => {
    const withCost = localAgents.filter((a) => (a.costUsd ?? 0) > 0)
    if (withCost.length === 0) return 0
    return withCost.reduce((sum, a) => sum + (a.costUsd ?? 0), 0) / withCost.length
  }, [localAgents])

  const stats = [
    { label: 'Total Cost', value: formatCost(totalCost) },
    { label: 'Runs', value: String(localAgents.length) },
    { label: 'Avg / Run', value: formatCost(avgCost) }
  ]

  return (
    <DashboardCard title="Cost Summary" icon={<DollarSign size={14} aria-hidden="true" />}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '1px',
          background: tokens.color.border
        }}
      >
        {stats.map(({ label, value }) => (
          <div
            key={label}
            style={{
              background: tokens.color.surface,
              padding: `${tokens.space[3]} ${tokens.space[4]}`,
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[1]
            }}
          >
            <span
              style={{
                fontSize: tokens.size.xs,
                color: tokens.color.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}
            >
              {label}
            </span>
            <span
              style={{
                fontSize: tokens.size.xl,
                fontWeight: 600,
                color: tokens.color.text,
                fontFamily: tokens.font.code
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </DashboardCard>
  )
}
