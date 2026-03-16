/**
 * Content normalization for gateway messages.
 * Gateway may return content as string, array of blocks [{type,text}], or null.
 */
export function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b: unknown) => {
        if (typeof b === 'string') return b
        if (b && typeof b === 'object') {
          const block = b as Record<string, unknown>
          if (block.type === 'thinking') return ''
          return typeof block.text === 'string' ? block.text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return String(content ?? '')
}
