/**
 * useAgentConsoleActions — encapsulates AgentConsoleHeader's lifecycle IPC.
 *
 * Owns context-token polling, kill (with worktree-aware confirmation message),
 * promote-to-review, and log-tail copy. Pure UI rendering stays in the header
 * component; all `window.api.*` access lives here.
 */
import { useCallback, useEffect, useState } from 'react'
import type { AgentMeta } from '../../../shared/types'
import {
  getContextTokens,
  killAgent,
  promoteAgentToReview,
  tailLog
} from '../services/agents'
import { getGitStatus } from '../services/git'
import { useBackoffInterval } from './useBackoffInterval'
import { toast } from '../stores/toasts'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { useCodeReviewStore } from '../stores/codeReview'

export interface ContextTokens {
  current: number
  peak: number
}

export interface KillConfirmation {
  message: string
  hasUncommittedWork: boolean
}

export interface UseAgentConsoleActions {
  contextTokens: ContextTokens | null
  buildKillConfirmation: () => Promise<KillConfirmation>
  killAgent: () => Promise<void>
  promoteToReview: () => Promise<void>
  copyLogToClipboard: () => Promise<void>
}

const TOKEN_POLL_BASE_MS = 3000
const TOKEN_POLL_MAX_MS = 10_000

export function useAgentConsoleActions(agent: AgentMeta): UseAgentConsoleActions {
  const isRunning = agent.status === 'running'
  const [contextTokens, setContextTokens] = useState<ContextTokens | null>(null)

  const fetchContextTokens = useCallback(async () => {
    const result = await getContextTokens(agent.id)
    if (result != null) {
      setContextTokens({
        current: result.contextWindowTokens,
        peak: result.peakContextTokens
      })
    }
  }, [agent.id])

  useBackoffInterval(fetchContextTokens, isRunning ? TOKEN_POLL_BASE_MS : null, {
    maxMs: TOKEN_POLL_MAX_MS
  })

  // Once-after-finish snapshot so finished agents still show their peak.
  useEffect(() => {
    if (isRunning) return
    let cancelled = false
    getContextTokens(agent.id)
      .then((result) => {
        if (cancelled || result == null) return
        setContextTokens({
          current: result.contextWindowTokens,
          peak: result.peakContextTokens
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [agent.id, isRunning])

  const buildKillConfirmation = useCallback(async (): Promise<KillConfirmation> => {
    if (!agent.worktreePath) {
      return {
        message: 'This will terminate the SDK session.',
        hasUncommittedWork: false
      }
    }
    try {
      const status = await getGitStatus(agent.worktreePath)
      if (status.files.length === 0) {
        return {
          message:
            'This agent has a worktree but no uncommitted changes. The worktree will remain on disk.',
          hasUncommittedWork: false
        }
      }
      const fileList = status.files
        .slice(0, 10)
        .map((f) => `  ${f.status} ${f.path}`)
        .join('\n')
      const moreFiles =
        status.files.length > 10 ? `\n  ... and ${status.files.length - 10} more` : ''
      return {
        message: `This agent has uncommitted changes in its worktree. Killing it will leave those changes on disk but will not commit or push them.\n\nUncommitted files:\n${fileList}${moreFiles}`,
        hasUncommittedWork: true
      }
    } catch {
      return {
        message: 'This agent has a worktree. Killing it may leave uncommitted changes on disk.',
        hasUncommittedWork: false
      }
    }
  }, [agent.worktreePath])

  const requestKill = useCallback(async (): Promise<void> => {
    // Pipeline agents are keyed by sprintTaskId in AgentManager; adhoc agents by id.
    const killId = agent.sprintTaskId ?? agent.id
    await killAgent(killId)
  }, [agent.id, agent.sprintTaskId])

  const promoteToReview = useCallback(async (): Promise<void> => {
    try {
      const result = await promoteAgentToReview(agent.id)
      if (!result.ok || !result.taskId) {
        toast.error(result.error ?? 'Failed to promote agent to Code Review')
        return
      }
      toast.success('Promoted to Code Review')
      usePanelLayoutStore.getState().setView('code-review')
      useCodeReviewStore.getState().selectTask(result.taskId)
    } catch (err) {
      toast.error(`Failed to promote: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [agent.id])

  const copyLogToClipboard = useCallback(async (): Promise<void> => {
    try {
      const result = await tailLog({ logPath: agent.logPath, fromByte: 0 })
      await navigator.clipboard.writeText(result.content)
      toast.success('Log copied to clipboard')
    } catch (err) {
      toast.error(`Failed to copy log: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [agent.logPath])

  return {
    contextTokens,
    buildKillConfirmation,
    killAgent: requestKill,
    promoteToReview,
    copyLogToClipboard
  }
}
