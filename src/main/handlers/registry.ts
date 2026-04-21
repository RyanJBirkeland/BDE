import type { AgentManager } from '../agent-manager'
import type { TaskTerminalService } from '../services/task-terminal-service'
import type { DialogService } from '../dialog-service'
import type { ReviewService } from '../services/review-service'
import type { ChatStreamDeps } from './review-assistant'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { EpicGroupService } from '../services/epic-group-service'

import { registerAgentHandlers } from './agent-handlers'
import { registerGitHandlers } from './git-handlers'
import { registerTerminalHandlers } from './terminal-handlers'
import { registerConfigHandlers } from './config-handlers'
import { registerWindowHandlers } from './window-handlers'
import { registerSprintLocalHandlers } from './sprint-local'
import { registerSprintExportHandlers } from './sprint-export-handlers'
import { registerSprintBatchHandlers } from './sprint-batch-handlers'
import { registerSprintRetryHandler } from './sprint-retry-handler'
import { registerCostHandlers } from './cost-handlers'
import { registerFsHandlers } from '../fs'
import { registerTemplateHandlers } from './template-handlers'
import { registerAuthHandlers, registerOnboardingHandlers } from './auth-handlers'
import { registerAgentManagerHandlers } from './agent-manager-handlers'
import { registerWorkbenchHandlers } from './workbench'
import { registerMemorySearchHandler } from './memory-search'
import { registerIdeFsHandlers } from './ide-fs-handlers'
import { registerDashboardHandlers } from './dashboard-handlers'
import { registerSynthesizerHandlers } from './synthesizer-handlers'
import { registerClaudeConfigHandlers } from './claude-config-handlers'
import { registerReviewHandlers } from './review'
import { registerReviewAssistantHandlers } from './review-assistant'
import { registerWebhookHandlers } from './webhook-handlers'
import { registerGroupHandlers } from './group-handlers'
import { registerPlannerImportHandlers } from './planner-import'
import { registerRepoDiscoveryHandlers } from './repo-discovery'
import { registerTearoffHandlers } from '../tearoff-manager'

export interface TerminalDeps {
  onStatusTerminal: TaskTerminalService['onStatusTerminal']
  dialog: DialogService
}

export interface AppHandlerDeps {
  agentManager?: AgentManager | undefined
  terminalDeps: TerminalDeps
  reviewService?: ReviewService | undefined
  reviewChatStreamDeps?: ChatStreamDeps | undefined
  repo: ISprintTaskRepository
  epicGroupService: EpicGroupService
}

/**
 * Registers all IPC handlers for the application.
 * Consolidates handler registration to reduce coupling in index.ts.
 */
export function registerAllHandlers(deps: AppHandlerDeps): void {
  const {
    agentManager,
    terminalDeps,
    reviewService,
    reviewChatStreamDeps,
    repo,
    epicGroupService
  } = deps

  // Agent-related handlers (conditional on agentManager presence)
  if (agentManager) {
    registerAgentHandlers(agentManager, repo)
    registerAgentManagerHandlers(agentManager)
    registerWorkbenchHandlers(agentManager)
  } else {
    registerAgentHandlers(undefined, repo)
    registerAgentManagerHandlers(undefined)
    registerWorkbenchHandlers()
  }

  registerSynthesizerHandlers()

  // Core handlers
  registerConfigHandlers()
  registerGitHandlers(terminalDeps)
  registerTerminalHandlers()
  registerWindowHandlers()

  // Sprint task handlers
  registerSprintLocalHandlers(terminalDeps, repo)
  registerSprintExportHandlers({ dialog: terminalDeps.dialog })
  registerSprintBatchHandlers({ onStatusTerminal: terminalDeps.onStatusTerminal, repo })
  registerSprintRetryHandler()

  // Utility handlers
  registerCostHandlers()
  registerTemplateHandlers()
  registerFsHandlers()
  registerIdeFsHandlers()
  registerMemorySearchHandler()
  registerAuthHandlers()
  registerOnboardingHandlers()
  registerDashboardHandlers()
  registerTearoffHandlers()
  registerClaudeConfigHandlers()

  // Review handlers
  registerReviewHandlers(terminalDeps)
  if (reviewService && reviewChatStreamDeps) {
    registerReviewAssistantHandlers({
      reviewService,
      chatStreamDeps: reviewChatStreamDeps
    })
  }

  // Planning and discovery handlers
  registerWebhookHandlers()
  registerGroupHandlers(epicGroupService)
  registerPlannerImportHandlers({ dialog: terminalDeps.dialog })
  registerRepoDiscoveryHandlers()
}
