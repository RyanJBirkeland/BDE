import '../ConsoleLine.css'
import { formatTime } from './util'
import type { PlaygroundContentType } from '../../../../../shared/types'
import { PLAYGROUND_CONTENT_TYPE_LABELS } from '../../../../../shared/types'

interface PlaygroundCardProps {
  filename: string
  sizeBytes: number
  timestamp: number
  searchClass: string
  onPlaygroundClick?:
    | ((block: {
        filename: string
        html: string
        contentType: PlaygroundContentType
        sizeBytes: number
      }) => void)
    | undefined
  html: string
  contentType: PlaygroundContentType
}

export function PlaygroundCard({
  filename,
  sizeBytes,
  timestamp,
  searchClass,
  onPlaygroundClick,
  html,
  contentType
}: PlaygroundCardProps): React.JSX.Element {
  const label = PLAYGROUND_CONTENT_TYPE_LABELS[contentType]
  return (
    <div
      className={`console-line console-line--playground${searchClass}${onPlaygroundClick ? ' console-line--clickable' : ''}`}
      data-testid="console-line-playground"
      role="button"
      tabIndex={0}
      onClick={() => onPlaygroundClick?.({ filename, html, contentType, sizeBytes })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPlaygroundClick?.({ filename, html, contentType, sizeBytes })
        }
      }}
    >
      <span className="console-prefix console-prefix--play">[play]</span>
      <span className="console-line__content">
        {filename} ({Math.ceil(sizeBytes / 1024)}KB)
      </span>
      <span className="console-line__content-type-badge">[{label}]</span>
      <span className="console-line__timestamp">{formatTime(timestamp)}</span>
    </div>
  )
}
