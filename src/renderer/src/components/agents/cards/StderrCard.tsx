import './ConsoleCard.css'

interface StderrCardProps {
  text: string
  timestamp: number
  searchClass: string
}

export function StderrCard({ text }: StderrCardProps): React.JSX.Element {
  return (
    <div className="console-card console-card--stderr" data-testid="console-line-stderr">
      {text}
    </div>
  )
}
