import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Zap } from 'lucide-react'
import { useSprintTasks } from '../../stores/sprintTasks'
import { toast } from '../../stores/toasts'
import { TASK_STATUS } from '../../../../shared/constants'
import { SPRINGS, useReducedMotion } from '../../lib/motion'

interface QuickCreateBarProps {
  open: boolean
  onClose: () => void
  defaultRepo: string
}

export function QuickCreateBar({
  open,
  onClose,
  defaultRepo
}: QuickCreateBarProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const loadData = useSprintTasks((s) => s.loadData)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (open) {
      setTitle('')
      // Focus after animation
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const handleSubmit = useCallback(
    async (queue: boolean) => {
      const trimmed = title.trim()
      if (!trimmed || submitting) return

      setSubmitting(true)
      try {
        const status = queue ? TASK_STATUS.QUEUED : TASK_STATUS.BACKLOG
        await window.api.sprint.create({
          title: trimmed,
          repo: defaultRepo,
          prompt: trimmed,
          priority: 3,
          status
        })
        toast.success(queue ? 'Task queued' : 'Task added to backlog')
        setTitle('')
        onClose()
        loadData()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create task')
      } finally {
        setSubmitting(false)
      }
    },
    [title, submitting, defaultRepo, onClose, loadData]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit(e.metaKey || e.ctrlKey)
      }
    },
    [onClose, handleSubmit]
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="quick-create-bar"
          initial={{ opacity: 0, y: -32 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -32 }}
          transition={reduced ? { duration: 0 } : SPRINGS.snappy}
          data-testid="quick-create-bar"
        >
          <Plus size={14} className="quick-create-bar__icon" />
          <input
            ref={inputRef}
            type="text"
            className="quick-create-bar__input"
            placeholder="Task title — Enter to backlog, Cmd+Enter to queue"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={submitting}
            aria-label="Quick create task title"
          />
          <div className="quick-create-bar__hints">
            <span className="quick-create-bar__hint">
              <kbd>Enter</kbd> Backlog
            </span>
            <span className="quick-create-bar__hint quick-create-bar__hint--queue">
              <Zap size={10} />
              <kbd>Cmd+Enter</kbd> Queue
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
