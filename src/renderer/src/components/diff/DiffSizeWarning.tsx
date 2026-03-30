import { AlertTriangle } from 'lucide-react'
import { Button } from '../ui/Button'

interface DiffSizeWarningProps {
  sizeBytes: number
  onLoadAnyway: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DiffSizeWarning({
  sizeBytes,
  onLoadAnyway
}: DiffSizeWarningProps): React.JSX.Element {
  return (
    <div className="bde-warning-banner">
      <AlertTriangle size={16} />
      <span>
        Large diff ({formatBytes(sizeBytes)}) may slow down the editor. Line commenting will be
        disabled.
      </span>
      <Button variant="ghost" size="sm" onClick={onLoadAnyway}>
        Load anyway
      </Button>
    </div>
  )
}
