import { useState, useRef, useEffect } from 'react'
import { Button } from '../ui/Button'

interface DiffCommentComposerProps {
  onSubmit: (body: string) => void
  onCancel: () => void
  initialBody?: string
}

export function DiffCommentComposer({
  onSubmit,
  onCancel,
  initialBody = ''
}: DiffCommentComposerProps) {
  const [body, setBody] = useState(initialBody)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = (): void => {
    const trimmed = body.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="diff-comment-composer">
      <textarea
        ref={textareaRef}
        className="diff-comment-composer__input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Leave a comment... (Cmd+Enter to submit)"
        rows={3}
      />
      <div className="diff-comment-composer__actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={!body.trim()}
        >
          Add review comment
        </Button>
      </div>
    </div>
  )
}
