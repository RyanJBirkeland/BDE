import { useState, useCallback } from 'react'
import type { PromptTemplate } from '../../lib/launchpad-types'

interface LaunchpadReviewProps {
  template: PromptTemplate | null
  assembledPrompt: string
  answers: Record<string, string>
  repo: string
  model: string
  onSpawn: (finalPrompt: string) => void
  onBack: () => void
  onSaveTemplate: () => void
  spawning: boolean
}

export function LaunchpadReview({
  template,
  assembledPrompt,
  answers,
  repo,
  model,
  onSpawn,
  onBack,
  onSaveTemplate,
  spawning
}: LaunchpadReviewProps) {
  const [editing, setEditing] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState(assembledPrompt)

  const handleSpawn = useCallback(() => {
    onSpawn(editing ? editedPrompt : assembledPrompt)
  }, [editing, editedPrompt, assembledPrompt, onSpawn])

  // Build param cards from answers + repo + model
  const paramCards: { label: string; value: string }[] = [
    { label: 'Repository', value: repo },
    { label: 'Model', value: model.charAt(0).toUpperCase() + model.slice(1) },
    ...Object.entries(answers).map(([key, value]) => ({
      label: key.charAt(0).toUpperCase() + key.slice(1),
      value
    }))
  ]

  return (
    <div className="launchpad" data-testid="launchpad-review">
      <div className="launchpad__review">
        {/* Header */}
        <div className="launchpad__review-header">
          <button type="button" className="launchpad__back" onClick={onBack} title="Back">
            &#x2190;
          </button>
          <div className="launchpad__review-badge">
            {template && <span>{template.icon}</span>}
            Review{template ? ` — ${template.name}` : ''}
          </div>
        </div>

        {/* Param Grid */}
        <div className="launchpad__param-grid">
          {paramCards.map((p) => (
            <div key={p.label} className="launchpad__param-card">
              <div className="launchpad__param-label">{p.label}</div>
              <div className="launchpad__param-value">{p.value}</div>
            </div>
          ))}
        </div>

        {/* Spec Block */}
        <div className="launchpad__spec-block">
          <button
            type="button"
            className="launchpad__spec-edit"
            onClick={() => {
              if (!editing) setEditedPrompt(assembledPrompt)
              setEditing(!editing)
            }}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
          <div className="launchpad__spec-label">Generated Prompt</div>
          {editing ? (
            <textarea
              className="launchpad__spec-textarea"
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
            />
          ) : (
            <div className="launchpad__spec-content">{assembledPrompt}</div>
          )}
        </div>

        {/* Actions */}
        <div className="launchpad__review-actions">
          <button type="button" className="launchpad__btn-ghost" onClick={onBack}>
            &#x2190; Back
          </button>
          <button type="button" className="launchpad__btn-ghost" onClick={onSaveTemplate}>
            Save as Template
          </button>
          <button
            type="button"
            className="launchpad__btn-spawn"
            onClick={handleSpawn}
            disabled={spawning}
          >
            {spawning ? 'Spawning...' : '\u26A1 Spawn Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
