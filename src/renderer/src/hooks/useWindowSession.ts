import { useCallback, useEffect, useRef, useState } from 'react'
import type { SprintTask } from '../../../shared/types'

const LAST_CLOSE_KEY = 'fleet:last-window-close'

interface WindowSession {
  showBriefing: boolean
  briefingTasks: SprintTask[]
  dismissBriefing: () => void
}

/**
 * Tracks completions since the last window close and surfaces a briefing flag.
 * Reads and writes `fleet:last-window-close` in localStorage so the persistence
 * concern lives here, not in the view.
 */
interface BriefingState {
  showBriefing: boolean
  briefingTasks: SprintTask[]
}

const INITIAL_BRIEFING: BriefingState = { showBriefing: false, briefingTasks: [] }

export function useWindowSession(tasks: SprintTask[]): WindowSession {
  const [briefing, setBriefing] = useState<BriefingState>(INITIAL_BRIEFING)
  const checked = useRef(false)

  useEffect(() => {
    if (checked.current || tasks.length === 0) return
    checked.current = true

    const stored = localStorage.getItem(LAST_CLOSE_KEY)
    if (!stored) return

    const lastCloseTime = parseInt(stored, 10)
    if (isNaN(lastCloseTime)) return

    const newCompletions = tasks.filter((task) => {
      if (!task.completed_at) return false
      return new Date(task.completed_at).getTime() > lastCloseTime
    })

    if (newCompletions.length > 0) {
      setBriefing({ showBriefing: true, briefingTasks: newCompletions })
    }
  }, [tasks])

  const dismissBriefing = useCallback(() => {
    localStorage.setItem(LAST_CLOSE_KEY, Date.now().toString())
    setBriefing(INITIAL_BRIEFING)
  }, [])

  return { showBriefing: briefing.showBriefing, briefingTasks: briefing.briefingTasks, dismissBriefing }
}
