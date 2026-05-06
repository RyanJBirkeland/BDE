import React from 'react'
import type { SprintTask } from '../../../../shared/types'
import { DrawerSection } from './primitives/DrawerSection'

interface TaskDrawerOperatorActionsProps {
  task: SprintTask
  onMarkFailed: () => void
  onForceDone: () => void
  onForceRelease: () => void
}

export function TaskDrawerOperatorActions({
  task,
  onMarkFailed,
  onForceDone,
  onForceRelease
}: TaskDrawerOperatorActionsProps): React.JSX.Element | null {
  const showMarkFailed = FORCE_FAIL_VISIBLE_STATUSES.has(task.status)
  const showForceDone = task.status !== 'done'
  const showForceRelease = task.status === 'active' && !!task.claimed_by

  const hasAnyButton = showMarkFailed || showForceDone || showForceRelease
  if (!hasAnyButton) return null

  return (
    <DrawerSection eyebrow="OPS" title="Override">
      <div
        data-testid="task-drawer-override"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-1)' }}
      >
        {showForceRelease && (
          <OverrideButton
            testId="task-drawer-force-release"
            label="Force Release"
            onClick={onForceRelease}
          />
        )}
        {showMarkFailed && (
          <OverrideButton
            testId="task-drawer-mark-failed"
            label="Mark Failed"
            onClick={onMarkFailed}
          />
        )}
        {showForceDone && (
          <OverrideButton
            testId="task-drawer-force-done"
            label="Force Done"
            onClick={onForceDone}
          />
        )}
      </div>
    </DrawerSection>
  )
}

// --- Private helpers ---

const FORCE_FAIL_VISIBLE_STATUSES: ReadonlySet<SprintTask['status']> = new Set([
  'queued',
  'active',
  'blocked'
])

interface OverrideButtonProps {
  testId: string
  label: string
  onClick: () => void
}

function OverrideButton({ testId, label, onClick }: OverrideButtonProps): React.JSX.Element {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      style={{
        flex: 1,
        height: 26,
        padding: '0 var(--s-2)',
        background: 'transparent',
        color: 'var(--st-failed)',
        border: '1px solid color-mix(in oklch, var(--st-failed) 30%, transparent)',
        borderRadius: 'var(--r-md)',
        fontSize: 11,
        cursor: 'pointer'
      }}
    >
      {label}
    </button>
  )
}
