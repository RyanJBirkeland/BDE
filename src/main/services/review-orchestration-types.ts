/**
 * Type definitions for review orchestration service.
 *
 * Extracted to reduce line count in review-orchestration-service.ts while
 * preserving the exported API for IPC handlers.
 */

// ============================================================================
// Result Types
// ============================================================================

export interface MergeLocallyResult {
  success: boolean
  error?: string | undefined
  conflicts?: string[] | undefined
}

export interface CreatePrResult {
  success: boolean
  prUrl?: string | undefined
  error?: string | undefined
}

export interface RequestRevisionResult {
  success: boolean
}

export interface DiscardResult {
  success: boolean
}

export type ShipItResult =
  | { success: true; pushed: true }
  | { success: false; error: string; conflicts?: string[] | undefined }

export type ShipBatchResult =
  | { success: true; pushed: true; shippedTaskIds: string[] }
  | {
      success: false
      error: string
      failedTaskId: string | null
      shippedTaskIds: string[]
      conflicts?: string[] | undefined
    }

export interface RebaseResult {
  success: boolean
  baseSha?: string | undefined
  error?: string | undefined
  conflicts?: string[] | undefined
}

// ============================================================================
// Input Types
// ============================================================================

export interface MergeLocallyInput {
  taskId: string
  strategy: 'merge' | 'squash' | 'rebase'
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface CreatePrInput {
  taskId: string
  title: string
  body: string
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface RequestRevisionInput {
  taskId: string
  feedback: string
  mode: 'resume' | 'fresh'
}

export interface DiscardInput {
  taskId: string
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface ShipItInput {
  taskId: string
  strategy: 'merge' | 'squash' | 'rebase'
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface ShipBatchInput {
  taskIds: string[]
  strategy: 'merge' | 'squash' | 'rebase'
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface RebaseInput {
  taskId: string
  env: NodeJS.ProcessEnv
}
