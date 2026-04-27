/**
 * EpicDependencyRow — displays a single epic dependency with controls to edit condition or remove.
 * Shows upstream epic's accent dot, name, and condition selector.
 */
import React, { useState } from 'react'
import { X } from 'lucide-react'
import type { EpicDependency, TaskGroup } from '../../../../shared/types'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import './EpicDependencySection.css'

export interface EpicDependencyRowProps {
  dependency: EpicDependency
  upstreamEpic: TaskGroup | undefined
  onRemove: () => Promise<void>
  onUpdateCondition: (condition: EpicDependency['condition']) => Promise<void>
}

const CONDITION_LABELS: Record<EpicDependency['condition'], string> = {
  on_success: 'On success',
  always: 'Any outcome',
  manual: 'Manual checkpoint'
}

export function EpicDependencyRow({
  dependency,
  upstreamEpic,
  onRemove,
  onUpdateCondition
}: EpicDependencyRowProps): React.JSX.Element {
  const [removing, setRemoving] = useState(false)
  const { confirm, confirmProps } = useConfirm()

  const handleRemove = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Remove dependency?',
      message: `Remove dependency on "${upstreamEpic?.name ?? 'Unknown epic'}"?`,
      confirmLabel: 'Remove',
      variant: 'danger'
    })

    if (!confirmed) return

    setRemoving(true)
    try {
      await onRemove()
    } finally {
      setRemoving(false)
    }
  }

  const handleConditionChange = async (e: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
    const newCondition = e.target.value as EpicDependency['condition']
    if (newCondition !== dependency.condition) {
      await onUpdateCondition(newCondition)
    }
  }

  const accentColor = upstreamEpic?.accent_color ?? 'var(--fleet-text-dim)'
  const epicName = upstreamEpic?.name ?? `Unknown (${dependency.id.slice(0, 8)})`

  return (
    <>
      <div className="epic-dep-row">
        <div
          className="epic-dep-row__dot"
          style={{ backgroundColor: accentColor }}
          aria-hidden="true"
        />
        <span className="epic-dep-row__name">{epicName}</span>
        <select
          className="epic-dep-row__condition"
          value={dependency.condition}
          onChange={(e) => void handleConditionChange(e)}
          aria-label={`Condition for dependency on ${epicName}`}
        >
          {Object.entries(CONDITION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="epic-dep-row__remove"
          onClick={() => void handleRemove()}
          disabled={removing}
          aria-label={`Remove dependency on ${epicName}`}
        >
          <X size={14} />
        </button>
      </div>
      <ConfirmModal {...confirmProps} />
    </>
  )
}
