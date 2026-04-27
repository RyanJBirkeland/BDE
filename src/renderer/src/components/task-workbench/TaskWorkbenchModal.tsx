import { useCallback, useEffect, useRef } from 'react'
import { useTaskWorkbenchModalStore } from '../../stores/taskWorkbenchModal'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { useCopilotStore } from '../../stores/copilot'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import { Modal } from '../ui/Modal'
import { TaskWorkbench } from './TaskWorkbench'

const DISCARD_CONFIRM = {
  title: 'Discard changes?',
  message: 'You have unsaved changes to this task. Discard them?',
  confirmLabel: 'Discard',
  variant: 'danger' as const
}

export function TaskWorkbenchModal(): React.JSX.Element {
  const open = useTaskWorkbenchModalStore((s) => s.open)
  const editingTask = useTaskWorkbenchModalStore((s) => s.editingTask)
  const close = useTaskWorkbenchModalStore((s) => s.close)
  const wasOpenRef = useRef(false)
  const { confirm, confirmProps } = useConfirm()

  // Reset the form on transition from open → closed so the next open starts
  // clean and the persisted draft is cleared when the user dismissed without
  // saving. Skip the very first render when the modal has never been opened.
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true
      return
    }
    if (!wasOpenRef.current) return
    useTaskWorkbenchStore.getState().resetForm()
    const copilot = useCopilotStore.getState()
    if (copilot.visible) copilot.toggleVisible()
  }, [open])

  const requestDismiss = useCallback(async () => {
    const dirty = useTaskWorkbenchStore.getState().isDirty()
    if (!dirty) {
      close()
      return
    }
    const confirmed = await confirm(DISCARD_CONFIRM)
    if (confirmed) close()
  }, [close, confirm])

  const title = editingTask ? formatEditTitle(editingTask.title) : 'New Task'

  return (
    <>
      <Modal
        open={open}
        onClose={() => void requestDismiss()}
        title={title}
        size="lg"
        className="task-workbench-modal"
      >
        <TaskWorkbench onSubmitted={close} />
      </Modal>
      <ConfirmModal {...confirmProps} />
    </>
  )
}

function formatEditTitle(taskTitle: string): string {
  const trimmed = taskTitle.trim()
  const truncated = trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed
  return `Edit: ${truncated}`
}
