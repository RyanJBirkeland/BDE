import { type NeonAccent, neonVar, NEON_ACCENTS } from '../neon/types'

interface TagBadgeProps {
  tag: string
  size?: 'sm' | 'md' | undefined
  onRemove?: (() => void) | undefined
}

/**
 * Hash a string to a consistent accent color.
 * Same tag always gets same color.
 */
function tagToAccent(tag: string): NeonAccent {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = (hash << 5) - hash + tag.charCodeAt(i)
    hash = hash & hash // Convert to 32-bit integer
  }
  return NEON_ACCENTS[Math.abs(hash) % NEON_ACCENTS.length] ?? 'cyan'
}

export function TagBadge({ tag, size = 'sm', onRemove }: TagBadgeProps): React.JSX.Element {
  const accent = tagToAccent(tag)
  const sizeClass = size === 'sm' ? 'tag-badge--sm' : 'tag-badge--md'

  return (
    <span
      className={`tag-badge ${sizeClass}`}
      style={
        {
          color: neonVar(accent, 'color'),
          background: neonVar(accent, 'surface'),
          border: `1px solid ${neonVar(accent, 'border')}`
        } as React.CSSProperties
      }
    >
      {tag}
      {onRemove && (
        <button
          className="tag-badge__remove"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove ${tag} tag`}
          type="button"
        >
          ×
        </button>
      )}
    </span>
  )
}
