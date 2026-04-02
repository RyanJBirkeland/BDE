import { CircleCheck, CircleX, Loader2, ExternalLink } from 'lucide-react'
import type { CheckRun } from '../../lib/github-api'

interface PRStationChecksProps {
  checks: CheckRun[]
  loading: boolean
}

function CheckIcon({ run }: { run: CheckRun }) {
  if (run.status !== 'completed') {
    return <Loader2 size={14} className="pr-detail__check-spinner" />
  }
  if (run.conclusion === 'success' || run.conclusion === 'skipped') {
    return <CircleCheck size={14} />
  }
  return <CircleX size={14} />
}

function checkStatusClass(run: CheckRun): string {
  if (run.status !== 'completed') return 'pr-detail__check--pending'
  if (run.conclusion === 'success' || run.conclusion === 'skipped') return 'pr-detail__check--pass'
  return 'pr-detail__check--fail'
}

export function PRStationChecks({ checks, loading }: PRStationChecksProps) {
  if (loading) {
    return (
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">CI Checks</h3>
        <div className="pr-detail__checks-loading">
          <div className="sprint-board__skeleton" style={{ height: 28 }} />
          <div className="sprint-board__skeleton" style={{ height: 28 }} />
        </div>
      </div>
    )
  }

  if (checks.length === 0) {
    return (
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">CI Checks</h3>
        <span className="pr-detail__no-data">No check runs</span>
      </div>
    )
  }

  return (
    <div className="pr-detail__section">
      <h3 className="pr-detail__section-title">CI Checks</h3>
      <ul className="pr-detail__checks">
        {checks.map((run) => (
          <li key={run.name} className={`pr-detail__check ${checkStatusClass(run)}`}>
            <CheckIcon run={run} />
            <span className="pr-detail__check-name">{run.name}</span>
            {run.html_url && run.html_url.startsWith('https://github.com/') && (
              <a
                href={run.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="pr-detail__check-link"
                title="View on GitHub"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
