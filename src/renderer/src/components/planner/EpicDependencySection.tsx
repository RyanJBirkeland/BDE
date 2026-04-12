/**
 * EpicDependencySection — displays and manages epic dependencies in the Planner's EpicDetail panel.
 * Shows upstream epics that this epic depends on, with add/remove/edit controls.
 */
import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import type { TaskGroup, EpicDependency } from '../../../../shared/types'
import { EpicDependencyRow } from './EpicDependencyRow'
import { AddEpicDependencyModal } from './AddEpicDependencyModal'
import './EpicDependencySection.css'

export interface EpicDependencySectionProps {
  group: TaskGroup
  allGroups: TaskGroup[]
  onAddDependency: (dep: EpicDependency) => Promise<void>
  onRemoveDependency: (upstreamId: string) => Promise<void>
  onUpdateCondition: (upstreamId: string, condition: EpicDependency['condition']) => Promise<void>
}

export function EpicDependencySection({
  group,
  allGroups,
  onAddDependency,
  onRemoveDependency,
  onUpdateCondition
}: EpicDependencySectionProps): React.JSX.Element {
  const [showAddModal, setShowAddModal] = useState(false)

  const dependencies = group.depends_on ?? []
  const isEmpty = dependencies.length === 0

  return (
    <>
      <div className="epic-deps">
        <div className="epic-deps__header">
          <h3 className="epic-deps__title">Depends on</h3>
          <button
            type="button"
            className="epic-deps__add-btn"
            onClick={() => setShowAddModal(true)}
            aria-label="Add epic dependency"
          >
            <Plus size={14} />
            <span>Add Epic</span>
          </button>
        </div>

        {isEmpty ? (
          <p className="epic-deps__empty">
            No upstream epics. This epic&apos;s tasks can run as soon as they&apos;re queued.
          </p>
        ) : (
          <div className="epic-deps__list">
            {dependencies.map((dep) => (
              <EpicDependencyRow
                key={dep.id}
                dependency={dep}
                upstreamEpic={allGroups.find((g) => g.id === dep.id)}
                onRemove={() => onRemoveDependency(dep.id)}
                onUpdateCondition={(condition) => onUpdateCondition(dep.id, condition)}
              />
            ))}
          </div>
        )}
      </div>

      <AddEpicDependencyModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        currentEpic={group}
        allGroups={allGroups}
        onAdd={onAddDependency}
      />
    </>
  )
}
