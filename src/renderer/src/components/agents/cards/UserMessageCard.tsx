import './ConsoleCard.css'

interface UserMessageCardProps {
  text: string
  timestamp: number
  pending?: boolean
  searchClass: string
}

export function UserMessageCard({ text, pending }: UserMessageCardProps): React.JSX.Element {
  return (
    <div
      className={`console-card console-card--user${pending ? ' console-card--pending' : ''}`}
      data-testid="console-line-user"
    >
      {text}
    </div>
  )
}
