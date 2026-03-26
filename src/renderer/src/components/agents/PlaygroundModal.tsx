/**
 * Full-screen modal for previewing agent-generated HTML.
 * Split view: sandboxed iframe (preview) + syntax-highlighted source code.
 * Supports Split, Preview-only, and Source-only view modes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Columns, Eye, Code, ExternalLink } from 'lucide-react'
import { tokens } from '../../design-system/tokens'

type ViewMode = 'split' | 'preview' | 'source'

export interface PlaygroundModalProps {
  /** The HTML content to render */
  html: string
  /** Original filename */
  filename: string
  /** File size in bytes */
  sizeBytes: number
  /** Close callback */
  onClose: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Escape HTML entities for safe display */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Tokenize escaped HTML into styled spans for syntax highlighting.
 * All input is pre-escaped — no raw HTML is injected.
 */
function tokenizeLine(escapedLine: string): React.JSX.Element[] {
  const parts: React.JSX.Element[] = []
  // Match tags, attributes, strings, and comments in escaped HTML
  const regex =
    /(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?)([\w-]+)|(\s)([\w-]+)(=)|(&quot;(?:[^&]|&(?!quot;))*&quot;)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(escapedLine)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{escapedLine.slice(lastIndex, match.index)}</span>)
    }

    if (match[1]) {
      // Comment
      parts.push(
        <span key={key++} style={{ color: tokens.color.textDim, fontStyle: 'italic' }}>
          {match[1]}
        </span>
      )
    } else if (match[2] && match[3]) {
      // Tag bracket + tag name
      parts.push(<span key={key++}>{match[2]}</span>)
      parts.push(
        <span key={key++} style={{ color: tokens.color.danger }}>
          {match[3]}
        </span>
      )
    } else if (match[4] && match[5] && match[6]) {
      // Attribute
      parts.push(<span key={key++}>{match[4]}</span>)
      parts.push(
        <span key={key++} style={{ color: tokens.color.warning }}>
          {match[5]}
        </span>
      )
      parts.push(<span key={key++}>{match[6]}</span>)
    } else if (match[7]) {
      // String
      parts.push(
        <span key={key++} style={{ color: tokens.color.success }}>
          {match[7]}
        </span>
      )
    }

    lastIndex = match.index + match[0].length
  }

  // Remaining text
  if (lastIndex < escapedLine.length) {
    parts.push(<span key={key++}>{escapedLine.slice(lastIndex)}</span>)
  }

  return parts.length > 0 ? parts : [<span key={0}>{escapedLine}</span>]
}

const VIEW_MODE_ICONS: Record<ViewMode, typeof Columns> = {
  split: Columns,
  preview: Eye,
  source: Code
}

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  split: 'Split',
  preview: 'Preview',
  source: 'Source'
}

