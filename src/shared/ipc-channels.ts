/**
 * Typed IPC channel map — single source of truth for channel names and payloads.
 *
 * Each entry maps a channel name to its `args` tuple and `result` type.
 * Both `safeHandle()` (main) and `typedInvoke()` (preload) derive their
 * types from this map, giving end-to-end compile-time safety.
 *
 * Channels not yet in this map still work via the untyped `safeHandle` overload.
 * Add channels here incrementally — see TODO comments in handler files.
 */

import type { SpawnLocalAgentArgs, SpawnLocalAgentResult } from './types'

/** Serialisable subset of RequestInit for the github:fetch IPC proxy. */
export interface GitHubFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

/** Shape returned by the github:fetch IPC handler. */
export interface GitHubFetchResult {
  ok: boolean
  status: number
  body: unknown
  /** Parsed "next" URL from the GitHub Link header (for pagination). */
  linkNext: string | null
}

export interface IpcChannelMap {
  // --- Config ---
  'get-gateway-config': {
    args: []
    result: { url: string; token: string }
  }
  'save-gateway-config': {
    args: [url: string, token: string]
    result: void
  }

  // --- Git ---
  'git:status': {
    args: [cwd: string]
    result: { files: { path: string; status: string; staged: boolean }[] }
  }
  'git:diff': {
    args: [cwd: string, file?: string]
    result: string
  }

  // --- Agents ---
  'local:spawnClaudeAgent': {
    args: [args: SpawnLocalAgentArgs]
    result: SpawnLocalAgentResult
  }

  // --- GitHub API proxy ---
  'github:fetch': {
    args: [path: string, init?: GitHubFetchInit]
    result: GitHubFetchResult
  }

  // --- Terminal ---
  'terminal:create': {
    args: [opts: { cols: number; rows: number; shell?: string }]
    result: number
  }
}
