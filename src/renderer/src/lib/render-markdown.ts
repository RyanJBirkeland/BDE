import DOMPurify from 'dompurify'

/** Convert markdown to HTML. */
function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[huplo])(.+)$/gm, '<p>$1</p>')
}

/** Sanitize HTML to prevent XSS from untrusted content. */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'h1',
      'h2',
      'h3',
      'strong',
      'em',
      'code',
      'pre',
      'ul',
      'ol',
      'li',
      'a',
      'br',
      'blockquote'
    ],
    ALLOWED_ATTR: ['href', 'title', 'class'],
    ALLOW_DATA_ATTR: false
  })
}

/** Render markdown as sanitized HTML safe for dangerouslySetInnerHTML. */
export function renderMarkdown(md: string): string {
  return sanitizeHtml(markdownToHtml(md))
}
