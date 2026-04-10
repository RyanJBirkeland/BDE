import type { SprintTask } from '../../../../shared/types'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { SpecPanel } from './SpecPanel'
import { DoneHistoryPanel } from './DoneHistoryPanel'
import { ConflictDrawer } from './ConflictDrawer'
import { HealthCheckDrawer } from './HealthCheckDrawer'

import './PipelineOverlays.css'

interface PipelineOverlaysProps {
  specPanelOpen: boolean
  selectedTask: SprintTask | null
  onCloseSpec: () => void
  onSaveSpec: (taskId: string, newSpec: string) => Promise<void>

  doneViewOpen: boolean
  doneTasks: SprintTask[]
  onCloseDoneView: () => void
  onTaskClick: (id: string) => void

  conflictDrawerOpen: boolean
  conflictingTasks: SprintTask[]
  onCloseConflict: () => void

  healthCheckDrawerOpen: boolean
  visibleStuckTasks: SprintTask[]
  onCloseHealthCheck: () => void
  onDismissStuckTask: (taskId: string) => void

  confirmProps: ReturnType<typeof useConfirm>['confirmProps']
}

export function PipelineOverlays({
  specPanelOpen,
  selectedTask,
  onCloseSpec,
  onSaveSpec,
  doneViewOpen,
  doneTasks,
  onCloseDoneView,
  onTaskClick,
  conflictDrawerOpen,
  conflictingTasks,
  onCloseConflict,
  healthCheckDrawerOpen,
  visibleStuckTasks,
  onCloseHealthCheck,
  onDismissStuckTask,
  confirmProps
}: PipelineOverlaysProps): React.JSX.Element {
  return (
    <>
      {specPanelOpen && selectedTask?.spec && (
        <SpecPanel
          taskTitle={selectedTask.title}
          spec={selectedTask.spec}
          onClose={onCloseSpec}
          onSave={(newSpec) => onSaveSpec(selectedTask.id, newSpec)}
        />
      )}

      {doneViewOpen && (
        <DoneHistoryPanel tasks={doneTasks} onTaskClick={onTaskClick} onClose={onCloseDoneView} />
      )}

      <ConfirmModal {...confirmProps} />

      <ConflictDrawer
        open={conflictDrawerOpen}
        tasks={conflictingTasks}
        onClose={onCloseConflict}
      />

      <HealthCheckDrawer
        open={healthCheckDrawerOpen}
        tasks={visibleStuckTasks}
        onClose={onCloseHealthCheck}
        onDismiss={onDismissStuckTask}
      />
    </>
  )
}
