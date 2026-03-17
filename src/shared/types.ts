/**
 * Shared types used across main, preload, and renderer processes.
 * Single source of truth — do not redefine these elsewhere.
 */

export interface AgentMeta {
  id: string
  pid: number | null
  bin: string
  model: string
  repo: string
  repoPath: string
  task: string
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  status: 'running' | 'done' | 'failed' | 'unknown'
  logPath: string
  source: 'bde' | 'openclaw' | 'external'
}

export interface SprintTask {
  id: string
  title: string
  repo: string
  prompt: string | null
  priority: number
  status: 'backlog' | 'queued' | 'active' | 'done' | 'cancelled'
  notes: string | null
  spec: string | null
  agent_run_id: string | null
  pr_number: number | null
  pr_status: 'open' | 'merged' | 'closed' | 'draft' | null
  pr_url: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string
  created_at: string
}

export interface SpawnLocalAgentArgs {
  task: string
  repoPath: string
  model?: string
}

export interface SpawnLocalAgentResult {
  pid: number
  logPath: string
  id: string
  interactive: boolean
}

/** A file attachment queued for sending with a chat message. */
export interface Attachment {
  path: string
  name: string
  type: 'image' | 'text'
  /** base64 data URL for image thumbnails / inline rendering */
  preview?: string
  /** Raw base64 data (no data-url prefix) for images */
  data?: string
  /** MIME type for images (e.g. image/png) */
  mimeType?: string
  /** Text content for text files */
  content?: string
}
