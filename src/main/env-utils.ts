/**
 * Shared environment utilities for spawning CLI tools and agents.
 * Consolidates PATH augmentation and OAuth token loading that was
 * previously duplicated across adhoc-agent.ts, workbench.ts, and sdk-adapter.ts.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const EXTRA_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', `${homedir()}/.local/bin`]

let _cachedEnv: Record<string, string | undefined> | null = null

/** Returns process.env with common tool paths prepended to PATH. Cached after first call. */
export function buildAgentEnv(): Record<string, string | undefined> {
  if (_cachedEnv) return _cachedEnv
  const env = { ...process.env }
  const currentPath = env.PATH ?? ''
  env.PATH = [...EXTRA_PATHS, ...currentPath.split(':')].filter(Boolean).join(':')
  _cachedEnv = env
  return env
}

let _cachedOAuthToken: string | null = null
let _tokenLoaded = false

/** Reads OAuth token from ~/.bde/oauth-token. Cached after first call. */
export function getOAuthToken(): string | null {
  if (_tokenLoaded) return _cachedOAuthToken
  _tokenLoaded = true
  const tokenPath = join(homedir(), '.bde', 'oauth-token')
  try {
    if (existsSync(tokenPath)) {
      _cachedOAuthToken = readFileSync(tokenPath, 'utf8').trim()
    }
  } catch {
    _cachedOAuthToken = null
  }
  return _cachedOAuthToken
}

/** Returns process.env with augmented PATH and OAuth token as ANTHROPIC_API_KEY. */
export function buildAgentEnvWithAuth(): Record<string, string | undefined> {
  const env = { ...buildAgentEnv() }
  const token = getOAuthToken()
  if (token) {
    env.ANTHROPIC_API_KEY = token
  }
  return env
}

/** Reset caches — for testing only. */
export function _resetEnvCache(): void {
  _cachedEnv = null
  _cachedOAuthToken = null
  _tokenLoaded = false
}