export function PlaygroundModal({
  html,
  filename,
  sizeBytes,
  onClose
}: PlaygroundModalProps): React.JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>('split')

  // Escape to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  const handleOpenInBrowser = async (): Promise<void> => {
    try {
      // Encode HTML as a data URI and attempt to open externally.
      // Note: data: scheme may be blocked by the window:openExternal handler.
      const dataUri = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
      await window.api.openExternal(dataUri)
    } catch {
      // data: scheme not in ALLOWED_URL_SCHEMES — silently fail
    }
  }

  const showPreview = viewMode === 'split' || viewMode === 'preview'
  const showSource = viewMode === 'split' || viewMode === 'source'

  const escapedHtml = useMemo(() => escapeHtml(html), [html])
  const sourceLines = useMemo(() => escapedHtml.split('\n'), [escapedHtml])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Playground preview: ${filename}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bde-overlay)',
        animation: 'bde-fade-in 150ms ease'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="playground-modal-overlay"
    >
      <div
        style={{
          width: '90vw',
          height: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: tokens.color.surfaceHigh,
          borderRadius: tokens.radius.xl,
          boxShadow: 'var(--bde-shadow-lg)',
          overflow: 'hidden',
          animation: 'bde-scale-fade-in 150ms ease'
        }}
        data-testid="playground-modal"
      >
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[3],
            padding: `${tokens.space[2]} ${tokens.space[4]}`,
            borderBottom: `1px solid ${tokens.color.border}`,
            flexShrink: 0
          }}
        >
          {/* Filename + size */}
          <Code size={14} style={{ color: tokens.color.accent, flexShrink: 0 }} />
          <span
            style={{
              fontFamily: tokens.font.code,
              fontSize: tokens.size.sm,
              color: tokens.color.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {filename}
          </span>
          <span
            style={{
              fontSize: tokens.size.xs,
              color: tokens.color.textMuted,
              flexShrink: 0
            }}
          >
            {formatFileSize(sizeBytes)}
          </span>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* View mode toggle */}
          <div
            role="tablist"
            aria-label="View mode"
            style={{
              display: 'flex',
              gap: tokens.space[1],
              background: tokens.color.surface,
              padding: tokens.space[1],
              borderRadius: tokens.radius.sm
            }}
          >
            {(['split', 'preview', 'source'] as ViewMode[]).map((mode) => {
              const Icon = VIEW_MODE_ICONS[mode]
              const isActive = viewMode === mode
              return (
                <button
                  key={mode}
                  role="tab"
                  aria-selected={isActive}
                  aria-label={VIEW_MODE_LABELS[mode]}
                  onClick={() => setViewMode(mode)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.space[1],
                    padding: `${tokens.space[1]} ${tokens.space[2]}`,
                    background: isActive ? tokens.color.accentDim : 'transparent',
                    color: isActive ? tokens.color.accent : tokens.color.textMuted,
                    border: 'none',
                    borderRadius: tokens.radius.sm,
                    cursor: 'pointer',
                    fontSize: tokens.size.xs,
                    fontFamily: tokens.font.ui,
                    transition: tokens.transition.fast
                  }}
                >
                  <Icon size={12} />
                  {VIEW_MODE_LABELS[mode]}
                </button>
              )
            })}
          </div>

          {/* Open in Browser */}
          <button
            onClick={handleOpenInBrowser}
            aria-label="Open in browser"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[1],
              padding: `${tokens.space[1]} ${tokens.space[2]}`,
              background: 'transparent',
              color: tokens.color.textMuted,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.sm,
              cursor: 'pointer',
              fontSize: tokens.size.xs,
              fontFamily: tokens.font.ui,
              transition: tokens.transition.fast
            }}
          >
            <ExternalLink size={12} />
            Open in Browser
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            aria-label="Close playground"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              background: 'transparent',
              color: tokens.color.textMuted,
              border: 'none',
              borderRadius: tokens.radius.sm,
              cursor: 'pointer',
              transition: tokens.transition.fast
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content area */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            overflow: 'hidden'
          }}
        >
          {/* Preview pane */}
          {showPreview && (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                borderRight: showSource ? `1px solid ${tokens.color.border}` : undefined
              }}
              data-testid="playground-preview"
            >
              <iframe
                title={`Preview of ${filename}`}
                sandbox="allow-scripts"
                srcDoc={html}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  background: '#ffffff'
                }}
              />
            </div>
          )}

          {/* Source pane */}
          {showSource && (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'auto',
                background: tokens.color.surface
              }}
              data-testid="playground-source"
            >
              <pre
                style={{
                  margin: 0,
                  padding: tokens.space[3],
                  fontFamily: tokens.font.code,
                  fontSize: tokens.size.xs,
                  lineHeight: '20px',
                  color: tokens.color.text,
                  whiteSpace: 'pre',
                  tabSize: 2
                }}
              >
                <code>
                  {sourceLines.map((line, i) => (
                    <div key={i} style={{ display: 'flex', minHeight: '20px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: '48px',
                          textAlign: 'right',
                          paddingRight: tokens.space[3],
                          color: tokens.color.textDim,
                          userSelect: 'none',
                          flexShrink: 0
                        }}
                      >
                        {i + 1}
                      </span>
                      <span>{tokenizeLine(line)}</span>
                    </div>
                  ))}
                </code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
