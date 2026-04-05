import { useState, useEffect, useRef } from 'react'
import { FolderKanban } from 'lucide-react'
import { Button } from '../ui/Button'
import { useTaskGroups } from '../../stores/taskGroups'
import { toast } from '../../stores/toasts'

interface AssignEpicPopoverProps {
  selectedTaskIds: Set<string>
  onAssignComplete: () => void
}

export function AssignEpicPopover({
  selectedTaskIds,
  onAssignComplete
}: AssignEpicPopoverProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const { groups, loadGroups, addTaskToGroup } = useTaskGroups()

  useEffect(() => {
    if (isOpen && groups.length === 0) {
      void loadGroups()
    }
  }, [isOpen, groups.length, loadGroups])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
    return undefined
  }, [isOpen])

  const handleAssign = async (): Promise<void> => {
    if (!selectedGroupId) {
      toast.error('Please select an epic')
      return
    }

    setLoading(true)
    try {
      const taskIds = Array.from(selectedTaskIds)
      let successCount = 0

      for (const taskId of taskIds) {
        try {
          await addTaskToGroup(taskId, selectedGroupId)
          successCount++
        } catch (err) {
          console.error(`Failed to add task ${taskId} to group:`, err)
        }
      }

      if (successCount > 0) {
        const groupName = groups.find((g) => g.id === selectedGroupId)?.name || 'epic'
        toast.success(`Added ${successCount} task${successCount > 1 ? 's' : ''} to ${groupName}`)
        onAssignComplete()
        setIsOpen(false)
        setSelectedGroupId('')
      } else {
        toast.error('Failed to add tasks to epic')
      }
    } catch (err) {
      toast.error(`Failed to assign tasks: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="assign-epic-popover" ref={popoverRef}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        disabled={selectedTaskIds.size === 0}
        title="Assign selected tasks to epic"
      >
        <FolderKanban size={14} />
        Assign to Epic
      </Button>

      {isOpen && (
        <div className="assign-epic-popover__dropdown">
          <div className="assign-epic-popover__header">Assign to Epic</div>
          <select
            className="assign-epic-popover__select"
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            disabled={loading}
          >
            <option value="">Select an epic...</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.icon} {group.name}
              </option>
            ))}
          </select>
          <div className="assign-epic-popover__actions">
            <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleAssign}
              disabled={!selectedGroupId || loading}
            >
              {loading ? 'Assigning...' : 'Assign'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
