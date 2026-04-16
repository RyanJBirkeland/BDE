/**
 * Compact inline card for playground previews in agent chat.
 * Appears when agent writes HTML, SVG, Markdown, or JSON files. Click to open PlaygroundModal.
 */
import { FileCode, Eye } from 'lucide-react'
import './PlaygroundCard.css'
import type { PlaygroundContentType } from '../../../../shared/types'

const CONTENT_TYPE_LABELS: Record<PlaygroundContentType, string> = {
  html: 'HTML',
  svg: 'SVG',
  markdown: 'Markdown',
  json: 'JSON'
}

export interface PlaygroundCardProps {
  /** Original filename */
  filename: string
  /** File size in bytes */
  sizeBytes: number
  /** Content type for display */
  contentType: PlaygroundContentType
  /** Click handler to open modal */
  onClick: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PlaygroundCard({
  filename,
  sizeBytes,
  contentType,
  onClick
}: PlaygroundCardProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={`Preview ${filename}`}
      data-testid="playground-card"
      className="playground-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--bde-space-3)',
        width: '100%',
        maxWidth: '500px',
        padding: 'var(--bde-space-3)',
        borderRadius: 'var(--bde-radius-md)',
        cursor: 'pointer',
        transition: 'var(--bde-transition-fast)',
        fontFamily: 'var(--bde-font-ui)',
        textAlign: 'left'
      }}
    >
      {/* File icon */}
      <div
        className="playground-card__icon-box"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '40px',
          height: '40px',
          borderRadius: 'var(--bde-radius-sm)',
          flexShrink: 0
        }}
      >
        <FileCode size={20} className="playground-card__icon" />
      </div>

      {/* Filename and size */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--bde-space-2)',
            overflow: 'hidden'
          }}
        >
          <div
            className="playground-card__filename"
            style={{
              fontFamily: 'var(--bde-font-code)',
              fontSize: 'var(--bde-size-sm)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {filename}
          </div>
          <span
            className="playground-card__content-type-badge"
            style={{
              fontSize: 'var(--bde-size-xs)',
              flexShrink: 0
            }}
          >
            {CONTENT_TYPE_LABELS[contentType]}
          </span>
        </div>
        <div
          className="playground-card__filesize"
          style={{
            fontSize: 'var(--bde-size-xs)',
            marginTop: 'var(--bde-space-1)'
          }}
        >
          {formatFileSize(sizeBytes)}
        </div>
      </div>

      {/* Preview hint */}
      <div
        className="playground-card__preview-hint"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--bde-space-1)',
          padding: `${'var(--bde-space-1)'} ${'var(--bde-space-2)'}`,
          borderRadius: 'var(--bde-radius-sm)',
          fontSize: 'var(--bde-size-xs)',
          flexShrink: 0
        }}
      >
        <Eye size={12} />
        <span>Preview</span>
      </div>
    </button>
  )
}
