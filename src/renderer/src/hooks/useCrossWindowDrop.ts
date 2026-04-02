import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrossWindowDropState {
  active: boolean
  viewKey: string | null
  localX: number
  localY: number
}

interface CrossWindowDropResult extends CrossWindowDropState {
  handleDrop: (targetPanelId: string, zone: string) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCrossWindowDrop(): CrossWindowDropResult {
  const [state, setState] = useState<CrossWindowDropState>({
    active: false,
    viewKey: null,
    localX: 0,
    localY: 0
  })

  useEffect(() => {
    if (!window.api?.tearoff?.onDragIn) return

    const unsubs = [
      window.api.tearoff.onDragIn((p) =>
        setState({ active: true, viewKey: p.viewKey, localX: p.localX, localY: p.localY })
      ),
      window.api.tearoff.onDragMove((p) =>
        setState((s) => (s.active ? { ...s, localX: p.localX, localY: p.localY } : s))
      ),
      window.api.tearoff.onDragCancel(() =>
        setState({ active: false, viewKey: null, localX: 0, localY: 0 })
      )
    ]

    return () => unsubs.forEach((u) => u())
  }, [])

  const handleDrop = useCallback(
    (targetPanelId: string, zone: string) => {
      if (!state.viewKey) return
      window.api?.tearoff?.sendDropComplete({ viewKey: state.viewKey, targetPanelId, zone })
      setState({ active: false, viewKey: null, localX: 0, localY: 0 })
    },
    [state.viewKey]
  )

  return { ...state, handleDrop }
}
