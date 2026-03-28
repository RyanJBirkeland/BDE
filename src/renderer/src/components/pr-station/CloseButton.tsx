import { useState } from 'react'
import { X } from 'lucide-react'
import { closePR } from '../../lib/github-api'
import type { OpenPr } from '../../../../shared/types'
import { toast } from '../../stores/toasts'
import { REPO_OPTIONS } from '../../lib/constants'
import { invalidatePRCache } from '../../lib/github-cache'

interface CloseButtonProps {
  pr: OpenPr
  onClosed?: (pr: OpenPr) => void
}

export function CloseButton({ pr, onClosed }: CloseButtonProps) {
  const [closing, setClosing] = useState(false)

  const disabled = closing || pr.merged === true

  async function handleClose() {
    const repo = REPO_OPTIONS.find((r) => r.label === pr.repo)
    if (!repo) return
    setClosing(true)
    try {
      await closePR(repo.owner, repo.label, pr.number)
      invalidatePRCache(repo.owner, repo.label, pr.number)
      toast.success(`Closed: ${pr.title}`)
      onClosed?.(pr)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Close failed')
    } finally {
      setClosing(false)
    }
  }

  const closeTitle = closing ? 'Closing…' : 'Close PR'

  return (
    <button
      className="close-button bde-btn bde-btn--sm bde-btn--danger"
      onClick={handleClose}
      disabled={disabled}
      title={closeTitle}
      aria-label={closeTitle}
    >
      <X size={13} aria-hidden="true" />
      {closing ? 'Closing…' : 'Close'}
    </button>
  )
}
