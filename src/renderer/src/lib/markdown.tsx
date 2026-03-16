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
