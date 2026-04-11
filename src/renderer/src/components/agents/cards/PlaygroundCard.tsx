import '../ConsoleLine.css'
import { formatTime } from './util'

interface PlaygroundCardProps {
  filename: string
  sizeBytes: number
  timestamp: number
  searchClass: string
  onPlaygroundClick?: (block: { filename: string; html: string; sizeBytes: number }) => void
  html: string
}

export function PlaygroundCard({
  filename,
  sizeBytes,
  timestamp,
  searchClass,
  onPlaygroundClick,
  html
}: PlaygroundCardProps): React.JSX.Element {
  return (
    <div
      className={`console-line console-line--playground${searchClass}${onPlaygroundClick ? ' console-line--clickable' : ''}`}
      data-testid="console-line-playground"
      role="button"
      tabIndex={0}
      onClick={() => onPlaygroundClick?.({ filename, html, sizeBytes })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPlaygroundClick?.({ filename, html, sizeBytes })
        }
      }}
    >
      <span className="console-prefix console-prefix--play">[play]</span>
      <span className="console-line__content">
        {filename} ({Math.ceil(sizeBytes / 1024)}KB)
      </span>
      <span className="console-line__timestamp">{formatTime(timestamp)}</span>
    </div>
  )
}
