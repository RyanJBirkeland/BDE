const MAX_LEN = 52

function truncate(s: string): string {
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN - 1) + '…' : s
}

export function describeAgentStep(
  event: { type: string; tool?: string; summary?: string; text?: string } | undefined
): string {
  if (!event) return 'running…'

  if (event.type === 'agent:tool_call' && event.tool != null && event.summary != null) {
    return truncate(`$ ${event.tool}: ${event.summary}`)
  }

  if (event.type === 'agent:text' && event.text != null) {
    const firstLine = event.text.split('\n').find((l) => l.trim() !== '') ?? ''
    return firstLine ? truncate(firstLine) : 'running…'
  }

  return 'running…'
}
