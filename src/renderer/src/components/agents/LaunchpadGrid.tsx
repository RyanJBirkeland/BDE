import { useState, useCallback, useRef, useEffect } from 'react'
import './LaunchpadGrid.css'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import { CLAUDE_MODELS } from '../../../../shared/models'
import type { PromptTemplate } from '../../lib/launchpad-types'
import type { NeonAccent } from '../neon/types'
import { Play, ChevronDown } from 'lucide-react'

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
    bg: 'var(--bde-accent-surface)',
    border: 'var(--bde-accent-border)',
    color: 'var(--bde-accent)',
    glow: 'transparent',
    hover: 'var(--bde-accent-border)'
  },
  pink: {
    bg: 'var(--bde-accent-surface)',
    border: 'var(--bde-accent-border)',
    color: 'var(--bde-status-done)',
    glow: 'transparent',
    hover: 'var(--bde-accent-border)'
  },
  blue: {
    bg: 'var(--bde-accent-surface)',
    border: 'var(--bde-accent-border)',
    color: 'var(--bde-status-review)',
    glow: 'transparent',
    hover: 'var(--bde-accent-border)'
  },
  purple: {
    bg: 'var(--bde-accent-surface)',
    border: 'var(--bde-accent-border)',
    color: 'var(--bde-status-active)',
    glow: 'transparent',
    hover: 'var(--bde-accent-border)'
  },
  orange: {
    bg: 'var(--bde-warning-surface)',
    border: 'var(--bde-warning-border)',
    color: 'var(--bde-warning)',
    glow: 'transparent',
    hover: 'var(--bde-warning-border)'
  },
  red: {
    bg: 'var(--bde-danger-surface)',
    border: 'var(--bde-danger-border)',
    color: 'var(--bde-danger)',
    glow: 'transparent',
    hover: 'var(--bde-danger-border)'
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
  const [repo, setRepo] = useState('')
  const [model, setModel] = useState('sonnet')
  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false)
  const repoDropdownRef = useRef<HTMLDivElement>(null)

  // Sync repo selection once repos load (useRepoOptions is async via IPC)
  useEffect(() => {
    if (repos.length > 0) {
      setRepo((prev) => prev || repos[0].label)
    }
  }, [repos])

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

  const toggleRepoDropdown = useCallback(() => {
    setIsRepoDropdownOpen((prev) => !prev)
  }, [])

  const handleSelectRepo = useCallback((repoLabel: string) => {
    setRepo(repoLabel)
    setIsRepoDropdownOpen(false)
  }, [])

  // Auto-focus first option when dropdown opens
  useEffect(() => {
    if (isRepoDropdownOpen && repoDropdownRef.current) {
      const firstOption = repoDropdownRef.current.querySelector<HTMLButtonElement>('[role="option"]')
      firstOption?.focus()
    }
  }, [isRepoDropdownOpen])

  // Keyboard navigation for repo dropdown
  const handleRepoDropdownKeyDown = useCallback((e: React.KeyboardEvent) => {
    const dropdown = repoDropdownRef.current
    if (!dropdown) return
    const items = Array.from(dropdown.querySelectorAll<HTMLElement>('[role="option"]'))
    const currentIndex = items.indexOf(e.target as HTMLElement)

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0
        items[next]?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1
        items[prev]?.focus()
        break
      }
      case 'Enter':
      case ' ':
        e.preventDefault()
        ;(e.target as HTMLElement).click()
        break
      case 'Escape':
        e.preventDefault()
        setIsRepoDropdownOpen(false)
        break
    }
  }, [])

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
        <div className="launchpad__repo-selector">
          <button
            type="button"
            className="launchpad__repo-chip"
            onClick={toggleRepoDropdown}
            aria-haspopup="listbox"
            aria-expanded={isRepoDropdownOpen}
            aria-label={`Selected repository: ${repo}`}
          >
            <div className="launchpad__repo-dot" />
            {repo}
            <ChevronDown size={12} />
          </button>

          {isRepoDropdownOpen && (
            <>
              {/* Backdrop to close on outside click */}
              <div
                className="launchpad__repo-dropdown-backdrop"
                onClick={() => setIsRepoDropdownOpen(false)}
              />
              <div
                ref={repoDropdownRef}
                role="listbox"
                aria-label="Repositories"
                className="launchpad__repo-dropdown"
                onKeyDown={handleRepoDropdownKeyDown}
              >
                {repos.length === 0 ? (
                  <div className="launchpad__repo-dropdown-empty">No repositories configured</div>
                ) : (
                  repos.map((r) => (
                    <button
                      key={r.label}
                      role="option"
                      tabIndex={-1}
                      aria-selected={r.label === repo}
                      onClick={() => handleSelectRepo(r.label)}
                      className={`launchpad__repo-dropdown-option ${r.label === repo ? 'launchpad__repo-dropdown-option--current' : ''}`}
                    >
                      <div className="launchpad__repo-dot" />
                      <span className="launchpad__repo-dropdown-option-name">{r.label}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
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
