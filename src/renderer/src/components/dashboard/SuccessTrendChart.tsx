import { useMemo } from 'react'
import { MiniChart, type ChartBar } from '../neon'

interface DailySuccessRate {
  date: string
  successRate: number | null
  doneCount: number
  failedCount: number
}

interface SuccessTrendChartProps {
  data: DailySuccessRate[]
}

/**
 * Format a date string (YYYY-MM-DD) to a short readable label (e.g., "3/15").
 */
function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00') // Avoid timezone offset issues
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 14-day success rate trend chart using MiniChart.
 * Shows daily success rate percentage with null handling for days with no data.
 */
export function SuccessTrendChart({ data }: SuccessTrendChartProps): React.JSX.Element {
  const chartData = useMemo((): ChartBar[] => {
    return data.map((day) => ({
      value: day.successRate ?? 0, // Treat null as 0 for visual consistency
      accent: 'cyan' as const,
      label: `${formatDateLabel(day.date)}: ${day.successRate != null ? day.successRate.toFixed(1) + '%' : 'no data'} (${day.doneCount} done, ${day.failedCount} failed)`
    }))
  }, [data])

  return (
    <>
      <MiniChart data={chartData} height={120} />
      <div className="dashboard-chart-caption">success rate per day, last 14 days</div>
    </>
  )
}
