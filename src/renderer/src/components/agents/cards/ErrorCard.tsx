import './ConsoleCard.css'

interface ErrorCardProps {
  message: string
  timestamp: number
  searchClass: string
}

export function ErrorCard({ message }: ErrorCardProps): React.JSX.Element {
  return (
    <div className="console-card console-card--error" data-testid="console-line-error">
      {message}
    </div>
  )
}
