import type { FloatingAgentMessage as Msg } from '../../stores/floatingAgent'

interface Props {
  message: Msg
}

export function FloatingAgentMessage({ message }: Props): React.JSX.Element {
  const isUser = message.role === 'user'
  return (
    <div className={`fa-message fa-message--${isUser ? 'user' : 'assistant'}`}>
      <div className="fa-message__bubble">{message.content}</div>
    </div>
  )
}
