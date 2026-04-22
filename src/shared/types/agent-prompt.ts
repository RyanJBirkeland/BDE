/**
 * Cross-cutting prompt input shape shared by `lib/prompt-composer.ts` and the
 * per-agent builders under `agent-manager/prompt-*.ts`. Defining it in `shared/`
 * breaks the import cycle that previously ran lib → agent-manager and back.
 */
import type { AgentType } from './agent-types'
import type { ReviewResult } from './review-types'

export interface BuildPromptInput {
  agentType: AgentType
  taskContent?: string | undefined
  branch?: string | undefined
  playgroundEnabled?: boolean | undefined
  messages?: Array<{ role: string; content: string }> | undefined
  formContext?: { title: string; repo: string; spec: string } | undefined
  repoPath?: string | undefined
  codebaseContext?: string | undefined
  retryCount?: number | undefined
  previousNotes?: string | undefined
  maxRuntimeMs?: number | null | undefined
  upstreamContext?:
    | Array<{ title: string; spec: string; partial_diff?: string | undefined }>
    | undefined
  crossRepoContract?: string | null | undefined
  repoName?: string | null | undefined
  taskId?: string | undefined
  priorScratchpad?: string | undefined
  revisionFeedback?: { timestamp: string; feedback: string; attempt: number }[] | undefined
  // Reviewer-only fields
  reviewerMode?: 'review' | 'chat' | undefined
  diff?: string | undefined
  reviewSeed?: ReviewResult | undefined
}
