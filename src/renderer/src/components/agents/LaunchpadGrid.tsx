import { useState, useCallback } from 'react'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import { CLAUDE_MODELS } from '../../../../shared/models'
import type { PromptTemplate, RecentTask } from '../../lib/launchpad-types'
import type { NeonAccent } from '../neon/types'

interface LaunchpadGridProps {
  templates: PromptTemplate[]
  recents: RecentTask[]
  onSelectTemplate: (template: PromptTemplate) => void
  onCustomPrompt: (prompt: string, repo: string, model: string) => void
  onSelectRecent: (recent: RecentTask) => void
}

const ACCENT_VARS: Record<NeonAccent, { bg: string; border: string; color: string; glow: string; hover: string }> = {
  cyan: { bg: 'rgba(0,255,255,0.06)', border: 'var(--neon-cyan-border)', color: 'var(--neon-cyan)', glow: 'rgba(0,255,255,0.15)', hover: 'rgba(0,255,255,0.3)' },
  pink: { bg: 'rgba(255,0,255,0.06)', border: 'var(--neon-pink-border)', color: 'var(--neon-pink)', glow: 'rgba(255,0,255,0.15)', hover: 'rgba(255,0,255,0.3)' },
  blue: { bg: 'rgba(100,100,255,0.06)', border: 'var(--neon-blue-border)', color: 'var(--neon-blue)', glow: 'rgba(100,100,255,0.15)', hover: 'rgba(100,100,255,0.3)' },
  purple: { bg: 'rgba(138,43,226,0.06)', border: 'var(--neon-purple-border)', color: 'var(--neon-purple)', glow: 'rgba(138,43,226,0.15)', hover: 'rgba(138,43,226,0.3)' },
  orange: { bg: 'rgba(255,165,0,0.06)', border: 'var(--neon-orange-border)', color: 'var(--neon-orange)', glow: 'rgba(255,165,0,0.15)', hover: 'rgba(255,165,0,0.3)' },
  red: { bg: 'rgba(255,80,80,0.06)', border: 'var(--neon-red-border)', color: 'var(--neon-red)', glow: 'rgba(255,80,80,0.15)', hover: 'rgba(255,80,80,0.3)' },
}

function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function LaunchpadGrid({
  templates,
  recents,
  onSelectTemplate,
  onCustomPrompt,
  onSelectRecent,
}: LaunchpadGridProps) {
  const repos = useRepoOptions()
  const [prompt, setPrompt] = useState('')
  const [repo, setRepo] = useState(repos[0]?.label ?? '')
  const [model, setModel] = useState('sonnet')

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && prompt.trim()) {
        e.preventDefault()
        onCustomPrompt(prompt.trim(), repo, model)
      }
    },
    [prompt, repo, model, onCustomPrompt],
  )

  return (
    <div className="launchpad" data-testid="launchpad-grid">
      {/* Header */}
      <div className="launchpad__header">
        <div className="launchpad__header-dot" />
        <span className="launchpad__header-title">New Agent Session</span>
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
              style={{
                '--tile-bg': vars.bg,
                '--tile-border': vars.border,
                '--tile-color': vars.color,
                '--tile-glow': vars.glow,
                '--tile-hover-border': vars.hover,
              } as React.CSSProperties}
              onClick={() => onSelectTemplate(t)}
            >
              <div className="launchpad__tile-icon">{t.icon}</div>
              <div className="launchpad__tile-name">{t.name}</div>
              <div className="launchpad__tile-desc">{t.description}</div>
            </button>
          )
        })}
        <button type="button" className="launchpad__tile launchpad__tile--add">
          <div className="launchpad__tile-icon">+</div>
          <div className="launchpad__tile-name">Add Custom</div>
        </button>
      </div>

      {/* Recent */}
      {recents.length > 0 && (
        <>
          <div className="launchpad__section-label">Recent</div>
          <div className="launchpad__recent-list">
            {recents.map((r, i) => (
              <button
                key={`${r.timestamp}-${i}`}
                type="button"
                className="launchpad__recent-item"
                onClick={() => onSelectRecent(r)}
              >
                <div className="launchpad__recent-dot" />
                <span className="launchpad__recent-text">
                  {r.prompt.length > 80 ? `${r.prompt.slice(0, 80)}...` : r.prompt}
                </span>
                {r.timestamp > 0 && (
                  <span className="launchpad__recent-time">{formatRelativeTime(r.timestamp)}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Bottom Prompt Bar */}
      <div className="launchpad__prompt-bar">
        <input
          className="launchpad__prompt-input"
          placeholder="Or describe a custom task..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
        />
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
    </div>
  )
}
