import { useCallback } from 'react'
import { toast } from '../stores/toasts'
import type { AgentMeta } from '../../../shared/types'

interface UseAgentSlashCommandsParams {
  activeId: string | null
  selectedAgent: AgentMeta | undefined
}

interface UseAgentSlashCommandsResult {
  handleCommand: (cmd: string, args?: string) => Promise<void>
}

export function useAgentSlashCommands({
  activeId,
  selectedAgent
}: UseAgentSlashCommandsParams): UseAgentSlashCommandsResult {
  const handleCommand = useCallback(
    async (cmd: string, _args?: string) => {
      if (!activeId || !selectedAgent) return
      switch (cmd) {
        case '/stop':
          try {
            await window.api.agents.kill(activeId)
          } catch (err) {
            toast.error(
              `Failed to stop agent: ${err instanceof Error ? err.message : 'Unknown error'}`
            )
          }
          break
        case '/retry':
          if (selectedAgent.sprintTaskId) {
            try {
              // status is a system-managed field outside SprintTaskPatch but accepted by UPDATE_ALLOWLIST at runtime.
              await window.api.sprint.update(selectedAgent.sprintTaskId, { status: 'queued' } as Parameters<typeof window.api.sprint.update>[1])
              toast.success('Task re-queued')
            } catch (err) {
              toast.error(`Retry failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
            }
          } else {
            toast.info('Adhoc agents cannot be retried — spawn a new agent instead')
          }
          break
        case '/focus':
          if (_args) {
            const focusResult = await window.api.agents.steer(activeId, `Focus on: ${_args}`)
            if (!focusResult.ok) toast.error(focusResult.error ?? 'Failed to send focus message')
          }
          break
        case '/checkpoint': {
          const taskId = selectedAgent.sprintTaskId
          if (!taskId) {
            toast.info('/checkpoint only works for pipeline agents with a sprint task')
            break
          }
          try {
            const result = await window.api.agentManager.checkpoint(taskId, _args)
            if (result.ok) {
              toast.success(
                result.committed ? 'Checkpoint committed' : (result.error ?? 'Nothing to commit')
              )
            } else {
              toast.error(`Checkpoint failed: ${result.error ?? 'unknown error'}`)
            }
          } catch (err) {
            toast.error(
              `Checkpoint failed: ${err instanceof Error ? err.message : 'Unknown error'}`
            )
          }
          break
        }
        case '/test': {
          const result = await window.api.agents.steer(
            activeId,
            'Please run the test suite now with `npm test` (or the project-appropriate command) and report the results before continuing.'
          )
          if (!result.ok) toast.error(result.error ?? 'Failed to send /test steering')
          else toast.success('Asked agent to run tests')
          break
        }
        case '/scope': {
          if (!_args) {
            toast.info('Usage: /scope <file> [file…]')
            break
          }
          const result = await window.api.agents.steer(
            activeId,
            `Please narrow your focus to only these files for now: ${_args}. Do not modify anything outside this scope without asking first.`
          )
          if (!result.ok) toast.error(result.error ?? 'Failed to send /scope steering')
          else toast.success('Scope updated')
          break
        }
        case '/status': {
          const result = await window.api.agents.steer(
            activeId,
            'Please give a brief status report: what you have completed so far, what you are working on right now, and what remains.'
          )
          if (!result.ok) toast.error(result.error ?? 'Failed to send /status steering')
          break
        }
        default:
          break
      }
    },
    [activeId, selectedAgent]
  )

  return { handleCommand }
}
