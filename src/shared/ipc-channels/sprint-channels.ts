/**
 * Sprint task, review, template, group, and planner IPC channels.
 */

import type {
  SprintTask,
  ClaimedTask,
  TaskTemplate,
  TaskGroup,
  EpicDependency,
  BatchOperation,
  BatchResult,
  SpecTypeSuccessRate,
  SynthesizeRequest,
  ReviseRequest,
  ReviewResult,
  PartnerMessage
} from '../types'
import type { WorkflowTemplate } from '../workflow-types'

export interface SprintChannels {
  'sprint:list': {
    args: []
    result: SprintTask[]
  }
  'sprint:create': {
    args: [
      task: {
        title: string
        repo: string
        prompt?: string
        notes?: string
        spec?: string
        priority?: number
        status?: string
        template_name?: string
        playground_enabled?: boolean
      }
    ]
    result: SprintTask
  }
  'sprint:createWorkflow': {
    args: [template: WorkflowTemplate]
    result: {
      tasks: SprintTask[]
      errors: string[]
      success: boolean
    }
  }
  'sprint:update': {
    args: [id: string, patch: Record<string, unknown>]
    result: SprintTask | null
  }
  'sprint:delete': {
    args: [id: string]
    result: { ok: boolean }
  }
  'sprint:readSpecFile': {
    args: [filePath: string]
    result: string
  }
  'sprint:generatePrompt': {
    args: [args: { taskId: string; title: string; repo: string; templateHint: string }]
    result: { taskId: string; spec: string; prompt: string }
  }
  'sprint:healthCheck': {
    args: []
    result: SprintTask[]
  }
  'sprint:claimTask': {
    args: [taskId: string]
    result: ClaimedTask | null
  }
  'sprint:readLog': {
    args: [agentId: string, fromByte?: number]
    result: { content: string; status: string; nextByte: number }
  }
  'sprint:validateDependencies': {
    args: [taskId: string, deps: Array<{ id: string; type: 'hard' | 'soft' }>]
    result: { valid: boolean; error?: string; cycle?: string[] }
  }
  'sprint:unblockTask': {
    args: [taskId: string]
    result: SprintTask | null
  }
  'sprint:getChanges': {
    args: [taskId: string]
    result: Array<{
      id: number
      task_id: string
      field: string
      old_value: string | null
      new_value: string | null
      changed_by: string
      changed_at: string
    }>
  }
  'sprint:batchUpdate': {
    args: [operations: BatchOperation[]]
    result: { results: BatchResult[] }
  }
  'sprint:batchImport': {
    args: [
      tasks: Array<{
        title: string
        repo: string
        prompt?: string
        spec?: string
        status?: string
        dependsOnIndices?: number[]
        depType?: 'hard' | 'soft'
        playgroundEnabled?: boolean
        model?: string
        tags?: string[]
        priority?: number
        templateName?: string
      }>
    ]
    result: {
      created: SprintTask[]
      errors: string[]
    }
  }
  'sprint:retry': {
    args: [taskId: string]
    result: SprintTask
  }
  'sprint:exportTasks': {
    args: [format: 'json' | 'csv']
    result: { filePath: string | null; canceled: boolean }
  }
  'sprint:exportTaskHistory': {
    args: [taskId: string]
    result: { success: boolean; path?: string }
  }
  'sprint:failureBreakdown': {
    args: []
    result: Array<{ reason: string; count: number }>
  }
  'sprint:getSuccessRateBySpecType': {
    args: []
    result: SpecTypeSuccessRate[]
  }
}

