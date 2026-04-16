/**
 * Full-screen modal for previewing agent-generated playground files.
 * Supports HTML, SVG, Markdown, and JSON content types.
 * Split view: preview pane + editable source pane.
 * Supports Split, Preview-only, and Source-only view modes.
 *
 * Security: when the user edits content in the source pane and then switches to a
 * preview-bearing mode, the edited content is re-sanitized via IPC before being
 * rendered. Raw user input is never used as srcDoc directly.
 * SVG goes through the same DOMPurify sanitization path as HTML.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Columns, Eye, Code, ExternalLink } from 'lucide-react'
import './PlaygroundModal.css'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type { PlaygroundContentType } from '../../../../shared/types'

type ViewMode = 'split' | 'preview' | 'source'

export interface PlaygroundModalProps {
  /** The sanitized file content to render */
  html: string
  /** Original filename */
  filename: string
  /** Content type — determines how the preview pane renders */
  contentType: PlaygroundContentType
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

/** Whether the requested view mode requires rendering the iframe preview. */
function requiresPreview(mode: ViewMode): boolean {
  return mode === 'split' || mode === 'preview'
}

/**
 * Renders the preview content based on content type.
 * All content has already been sanitized via DOMPurify before reaching this function.
 */
function PlaygroundPreview({
  content,
  filename,
  contentType
}: {
  content: string
  filename: string
  contentType: PlaygroundContentType
}): React.JSX.Element {
  switch (contentType) {
    case 'html':
      return (
        <iframe
          title={`Preview of ${filename}`}
          sandbox="allow-scripts"
          srcDoc={content}
          className="playground-modal__iframe"
          style={{ background: 'var(--bde-surface)' }}
        />
      )
    case 'svg':
      // SVG renders via iframe same as HTML — DOMPurify strips scripts and handlers.
      // No allow-scripts since SVG interactivity doesn't require it.
      return (
        <iframe
          title={`Preview of ${filename}`}
          sandbox=""
          srcDoc={content}
          className="playground-modal__iframe playground-modal__iframe--svg"
          style={{ background: 'var(--bde-surface)' }}
        />
      )
    case 'markdown':
      return <pre className="playground-modal__pre playground-modal__pre--markdown">{content}</pre>
    case 'json': {
      let pretty = content
      try {
        pretty = JSON.stringify(JSON.parse(content), null, 2)
      } catch {
        // Show raw content if parse fails
      }
      return <pre className="playground-modal__pre playground-modal__pre--json">{pretty}</pre>
    }
  }
}

export function PlaygroundModal({
  html,
  filename,
  contentType,
  sizeBytes,
  onClose
}: PlaygroundModalProps): React.JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const modalRef = useRef<HTMLDivElement>(null)

  // editedContent tracks the user's in-source-pane changes; starts as original html
  const [editedContent, setEditedHtml] = useState<string>(html)
  // previewContent is the sanitized version used as srcDoc — only updated when
  // switching to a preview-bearing mode
  const [previewContent, setPreviewHtml] = useState<string>(html)
  const [isSanitizing, setIsSanitizing] = useState<boolean>(false)

  // Trap focus inside modal
  useFocusTrap(modalRef, true)

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

  /**
   * Sanitize editedContent via main-process IPC and update previewContent.
   * Runs in the background — view mode switches immediately while the iframe
   * shows a brief loading indicator until sanitization resolves.
   */
  const refreshPreview = useCallback((): void => {
    setIsSanitizing(true)
    window.api.window.sanitizePlayground(editedContent).then(
      (sanitized) => {
        setPreviewHtml(sanitized)
        setIsSanitizing(false)
      },
      (err: unknown) => {
        console.error('Failed to sanitize playground HTML:', err)
        setIsSanitizing(false)
      }
    )
  }, [editedContent])

  const handleViewModeChange = useCallback(
    (mode: ViewMode): void => {
      // When switching to a preview-bearing mode, always re-sanitize so user
      // edits made in the source pane are never rendered raw.
      if (requiresPreview(mode)) {
        refreshPreview()
      }
      setViewMode(mode)
    },
    [refreshPreview]
  )

  const handleOpenInBrowser = async (): Promise<void> => {
    try {
      // Pass editedContent — the handler re-sanitizes on its end before writing
      await window.api.window.openPlaygroundInBrowser(editedContent)
    } catch (err) {
      console.error('Failed to open playground in browser:', err)
    }
  }

  const showPreview = viewMode === 'split' || viewMode === 'preview'
  const showSource = viewMode === 'split' || viewMode === 'source'

  // Syntax-highlighted display uses edited text — it is never injected as HTML
  const escapedHtml = useMemo(() => escapeHtml(editedContent), [editedContent])
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
      <div ref={modalRef} className="playground-modal" data-testid="playground-modal">
        {/* Toolbar */}
        <div className="playground-modal__toolbar">
          {/* Filename + size */}
          <Code size={14} className="playground-modal__filename-icon" />
          <span className="playground-modal__filename">{filename}</span>
          <span className="playground-modal__filesize">{formatFileSize(sizeBytes)}</span>

          {/* Security indicator: scripts enabled for HTML only */}
          {contentType === 'html' && (
            <span
              aria-label="JavaScript execution is enabled in this preview"
              title="Agent-generated HTML can execute JavaScript. Only preview content from trusted agents."
              className="playground-modal__security-badge"
            >
              ⚠️ Scripts enabled
            </span>
          )}

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
                  onClick={() => handleViewModeChange(mode)}
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
              {isSanitizing ? (
                <div className="playground-modal__sanitizing" aria-live="polite">
                  Sanitizing…
                </div>
              ) : (
                /*
                  SECURITY: HTML and SVG content passes through DOMPurify sanitization
                  before reaching the preview pane. HTML allows allow-scripts for
                  interactive playgrounds; SVG uses an empty sandbox (no scripts needed).
                  Markdown and JSON are rendered as plain text via <pre> — no HTML injection.

                  previewContent is always the output of sanitizePlaygroundHtml() — raw user
                  edits from the source textarea are never passed directly to the preview.
                */
                <PlaygroundPreview
                  content={previewContent}
                  filename={filename}
                  contentType={contentType}
                />
              )}
            </div>
          )}

          {/* Source pane — editable textarea with syntax-highlighted overlay */}
          {showSource && (
            <div className="playground-modal__source" data-testid="playground-source">
              <textarea
                className="playground-modal__source-textarea"
                value={editedContent}
                onChange={(e) => setEditedHtml(e.target.value)}
                aria-label="Source editor"
                spellCheck={false}
              />
              <pre className="playground-modal__source-pre" aria-hidden="true">
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
