import { CheckCircle2, Shield, TrendingUp } from 'lucide-react'
import type { JSX, ReactNode } from 'react'

interface Props {
  qualityScore?: number
  issuesCount?: number
  filesCount?: number
  loading?: boolean
}

export function ReviewMetricsRow({
  qualityScore,
  issuesCount,
  filesCount,
  loading = false
}: Props): JSX.Element {
  return (
    <div className="cr-metrics" role="group" aria-label="AI review metrics">
      <MetricCard
        icon={<CheckCircle2 size={16} />}
        value={loading || qualityScore === undefined ? '—' : qualityScore}
        label="Quality"
        ariaLabel={
          qualityScore !== undefined
            ? `Quality score ${qualityScore} out of 100`
            : 'Quality score pending'
        }
        variant="success"
      />
      <MetricCard
        icon={<Shield size={16} />}
        value={loading || issuesCount === undefined ? '—' : issuesCount}
        label="Issues"
        ariaLabel={
          issuesCount !== undefined ? `${issuesCount} issues found` : 'Issue count pending'
        }
        variant="warning"
      />
      <MetricCard
        icon={<TrendingUp size={16} />}
        value={loading || filesCount === undefined ? '—' : filesCount}
        label="Files"
        ariaLabel={filesCount !== undefined ? `${filesCount} files changed` : 'File count pending'}
        variant="info"
      />
    </div>
  )
}

function MetricCard({
  icon,
  value,
  label,
  ariaLabel,
  variant
}: {
  icon: ReactNode
  value: number | string
  label: string
  ariaLabel: string
  variant: 'success' | 'warning' | 'info'
}): JSX.Element {
  return (
    <div className={`cr-metric cr-metric--${variant}`} role="status" aria-label={ariaLabel}>
      <div className="cr-metric__icon">{icon}</div>
      <div className="cr-metric__value">{value}</div>
      <div className="cr-metric__label">{label}</div>
    </div>
  )
}
