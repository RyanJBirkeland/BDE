import { useState } from 'react'
import { Button } from '../ui/Button'

type BulkActionBarProps = {
  selectedCount: number
  onSetPriority: (priority: number) => void
  onDelete: () => void
  onMarkDone: () => void
  onClearSelection: () => void
}

export function BulkActionBar({
  selectedCount,
  onSetPriority,
  onDelete,
  onMarkDone,
  onClearSelection
}: BulkActionBarProps) {
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  if (selectedCount === 0) {
    return null
  }

  const handlePrioritySelect = (priority: number) => {
    onSetPriority(priority)
    setShowPriorityDropdown(false)
  }

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true)
  }

  const handleDeleteConfirm = () => {
    onDelete()
    setShowDeleteConfirm(false)
  }

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false)
  }

  return (
    <div className="bulk-action-bar">
      <div className="bulk-action-bar__info">
        <span className="bulk-action-bar__count">{selectedCount} selected</span>
        <button
          className="bulk-action-bar__clear"
          onClick={onClearSelection}
          aria-label="Clear selection"
        >
          ×
        </button>
      </div>

      <div className="bulk-action-bar__actions">
        <div className="bulk-action-bar__priority-dropdown">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPriorityDropdown(!showPriorityDropdown)}
          >
            Set Priority ▾
          </Button>
          {showPriorityDropdown && (
            <div className="bulk-action-bar__dropdown-menu">
              {[1, 2, 3, 4, 5].map((priority) => (
                <button
                  key={priority}
                  className="bulk-action-bar__dropdown-item"
                  onClick={() => handlePrioritySelect(priority)}
                >
                  P{priority}
                </button>
              ))}
            </div>
          )}
        </div>

        <Button variant="ghost" size="sm" onClick={onMarkDone}>
          ✓ Mark Done
        </Button>

        <Button variant="danger" size="sm" onClick={handleDeleteClick}>
          Delete
        </Button>
      </div>

      {showDeleteConfirm && (
        <div className="bulk-action-bar__confirm-overlay">
          <div className="bulk-action-bar__confirm-dialog">
            <p className="bulk-action-bar__confirm-message">
              Are you sure you want to delete {selectedCount} task{selectedCount > 1 ? 's' : ''}?
            </p>
            <div className="bulk-action-bar__confirm-actions">
              <Button variant="danger" size="sm" onClick={handleDeleteConfirm}>
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDeleteCancel}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