export interface ReviewChannels {
  'review:getDiff': {
    args: [payload: { worktreePath: string; base: string }]
    result: {
      files: Array<{
        path: string
        status: string
        additions: number
        deletions: number
        patch: string
      }>
    }
  }
  'review:getCommits': {
    args: [payload: { worktreePath: string; base: string }]
    result: {
      commits: Array<{ hash: string; message: string; author: string; date: string }>
    }
  }
  'review:getFileDiff': {
    args: [payload: { worktreePath: string; filePath: string; base: string }]
    result: { diff: string }
  }
  'review:mergeLocally': {
    args: [payload: { taskId: string; strategy: 'squash' | 'merge' | 'rebase' }]
    result: { success: boolean; conflicts?: string[]; error?: string }
  }
  'review:createPr': {
    args: [payload: { taskId: string; title: string; body: string }]
    result: { prUrl: string }
  }
  'review:requestRevision': {
    args: [payload: { taskId: string; feedback: string; mode: 'resume' | 'fresh' }]
    result: { success: boolean }
  }
  'review:discard': {
    args: [payload: { taskId: string }]
    result: { success: boolean }
  }
  'review:shipIt': {
    args: [payload: { taskId: string; strategy: 'squash' | 'merge' | 'rebase' }]
    // Discriminated: success implies pushed (merged + pushed + worktree cleaned
    // + task done). Failure leaves state intact for retry — the squash commit,
    // the worktree, and `status='review'` all remain.
    result:
      | { success: true; pushed: true }
      | { success: false; error: string; conflicts?: string[] }
  }
  'review:generateSummary': {
    args: [payload: { taskId: string }]
    result: { summary: string }
  }
  'review:checkAutoReview': {
    args: [payload: { taskId: string }]
    result: { shouldAutoMerge: boolean; shouldAutoApprove: boolean; matchedRule: string | null }
  }
  'review:rebase': {
    args: [payload: { taskId: string }]
    result: { success: boolean; baseSha?: string; error?: string; conflicts?: string[] }
  }
  'review:checkFreshness': {
    args: [payload: { taskId: string }]
    result: { status: 'fresh' | 'stale' | 'conflict' | 'unknown'; commitsBehind?: number }
  }
}

/** Task template CRUD */
export interface TemplateChannels {
  'templates:list': {
    args: []
    result: TaskTemplate[]
  }
  'templates:save': {
    args: [template: TaskTemplate]
    result: void
  }
  'templates:delete': {
    args: [name: string]
    result: void
  }
  'templates:reset': {
    args: [name: string]
    result: void
  }
}

/** Spec synthesizer AI-powered generation */
export interface SynthesizerChannels {
  'synthesizer:generate': {
    args: [request: SynthesizeRequest]
    result: { streamId: string }
  }
  'synthesizer:revise': {
    args: [request: ReviseRequest]
    result: { streamId: string }
  }
  'synthesizer:cancel': {
    args: [streamId: string]
    result: { ok: boolean }
  }
}

/** Task group operations */
export interface GroupChannels {
  'groups:create': {
    args: [input: { name: string; icon?: string; accent_color?: string; goal?: string }]
    result: TaskGroup
  }
  'groups:list': {
    args: []
    result: TaskGroup[]
  }
  'groups:get': {
    args: [id: string]
    result: TaskGroup | null
  }
  'groups:update': {
    args: [
      id: string,
      patch: {
        name?: string
        icon?: string
        accent_color?: string
        goal?: string
        status?: 'draft' | 'ready' | 'in-pipeline' | 'completed'
      }
    ]
    result: TaskGroup
  }
  'groups:delete': {
    args: [id: string]
    result: void
  }
  'groups:addTask': {
    args: [taskId: string, groupId: string]
    result: boolean
  }
  'groups:removeTask': {
    args: [taskId: string]
    result: boolean
  }
  'groups:getGroupTasks': {
    args: [groupId: string]
    result: SprintTask[]
  }
  'groups:queueAll': {
    args: [groupId: string]
    result: number
  }
  'groups:reorderTasks': {
    args: [groupId: string, orderedTaskIds: string[]]
    result: boolean
  }
  'groups:addDependency': {
    args: [groupId: string, dep: EpicDependency]
    result: TaskGroup
  }
  'groups:removeDependency': {
    args: [groupId: string, upstreamId: string]
    result: TaskGroup
  }
  'groups:updateDependencyCondition': {
    args: [groupId: string, upstreamId: string, condition: EpicDependency['condition']]
    result: TaskGroup
  }
}

export interface ReviewPartnerChannels {
  'review:autoReview': {
    args: [taskId: string, force: boolean]
    result: ReviewResult
  }
  'review:chatStream': {
    args: [
      input: {
        taskId: string
        messages: PartnerMessage[]
      }
    ]
    result: { streamId: string }
  }
  'review:chatAbort': {
    args: [streamId: string]
    result: void
  }
}

/** Plan import operations */
export interface PlannerChannels {
  'planner:import': {
    args: [repo: string]
    result: {
      epicId: string
      epicName: string
      taskCount: number
    }
  }
}
