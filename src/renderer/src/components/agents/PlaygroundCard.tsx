/**
 * Compact inline card for playground previews in agent chat.
 * Appears when agent writes HTML files. Click to open PlaygroundModal.
 */
import { FileCode, Eye } from 'lucide-react'
import './PlaygroundCard.css'
import { tokens } from '../../design-system/tokens'

export interface PlaygroundCardProps {
  /** Original filename */
  filename: string
  /** File size in bytes */
  sizeBytes: number
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
        gap: tokens.space[3],
        width: '100%',
        maxWidth: '500px',
        padding: tokens.space[3],
        borderRadius: tokens.radius.md,
        cursor: 'pointer',
        transition: tokens.transition.fast,
        fontFamily: tokens.font.ui,
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
          borderRadius: tokens.radius.sm,
          flexShrink: 0
        }}
      >
        <FileCode size={20} className="playground-card__icon" />
      </div>

      {/* Filename and size */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="playground-card__filename"
          style={{
            fontFamily: tokens.font.code,
            fontSize: tokens.size.sm,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {filename}
        </div>
        <div
          className="playground-card__filesize"
          style={{
            fontSize: tokens.size.xs,
            marginTop: tokens.space[1]
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
          gap: tokens.space[1],
          padding: `${tokens.space[1]} ${tokens.space[2]}`,
          borderRadius: tokens.radius.sm,
          fontSize: tokens.size.xs,
          flexShrink: 0
        }}
      >
        <Eye size={12} />
        <span>Preview</span>
      </div>
    </button>
  )
}
