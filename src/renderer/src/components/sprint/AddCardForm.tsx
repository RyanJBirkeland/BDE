import { useState, useRef, useEffect } from 'react'
import { Button } from '../ui/Button'
import { REPO_OPTIONS } from '../../lib/constants'

type AddCardFormProps = {
  onSubmit: (data: { title: string; repo: string; description: string }) => void
}

export function AddCardForm({ onSubmit }: AddCardFormProps) {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState('')
  const [repo, setRepo] = useState<string>(REPO_OPTIONS[0].label)
  const [description, setDescription] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  const handleSubmit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    onSubmit({ title: trimmed, repo, description: description.trim() })
    setTitle('')
    setDescription('')
    // stay expanded for rapid entry
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      setExpanded(false)
      setTitle('')
      setDescription('')
    }
  }

  if (!expanded) {
    return (
      <div className="add-card" onClick={() => setExpanded(true)}>
        + Add Card
      </div>
    )
  }

  return (
    <div className="add-card add-card--expanded" onKeyDown={handleKeyDown}>
      <input
        ref={inputRef}
        className="sprint-tasks__input"
        placeholder="Task title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="add-card__row">
        <select
          className="sprint-tasks__select"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        >
          {REPO_OPTIONS.map((r) => (
            <option key={r.label} value={r.label}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="sprint-tasks__textarea"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
      />
      <div className="add-card__actions">
        <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!title.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}
