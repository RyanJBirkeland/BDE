import './ConsoleCard.css'

interface RateLimitedCardProps {
  retryDelayMs: number
  attempt: number
  timestamp: number
  searchClass: string
}

export function RateLimitedCard({
  retryDelayMs,
  attempt
}: RateLimitedCardProps): React.JSX.Element {
  return (
    <div className="console-card console-card--rate" data-testid="console-line-rate-limited">
      Rate limited, retry in {Math.ceil(retryDelayMs / 1000)}s (attempt {attempt})
    </div>
  )
}
