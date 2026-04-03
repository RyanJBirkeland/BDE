/**
 * Full-screen modal for previewing agent-generated HTML.
 * Split view: sandboxed iframe (preview) + syntax-highlighted source code.
 * Supports Split, Preview-only, and Source-only view modes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Columns, Eye, Code, ExternalLink } from 'lucide-react'

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
        <span key={key++} className="playground-modal__syntax-comment">
          {match[1]}
        </span>
      )
    } else if (match[2] && match[3]) {
      // Tag bracket + tag name
      parts.push(<span key={key++}>{match[2]}</span>)
      parts.push(
        <span key={key++} className="playground-modal__syntax-tag">
          {match[3]}
        </span>
      )
    } else if (match[4] && match[5] && match[6]) {
      // Attribute
      parts.push(<span key={key++}>{match[4]}</span>)
      parts.push(
        <span key={key++} className="playground-modal__syntax-attr">
          {match[5]}
        </span>
      )
      parts.push(<span key={key++}>{match[6]}</span>)
    } else if (match[7]) {
      // String
      parts.push(
        <span key={key++} className="playground-modal__syntax-string">
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
      // Write HTML to temp file and open in default browser
      await window.api.openPlaygroundInBrowser(html)
    } catch (err) {
      console.error('Failed to open playground in browser:', err)
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
      className="playground-modal__overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="playground-modal-overlay"
    >
      <div className="playground-modal" data-testid="playground-modal">
        {/* Toolbar */}
        <div className="playground-modal__toolbar">
          {/* Filename + size */}
          <Code size={14} className="playground-modal__filename-icon" />
          <span className="playground-modal__filename">{filename}</span>
          <span className="playground-modal__filesize">{formatFileSize(sizeBytes)}</span>

          {/* Security indicator: scripts enabled */}
          <span
            aria-label="JavaScript execution is enabled in this preview"
            title="Agent-generated HTML can execute JavaScript. Only preview content from trusted agents."
            className="playground-modal__security-badge"
          >
            ⚠️ Scripts enabled
          </span>

          {/* Spacer */}
          <div className="playground-modal__spacer" />

          {/* View mode toggle */}
          <div role="tablist" aria-label="View mode" className="playground-modal__view-toggle">
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
                  className={`playground-modal__view-button ${isActive ? 'playground-modal__view-button--active' : ''}`}
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
            className="playground-modal__browser-button"
          >
            <ExternalLink size={12} />
            Open in Browser
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            aria-label="Close playground"
            className="playground-modal__close-button"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content area */}
        <div className="playground-modal__content">
          {/* Preview pane */}
          {showPreview && (
            <div
              className={`playground-modal__preview ${showSource ? 'playground-modal__preview--split' : ''}`}
              data-testid="playground-preview"
            >
              {/*
                SECURITY: iframe sandbox allows JavaScript execution (allow-scripts).

                This is an ACCEPTED RISK because:
                1. HTML content is generated by Claude agents that the user explicitly spawned
                2. Users trust these agents to execute arbitrary code in their workspace
                3. Interactive playground features (charts, animations, forms) require JS
                4. The sandbox still blocks: downloads, forms submission, popups, modals,
                   pointer lock, and top-level navigation

                The "Scripts enabled" indicator in the toolbar warns users that JS execution
                is enabled. For untrusted HTML, users should use the "Source" view instead.
              */}
              <iframe
                title={`Preview of ${filename}`}
                sandbox="allow-scripts"
                srcDoc={html}
                className="playground-modal__iframe"
                style={{ background: '#ffffff' }}
              />
            </div>
          )}

          {/* Source pane */}
          {showSource && (
            <div className="playground-modal__source" data-testid="playground-source">
              <pre className="playground-modal__source-pre">
                <code>
                  {sourceLines.map((line, i) => (
                    <div key={i} className="playground-modal__source-line">
                      <span className="playground-modal__line-number">{i + 1}</span>
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
