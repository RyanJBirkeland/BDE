/**
 * Shared environment utilities for spawning CLI tools and agents.
 * Consolidates PATH augmentation and OAuth token loading that was
 * previously duplicated across adhoc-agent.ts, workbench.ts, and sdk-adapter.ts.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
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
let _tokenLoadedAt = 0
const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes — re-read from disk frequently for pipeline runs

/** Reads OAuth token from ~/.bde/oauth-token. Cached for 5 minutes. */
export function getOAuthToken(): string | null {
  const now = Date.now()
  if (_tokenLoadedAt > 0 && now - _tokenLoadedAt < TOKEN_TTL_MS) return _cachedOAuthToken
  _tokenLoadedAt = now
  const tokenPath = join(homedir(), '.bde', 'oauth-token')
  try {
    if (existsSync(tokenPath)) {
      _cachedOAuthToken = readFileSync(tokenPath, 'utf8').trim()
    } else {
      _cachedOAuthToken = null
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

/** Force next getOAuthToken() call to re-read from disk. */
export function invalidateOAuthToken(): void {
  _tokenLoadedAt = 0
  _cachedOAuthToken = null
}

const execFilePromise = promisify(execFileCb)

/**
 * Attempts to refresh ~/.bde/oauth-token from the macOS Keychain.
 * Spawns the `security` CLI asynchronously (never blocks main thread).
 * Returns true if token was refreshed, false on failure.
 */
export async function refreshOAuthTokenFromKeychain(): Promise<boolean> {
  try {
    const { stdout: credJson } = await execFilePromise(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: 10_000, env: buildAgentEnv() }
    )
    const creds = JSON.parse(credJson.trim())
    const token = creds?.claudeAiOauth?.accessToken
    if (!token || typeof token !== 'string') return false

    const tokenPath = join(homedir(), '.bde', 'oauth-token')
    writeFileSync(tokenPath, token, 'utf8')
    invalidateOAuthToken() // Force re-read on next call
    return true
  } catch {
    // Keychain access can fail (locked, not found, permissions)
    return false
  }
}

/** Reset caches — for testing only. */
export function _resetEnvCache(): void {
  _cachedEnv = null
  _cachedOAuthToken = null
  _tokenLoadedAt = 0
}
