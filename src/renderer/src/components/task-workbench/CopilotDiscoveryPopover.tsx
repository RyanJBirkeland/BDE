import { X } from 'lucide-react'

interface CopilotDiscoveryPopoverProps {
  onDismiss: () => void
}

/**
 * First-run discoverability popover for the Task Workbench AI Copilot.
 *
 * Rendered once per user — dismissal is persisted via localStorage key
 * `bde:workbench-copilot-popover-seen` by the parent (TaskWorkbench).
 */
export function CopilotDiscoveryPopover({
  onDismiss
}: CopilotDiscoveryPopoverProps): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-labelledby="wb-copilot-popover-title"
      aria-describedby="wb-copilot-popover-body"
      className="wb-copilot-popover"
    >
      <div className="wb-copilot-popover__arrow" aria-hidden="true" />
      <button
        type="button"
        className="wb-copilot-popover__close"
        onClick={onDismiss}
        aria-label="Dismiss copilot popover"
      >
        <X size={14} />
      </button>
      <h3 id="wb-copilot-popover-title" className="wb-copilot-popover__title">
        Meet the AI Copilot
      </h3>
      <p id="wb-copilot-popover-body" className="wb-copilot-popover__body">
        Get help drafting task specs. Open the copilot any time from this toggle.
      </p>
      <button type="button" className="wb-copilot-popover__cta" onClick={onDismiss}>
        Got it
      </button>
    </div>
  )
}
