import { useEffect } from 'react'
import { toast } from '../stores/toasts'

function formatOpenUntil(openUntil: number): string {
  const remainingMs = openUntil - Date.now()
  if (remainingMs <= 0) return 'now'
  const minutes = Math.ceil(remainingMs / 60_000)
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/**
 * Surfaces main-process manager + task-terminal events to the user via toasts.
 *
 * `agent-manager:circuit-breaker-open` fires when the agent manager pauses
 * drain after consecutive spawn failures — the user needs to know the queue
 * has stopped pulling work, otherwise queued tasks look mysteriously stuck.
 *
 * `task-terminal:resolution-error` fires when dependency resolution fails on
 * a terminal status transition — the task itself completed, but downstream
 * unblocking did not happen, so blocked tasks may stay blocked silently.
 */
export function useManagerEventListener(): void {
  useEffect(() => {
    const unsubCircuit = window.api.agentManager.onCircuitBreakerOpen((payload) => {
      toast.error(
        `Agent manager paused — ${payload.consecutiveFailures} consecutive spawn failures. Drain resumes in ${formatOpenUntil(payload.openUntil)}.`,
        15_000
      )
    })

    const unsubTerminal = window.api.sprint.onTerminalError((payload) => {
      toast.error(
        `Task dependency resolution failed: ${payload.error}. Check blocked tasks — they may need manual review.`,
        12_000
      )
    })

    const unsubWarning = window.api.agentManager.onWarning((payload) => {
      toast.info(payload.message, { durationMs: 10_000 })
    })

    return () => {
      unsubCircuit()
      unsubTerminal()
      unsubWarning()
    }
  }, [])
}
