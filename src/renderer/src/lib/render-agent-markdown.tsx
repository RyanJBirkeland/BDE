/**
 * render-agent-markdown.tsx — Lightweight markdown-to-JSX for agent console text.
 * Returns React elements (not HTML strings) to prevent XSS by design.
 * Handles: **bold**, `code`, ## headings. Unicode emojis pass through natively.
 */
import React from 'react'

/** Process inline markdown: **bold** and `code` */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Match **bold** or `code` — bold first to avoid conflicts
  const regex = /\*\*(.+?)\*\*|`([^`]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[1] !== undefined) {
      // **bold**
      parts.push(
        <strong key={match.index} className="console-md-bold">
          {match[1]}
        </strong>
      )
    } else if (match[2] !== undefined) {
      // `code`
      parts.push(
        <code key={match.index} className="console-md-code">
          {match[2]}
        </code>
      )
    }
    lastIndex = match.index + match[0].length
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

/** Render agent text with lightweight markdown support */
export function renderAgentMarkdown(text: string): React.ReactNode {
  if (!text) return null

  // Split by newlines to handle line-start headings
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ## heading (line-start only, supports ## and ###)
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/)
    if (headingMatch) {
      elements.push(
        <span key={`h-${i}`} className="console-md-heading">
          {renderInlineMarkdown(headingMatch[1])}
        </span>
      )
      continue
    }

    // Empty line = paragraph break (render spacer with margin)
    if (line.trim() === '') {
      elements.push(<div key={`br-${i}`} className="console-md-paragraph-break" />)
      continue
    }

    // Regular line with inline markdown
    if (i > 0) {
      elements.push('\n')
    }
    elements.push(<React.Fragment key={`l-${i}`}>{renderInlineMarkdown(line)}</React.Fragment>)
  }

  return <>{elements}</>
}
