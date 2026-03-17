/**
 * Simple inline markdown renderer for chat messages.
 * Handles code blocks, inline code, and plain text.
 */

/** Render markdown-ish content: code blocks, inline code, line breaks */
export function renderContent(text: string): React.JSX.Element {
  const parts: React.JSX.Element[] = []
  let key = 0

  // Split on triple-backtick code blocks first
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRe.exec(text)) !== null) {
    // Text before this code block
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++}>{renderInline(text.slice(lastIndex, match.index))}</span>
      )
    }
    // The code block itself
    parts.push(
      <pre key={key++} className="chat-msg__code-block">
        <code>{match[2]}</code>
      </pre>
    )
    lastIndex = match.index + match[0].length
  }

  // Remaining text after last code block
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{renderInline(text.slice(lastIndex))}</span>)
  }

  return <>{parts}</>
}

/**
 * Render user message content that may contain file attachment markers.
 * Detects: ![name](data:...) for inline images and 📄 filename + code blocks for text files.
 */
export function renderUserContent(text: string): React.JSX.Element {
  const parts: React.JSX.Element[] = []
  let key = 0

  // Combined regex: inline images ![name](data:...) OR 📄 filename + code blocks
  const combinedRe = /(?:!\[([^\]]*)\]\((data:[^)]+)\))|(?:📄\s+(\S+)\n```(\w*)\n([\s\S]*?)```)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = combinedRe.exec(text)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      if (before) {
        parts.push(<span key={key++} className="chat-msg__text-plain">{before}</span>)
      }
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Inline image: ![name](data:...)
      parts.push(
        <img
          key={key++}
          src={match[2]}
          alt={match[1]}
          className="chat-msg__inline-image"
        />
      )
    } else if (match[3] !== undefined && match[5] !== undefined) {
      // File attachment: 📄 filename + code block
      parts.push(
        <div key={key++} className="chat-msg__file-block">
          <span className="chat-msg__file-label">📄 {match[3]}</span>
          <pre className="chat-msg__code-block">
            <code>{match[5]}</code>
          </pre>
        </div>
      )
    }

    lastIndex = match.index + match[0].length
  }

  // Remaining text after last match
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim()
    if (remaining) {
      parts.push(<span key={key++} className="chat-msg__text-plain">{remaining}</span>)
    }
  }

  if (parts.length === 0) {
    return <span className="chat-msg__text-plain">{text}</span>
  }

  return <>{parts}</>
}

/** Render inline code and plain text segments */
export function renderInline(text: string): React.JSX.Element {
  const parts: React.JSX.Element[] = []
  let key = 0
  const inlineRe = /`([^`]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++} className="chat-msg__text-plain">
          {text.slice(lastIndex, match.index)}
        </span>
      )
    }
    parts.push(
      <code key={key++} className="chat-msg__inline-code">
        {match[1]}
      </code>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={key++} className="chat-msg__text-plain">
        {text.slice(lastIndex)}
      </span>
    )
  }

  return <>{parts}</>
}
