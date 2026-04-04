interface AgentActivityEvent {
  id: number | string
  content: string
}

interface AgentActivityPreviewProps {
  events: AgentActivityEvent[]
  maxLines?: number
}

const MAX_LINE_LENGTH = 120

export function AgentActivityPreview({ events, maxLines = 5 }: AgentActivityPreviewProps): React.JSX.Element {
  const recent = events.slice(-maxLines)

  if (recent.length === 0) {
    return (
      <div className="agent-preview agent-preview--empty">
        <span className="agent-preview__waiting">Waiting for output...</span>
      </div>
    )
  }

  return (
    <div className="agent-preview" aria-label="Agent activity">
      {recent.map((event) => (
        <div key={event.id} className="agent-preview__line">
          <span className="agent-preview__text">
            {event.content.length > MAX_LINE_LENGTH
              ? event.content.slice(0, MAX_LINE_LENGTH) + '...'
              : event.content}
          </span>
        </div>
      ))}
    </div>
  )
}
