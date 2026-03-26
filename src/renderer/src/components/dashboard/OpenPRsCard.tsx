import { useState, useEffect } from 'react'
import { GitPullRequest, ExternalLink } from 'lucide-react'
import { DashboardCard } from './DashboardCard'
import { tokens } from '../../design-system/tokens'
import type { OpenPr } from '../../../../shared/types'

const MAX_PRS = 5

export function OpenPRsCard(): React.JSX.Element {
  const [prs, setPrs] = useState<OpenPr[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api
      .getPrList()
      .then((payload) => {
        if (!cancelled) {
          setPrs((payload.prs ?? []).slice(0, MAX_PRS))
        }
      })
      .catch(() => {
        if (!cancelled) setPrs([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <DashboardCard title="Open PRs" icon={<GitPullRequest size={14} aria-hidden="true" />}>
      {loading ? (
        <p
          style={{
            padding: `${tokens.space[4]} ${tokens.space[4]}`,
            color: tokens.color.textMuted,
            fontSize: tokens.size.sm,
            margin: 0
          }}
        >
          Loading…
        </p>
      ) : prs.length === 0 ? (
        <p
          style={{
            padding: `${tokens.space[4]} ${tokens.space[4]}`,
            color: tokens.color.textMuted,
            fontSize: tokens.size.sm,
            margin: 0
          }}
        >
          No open pull requests
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {prs.map((pr) => (
            <li
              key={`${pr.repo}-${pr.number}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.space[2],
                padding: `${tokens.space[2]} ${tokens.space[4]}`,
                borderBottom: `1px solid ${tokens.color.border}`,
                fontSize: tokens.size.sm
              }}
            >
              <span
                style={{
                  fontSize: tokens.size.xs,
                  color: tokens.color.textMuted,
                  flexShrink: 0
                }}
              >
                #{pr.number}
              </span>
              <span
                style={{
                  flex: 1,
                  color: tokens.color.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={pr.title}
              >
                {pr.title}
              </span>
              {pr.draft && (
                <span
                  style={{
                    fontSize: tokens.size.xs,
                    color: tokens.color.textMuted,
                    background: tokens.color.surfaceHigh,
                    borderRadius: tokens.radius.full,
                    padding: `2px ${tokens.space[2]}`,
                    flexShrink: 0
                  }}
                >
                  Draft
                </span>
              )}
              <button
                onClick={() => window.api.openExternal(pr.html_url)}
                title="Open PR in browser"
                aria-label={`Open PR #${pr.number} in browser`}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: tokens.color.textMuted,
                  display: 'flex',
                  alignItems: 'center',
                  padding: 0,
                  flexShrink: 0
                }}
              >
                <ExternalLink size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  )
}
