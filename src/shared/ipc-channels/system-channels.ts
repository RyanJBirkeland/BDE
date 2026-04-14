/**
 * System, terminal, workbench, webhook, and repo discovery IPC channels.
 */

/**
 * Payload types for dynamic terminal data streams.
 *
 * These channels use dynamic channel names — `terminal:data:${id}` and
 * `terminal:exit:${id}` — because each PTY session needs its own event stream.
 * They cannot be registered in the static IpcChannelMap or BroadcastChannels,
 * but their payload types are documented here so callers can stay consistent.
 *
 * Main → renderer (via webContents.send):
 *   `terminal:data:${id}`  payload: string  (raw PTY output data)
 *   `terminal:exit:${id}`  payload: void    (PTY process has exited)
 *
 * Preload consumers: api-utilities.ts `terminal.onData()` and `terminal.onExit()`.
 */
export interface TerminalDataPayload {
  /** Raw output bytes from the PTY process. */
  data: string
}

/** Terminal PTY management */
export interface TerminalChannels {
  'terminal:create': {
    args: [opts: { cols: number; rows: number; shell?: string; cwd?: string }]
    result: number
  }
  'terminal:write': {
    args: [args: { id: number; data: string }]
    result: void
  }
  'terminal:resize': {
    args: [args: { id: number; cols: number; rows: number }]
    result: void
  }
  'terminal:kill': {
    args: [id: number]
    result: void
  }
}

/** Task Workbench AI-assisted creation */
export interface WorkbenchChannels {
  'workbench:generateSpec': {
    args: [input: { title: string; repo: string; templateHint: string }]
    result: { spec: string }
  }
  'workbench:checkSpec': {
    args: [input: { title: string; repo: string; spec: string; specType?: string | null }]
    result: {
      clarity: { status: 'pass' | 'warn' | 'fail'; message: string }
      scope: { status: 'pass' | 'warn' | 'fail'; message: string }
      filesExist: { status: 'pass' | 'warn' | 'fail'; message: string; missingFiles?: string[] }
    }
  }
  'workbench:checkOperational': {
    args: [input: { repo: string }]
    result: {
      auth: { status: 'pass' | 'warn' | 'fail'; message: string }
      repoPath: { status: 'pass' | 'fail'; message: string; path?: string }
      gitClean: { status: 'pass' | 'warn'; message: string }
      noConflict: { status: 'pass' | 'warn' | 'fail'; message: string }
      slotsAvailable: { status: 'pass' | 'warn'; message: string; available: number; max: number }
    }
  }
  'workbench:researchRepo': {
    args: [input: { query: string; repo: string }]
    result: {
      content: string
      filesSearched: string[]
      totalMatches: number
    }
  }
  'workbench:chatStream': {
    args: [
      input: {
        messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
        formContext: { title: string; repo: string; spec: string }
      }
    ]
    result: { streamId: string }
  }
  'workbench:cancelStream': {
    args: [streamId: string]
    result: { ok: boolean }
  }
  'workbench:extractPlan': {
    args: [markdown: string]
    result: {
      tasks: Array<{
        taskNumber: number
        title: string
        spec: string
        phase: string | null
        dependsOnTaskNumbers: number[]
      }>
    }
  }
}

/** Webhook event notifications */
export interface Webhook {
  id: string
  url: string
  events: string[]
  secret: string | null
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface WebhookChannels {
  'webhook:list': {
    args: []
    result: Webhook[]
  }
  'webhook:create': {
    args: [payload: { url: string; events: string[]; secret?: string }]
    result: Webhook
  }
  'webhook:update': {
    args: [
      payload: {
        id: string
        url?: string
        events?: string[]
        secret?: string | null
        enabled?: boolean
      }
    ]
    result: Webhook
  }
  'webhook:delete': {
    args: [payload: { id: string }]
    result: { success: boolean }
  }
  'webhook:test': {
    args: [payload: { id: string }]
    result: { success: boolean; status?: number }
  }
}

/** System metrics */
export interface LoadSample {
  t: number
  load1: number
  load5: number
  load15: number
}

export interface LoadSnapshot {
  samples: LoadSample[]
  cpuCount: number
}

export interface SystemChannels {
  'system:loadAverage': { args: []; result: LoadSnapshot }
  /** Read the current clipboard image via Electron's native API.
   *  Returns null when the clipboard contains no image data. */
  'clipboard:readImage': {
    args: []
    result: { data: string; mimeType: 'image/png' } | null
  }
}

/* ── Repo Discovery ─────────────────────────────────────────────── */

export interface LocalRepoInfo {
  name: string
  localPath: string
  owner?: string
  repo?: string
}

export interface GithubRepoInfo {
  name: string
  owner: string
  description?: string
  isPrivate: boolean
  url: string
}

export interface CloneProgressEvent {
  owner: string
  repo: string
  line: string
  done: boolean
  error?: string
  localPath?: string // expanded absolute path, set on successful clone completion
}

export interface RepoDiscoveryChannels {
  'repos:scanLocal': { args: [dirs: string[]]; result: LocalRepoInfo[] }
  'repos:listGithub': { args: []; result: GithubRepoInfo[] }
  'repos:clone': { args: [owner: string, repo: string, destDir: string]; result: void }
}
