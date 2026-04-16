import { useFloatingAgentStore } from '../../stores/floatingAgent'
import { FloatingAgentPanel } from './FloatingAgentPanel'
import './floating-agent.css'

export function FloatingAgentButton(): React.JSX.Element {
  const { isOpen, toggle, close } = useFloatingAgentStore()

  return (
    <>
      <button
        className={`fa-fab${isOpen ? ' fa-fab--active' : ''}`}
        onClick={toggle}
        aria-label={isOpen ? 'Close BDE Advisor' : 'Open BDE Advisor'}
        aria-expanded={isOpen}
        title="BDE Advisor (⌘.)"
      >
        <span className="fa-fab__icon" aria-hidden="true">
          ✦
        </span>
      </button>
      {isOpen && <FloatingAgentPanel onClose={close} />}
    </>
  )
}
