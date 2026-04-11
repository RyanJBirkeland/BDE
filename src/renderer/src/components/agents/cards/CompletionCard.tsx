import '../ConsoleLine.css'
import { formatTokenCount } from './util'
import { formatDurationMs } from '../../../lib/format'

interface CompletionCardProps {
  exitCode: number
  costUsd: number
  tokensIn: number
  tokensOut: number
  durationMs: number
}

export function CompletionCard({
  exitCode,
  costUsd,
  tokensIn,
  tokensOut,
  durationMs
}: CompletionCardProps): React.JSX.Element {
  const success = exitCode === 0
  return (
    <div
      className={`console-completion-card${success ? '' : ' console-completion-card--failed'}`}
      data-testid="console-line-completed"
    >
      <div
        className={`console-completion-card__header ${success ? 'console-completion-card__header--success' : 'console-completion-card__header--failed'}`}
      >
        <span>{success ? '\u2713' : '\u2717'}</span>
        <span>
          {success
            ? 'Agent completed successfully'
            : `Agent failed (exit code ${exitCode})`}
        </span>
      </div>
      <div className="console-completion-card__stats">
        <div className="console-completion-card__stat">
          <div className="console-completion-card__stat-value console-completion-card__stat-value--cyan">
            {formatDurationMs(durationMs)}
          </div>
          <div className="console-completion-card__stat-label">Duration</div>
        </div>
        <div className="console-completion-card__stat">
          <div
            className={`console-completion-card__stat-value ${success ? 'console-completion-card__stat-value--cyan' : 'console-completion-card__stat-value--red'}`}
          >
            ${costUsd.toFixed(2)}
          </div>
          <div className="console-completion-card__stat-label">Cost</div>
        </div>
        <div className="console-completion-card__stat">
          <div className="console-completion-card__stat-value console-completion-card__stat-value--purple">
            {formatTokenCount(tokensIn)}
          </div>
          <div className="console-completion-card__stat-label">Tokens In</div>
        </div>
        <div className="console-completion-card__stat">
          <div className="console-completion-card__stat-value console-completion-card__stat-value--orange">
            {formatTokenCount(tokensOut)}
          </div>
          <div className="console-completion-card__stat-label">Tokens Out</div>
        </div>
      </div>
    </div>
  )
}
