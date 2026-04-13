import { Shield, TrendingUp, Zap } from 'lucide-react'
import type { JSX } from 'react'

interface Props {
  onAction: (prompt: string) => void
  disabled?: boolean
}

const ACTIONS = [
  {
    label: 'Explain security issues',
    icon: Shield,
    prompt:
      'Walk me through any security risks you see in this diff. Cite specific files and lines where possible.'
  },
  {
    label: 'Performance analysis',
    icon: TrendingUp,
    prompt:
      'Analyze this change for performance regressions or improvements. Focus on hot paths and allocations.'
  },
  {
    label: 'Suggest improvements',
    icon: Zap,
    prompt: 'What would you change about this diff before merging? Rank suggestions by impact.'
  }
] as const

export function ReviewQuickActions({ onAction, disabled = false }: Props): JSX.Element {
  return (
    <div className="cr-quick-actions">
      <div className="cr-quick-actions__label">Quick actions:</div>
      {ACTIONS.map(({ label, icon: Icon, prompt }) => (
        <button
          key={label}
          type="button"
          className="cr-quick-actions__chip"
          onClick={() => onAction(prompt)}
          disabled={disabled}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
