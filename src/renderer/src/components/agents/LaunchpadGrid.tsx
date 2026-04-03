import { useState, useCallback } from 'react'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import { CLAUDE_MODELS } from '../../../../shared/models'
import type { PromptTemplate } from '../../lib/launchpad-types'
import type { NeonAccent } from '../neon/types'
import { Play } from 'lucide-react'

interface LaunchpadGridProps {
  templates: PromptTemplate[]
  onSelectTemplate: (template: PromptTemplate, repo: string, model: string) => void
  onCustomPrompt: (prompt: string, repo: string, model: string) => void
  spawning: boolean
}

const ACCENT_VARS: Record<
  NeonAccent,
  { bg: string; border: string; color: string; glow: string; hover: string }
> = {
  cyan: {
    bg: 'rgba(0,255,255,0.06)',
    border: 'var(--neon-cyan-border)',
    color: 'var(--neon-cyan)',
    glow: 'rgba(0,255,255,0.15)',
    hover: 'rgba(0,255,255,0.3)'
  },
  pink: {
    bg: 'rgba(255,0,255,0.06)',
    border: 'var(--neon-pink-border)',
    color: 'var(--neon-pink)',
    glow: 'rgba(255,0,255,0.15)',
    hover: 'rgba(255,0,255,0.3)'
  },
  blue: {
    bg: 'rgba(100,100,255,0.06)',
    border: 'var(--neon-blue-border)',
    color: 'var(--neon-blue)',
    glow: 'rgba(100,100,255,0.15)',
    hover: 'rgba(100,100,255,0.3)'
  },
  purple: {
    bg: 'rgba(138,43,226,0.06)',
    border: 'var(--neon-purple-border)',
    color: 'var(--neon-purple)',
    glow: 'rgba(138,43,226,0.15)',
    hover: 'rgba(138,43,226,0.3)'
  },
  orange: {
    bg: 'rgba(255,165,0,0.06)',
    border: 'var(--neon-orange-border)',
    color: 'var(--neon-orange)',
    glow: 'rgba(255,165,0,0.15)',
    hover: 'rgba(255,165,0,0.3)'
  },
  red: {
    bg: 'rgba(255,80,80,0.06)',
    border: 'var(--neon-red-border)',
    color: 'var(--neon-red)',
    glow: 'rgba(255,80,80,0.15)',
    hover: 'rgba(255,80,80,0.3)'
  }
}

export function LaunchpadGrid({
  templates,
  onSelectTemplate,
  onCustomPrompt,
  spawning
}: LaunchpadGridProps): React.JSX.Element {
  const repos = useRepoOptions()
  const [prompt, setPrompt] = useState('')
  const [repo, setRepo] = useState(repos[0]?.label ?? '')
  const [model, setModel] = useState('sonnet')

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && prompt.trim()) {
        e.preventDefault()
        onCustomPrompt(prompt.trim(), repo, model)
      }
    },
    [prompt, repo, model, onCustomPrompt]
  )

  const handleSubmit = useCallback(() => {
    if (prompt.trim()) {
      onCustomPrompt(prompt.trim(), repo, model)
    }
  }, [prompt, repo, model, onCustomPrompt])

  return (
    <div className="launchpad" data-testid="launchpad-grid">
      {/* Header */}
      <div className="launchpad__header">
        <div className="launchpad__header-dot" />
        <span className="launchpad__header-title">New Session</span>
      </div>

      {/* Quick Actions */}
      <div className="launchpad__section-label">Quick Actions</div>
      <div className="launchpad__tile-grid">
        {templates.map((t) => {
          const vars = ACCENT_VARS[t.accent]
          return (
            <button
              key={t.id}
              type="button"
              className="launchpad__tile"
              disabled={spawning}
              style={
                {
                  '--tile-bg': vars.bg,
                  '--tile-border': vars.border,
                  '--tile-color': vars.color,
                  '--tile-glow': vars.glow,
                  '--tile-hover-border': vars.hover
                } as React.CSSProperties
              }
              onClick={() => onSelectTemplate(t, repo, model)}
            >
              <div className="launchpad__tile-icon">{t.icon}</div>
              <div className="launchpad__tile-name">{t.name}</div>
              <div className="launchpad__tile-desc">{t.description}</div>
            </button>
          )
        })}
      </div>

      {/* Repo / Model defaults */}
      <div className="launchpad__defaults-row">
        <button
          type="button"
          className="launchpad__repo-chip"
          onClick={() => {
            const idx = repos.findIndex((r) => r.label === repo)
            setRepo(repos[(idx + 1) % repos.length]?.label ?? repos[0]?.label ?? '')
          }}
        >
          <div className="launchpad__repo-dot" />
          {repo} &#x25BE;
        </button>
        <div className="launchpad__model-pills">
          {CLAUDE_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`launchpad__model-pill ${model === m.id ? 'launchpad__model-pill--active' : ''}`}
              onClick={() => setModel(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Input */}
      <div className="launchpad__prompt-bar">
        <textarea
          className="launchpad__prompt-input"
          placeholder="What would you like to work on?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={spawning}
        />
        <button
          type="button"
          className="launchpad__submit-btn"
          onClick={handleSubmit}
          disabled={spawning || !prompt.trim()}
          aria-label="Run agent with prompt"
        >
          <Play size={16} />
          <span>Run</span>
        </button>
      </div>
    </div>
  )
}
