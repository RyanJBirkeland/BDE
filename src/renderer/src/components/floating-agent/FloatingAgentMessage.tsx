import type { FloatingAgentMessage as Msg } from '../../stores/floatingAgent'
import { renderAgentMarkdown } from '../agents/render-agent-markdown'

interface Props {
  message: Msg
}

export function FloatingAgentMessage({ message }: Props): React.JSX.Element {
  const isUser = message.role === 'user'
  return (
    <div className={`fa-message fa-message--${isUser ? 'user' : 'assistant'}`}>
      <div className="fa-message__bubble">
        {isUser ? message.content : renderAgentMarkdown(message.content)}
      </div>
    </div>
  )
}
