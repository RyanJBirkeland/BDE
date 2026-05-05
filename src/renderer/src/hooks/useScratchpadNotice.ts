import { useCallback, useEffect, useState } from 'react'

const SETTING_KEY = 'scratchpad.noticeDismissed'

interface ScratchpadNotice {
  showBanner: boolean
  dismiss: () => void
}

/**
 * Owns the read/write pair for the scratchpad notice banner. Reads the
 * persisted dismissal flag on mount and exposes a `dismiss` callback that
 * hides the banner immediately and persists the flag. View components should
 * not call `window.api.settings.*` directly for this concern.
 */
export function useScratchpadNotice(): ScratchpadNotice {
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    window.api.settings
      .get(SETTING_KEY)
      .then((val) => {
        if (!val) setShowBanner(true)
      })
      .catch((err) => console.error('Failed to read scratchpad notice flag:', err))
  }, [])

  const dismiss = useCallback(() => {
    setShowBanner(false)
    void window.api.settings.set(SETTING_KEY, 'true')
  }, [])

  return { showBanner, dismiss }
}
