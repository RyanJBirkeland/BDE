/**
 * Shared environment utilities for spawning CLI tools and agents.
 * Consolidates PATH augmentation and OAuth token loading that was
 * previously duplicated across adhoc-agent.ts, workbench.ts, and sdk-adapter.ts.
 */
import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { homedir, userInfo } from 'node:os'

const EXTRA_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', `${homedir()}/.local/bin`]

let _cachedEnv: Record<string, string | undefined> | null = null

// Allowlist of environment variables that agents need
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'TERM',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'NODE_PATH'
]

/**
 * Prepends EXTRA_PATHS to process.env.PATH (idempotent — safe to call multiple times).
 *
 * Why this exists: Node's child_process.spawn(file, args, { env }) resolves the
 * binary name against the *caller's* process.env.PATH, NOT the env you pass to
 * the child. Packaged Electron apps on macOS launched from Finder/Spotlight get
 * a minimal /usr/bin:/bin PATH and can't find tools installed via npm/brew/etc.
 * Mutating process.env.PATH at startup makes ALL subsequent spawn() calls work
 * (including the @anthropic-ai/claude-agent-sdk's internal claude lookup).
 */
export function ensureExtraPathsOnProcessEnv(): void {
  const current = process.env.PATH ?? ''
  const parts = current.split(':').filter(Boolean)
  const missing = EXTRA_PATHS.filter((p) => !parts.includes(p))
  if (missing.length === 0) return
  process.env.PATH = [...missing, ...parts].join(':')
}

/** Returns allowlisted env vars with common tool paths prepended to PATH. Cached after first call. */
export function buildAgentEnv(): Record<string, string | undefined> {
  if (_cachedEnv) return { ..._cachedEnv }
  const env: Record<string, string | undefined> = {}

  // Copy only allowlisted environment variables
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]
    }
  }

  // Also allow npm_config_* variables
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('npm_config_') && process.env[key] !== undefined) {
      env[key] = process.env[key]
    }
  }

  // Prepend extra paths to PATH
  const currentPath = env.PATH ?? ''
  env.PATH = [...EXTRA_PATHS, ...currentPath.split(':')].filter(Boolean).join(':')

  _cachedEnv = env
  return { ..._cachedEnv }
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
      // DL-7: Verify token file has restrictive permissions (user-only read/write)
      const stats = statSync(tokenPath)
      const mode = stats.mode & 0o777
      if (mode !== 0o600) {
        console.warn(
          `[env-utils] OAuth token file has insecure permissions: ${mode.toString(8)}. Expected: 600`
        )
      }
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

// ---------------------------------------------------------------------------
// OAuth refresh — Anthropic's published OAuth token endpoint and Claude Code's
// public client id. We refresh the access token via this endpoint when the
// keychain copy is expired/near-expiry, instead of just rewriting the same
// dead token from the keychain (which is what this module did before).
// ---------------------------------------------------------------------------

const KEYCHAIN_SERVICE = 'Claude Code-credentials'
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 minutes before expiry

interface ClaudeOauth {
  accessToken: string
  refreshToken?: string
  /** Stored as a string in keychain. Format is ms since epoch (sometimes seconds). */
  expiresAt?: string
}

interface ClaudeCreds {
  claudeAiOauth?: ClaudeOauth
  [key: string]: unknown
}

interface RefreshResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

/**
 * Parse the keychain `expiresAt` field into ms-since-epoch.
 * Handles both seconds-since-epoch and ms-since-epoch storage formats —
 * Claude Code has historically used both.
 */
export function parseExpiresAt(raw: unknown): number | null {
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (!Number.isFinite(n)) return null
  // Heuristic: anything below 1e12 must be in seconds (ms-since-epoch in
  // year 2001 is already well above 1e12).
  return n < 1e12 ? n * 1000 : n
}

/** Returns true if the keychain access token is expired or within the refresh buffer. */
export function shouldRefresh(expiresAtMs: number | null): boolean {
  if (expiresAtMs == null) return false // unknown expiry — don't gamble on a refresh
  return Date.now() >= expiresAtMs - REFRESH_BUFFER_MS
}

/**
 * POST to Anthropic's OAuth token endpoint to exchange a refresh_token for a
 * fresh access_token (and a rotated refresh_token).
 */
async function postOAuthRefresh(refreshToken: string): Promise<RefreshResponse> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID
    })
  })
  if (!response.ok) {
    throw new Error(`OAuth refresh failed: HTTP ${response.status}`)
  }
  const data = (await response.json()) as RefreshResponse
  if (!data.access_token || !data.refresh_token) {
    throw new Error('OAuth refresh response missing access_token or refresh_token')
  }
  return data
}

/**
 * Update the macOS Keychain entry for Claude Code with refreshed credentials.
 * Uses `add-generic-password -U` (update if exists). Best-effort — failures
 * are surfaced as thrown errors so the caller can decide whether to fall back.
 */
async function writeKeychainCreds(account: string, creds: ClaudeCreds): Promise<void> {
  await execFilePromise(
    'security',
    [
      'add-generic-password',
      '-U',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      account,
      '-w',
      JSON.stringify(creds)
    ],
    { timeout: 10_000, env: buildAgentEnv() }
  )
}

/**
 * Attempts to refresh ~/.bde/oauth-token using the macOS Keychain as the
 * source of truth for credentials.
 *
 * Flow:
 *   1. Read full credential JSON from keychain (`find-generic-password`).
 *   2. Inspect `expiresAt`. If still valid, write the existing accessToken
 *      to the file (preserves prior behavior for the happy path).
 *   3. If expired/near-expiry AND a refreshToken is present, POST to the
 *      Anthropic OAuth endpoint to mint a fresh accessToken (and rotated
 *      refreshToken). Persist the rotated credentials back to the keychain
 *      so subsequent refreshes don't reuse a stale refreshToken.
 *   4. Write the (possibly fresh) accessToken to ~/.bde/oauth-token.
 *
 * Always uses `execFile` (never `execSync`) so the main thread is never
 * blocked. Returns true if a token was written to disk; false only on hard
 * read failures.
 */
export async function refreshOAuthTokenFromKeychain(): Promise<boolean> {
  let creds: ClaudeCreds
  try {
    const { stdout: credJson } = await execFilePromise(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { timeout: 10_000, env: buildAgentEnv() }
    )
    creds = JSON.parse(credJson.trim()) as ClaudeCreds
  } catch {
    // Keychain access can fail (locked, not found, permissions)
    return false
  }

  const oauth = creds?.claudeAiOauth
  if (!oauth?.accessToken || typeof oauth.accessToken !== 'string') return false

  let tokenToWrite = oauth.accessToken
  const expiresAtMs = parseExpiresAt(oauth.expiresAt)

  if (shouldRefresh(expiresAtMs) && oauth.refreshToken) {
    try {
      const refreshed = await postOAuthRefresh(oauth.refreshToken)
      const newExpiresAtMs = Date.now() + refreshed.expires_in * 1000
      const updatedCreds: ClaudeCreds = {
        ...creds,
        claudeAiOauth: {
          ...oauth,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          expiresAt: String(newExpiresAtMs)
        }
      }
      // Persist rotated credentials so the next refresh doesn't reuse the
      // (now-invalidated) old refresh token. If this fails we still write
      // the fresh accessToken to the file — the user just ends up with a
      // stale keychain that they can fix via `claude login`.
      try {
        const account = userInfo().username
        await writeKeychainCreds(account, updatedCreds)
      } catch {
        console.warn(
          '[env-utils] OAuth refresh succeeded but writing rotated credentials back to Keychain failed — run `claude login` if subsequent refreshes start failing'
        )
      }
      tokenToWrite = refreshed.access_token
    } catch (err) {
      // Refresh failed (network error, 4xx from OAuth endpoint, malformed
      // response). Fall through to writing the existing — possibly expired —
      // accessToken so the agent fails with a visible 401 instead of this
      // function silently doing nothing.
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[env-utils] OAuth token refresh failed: ${msg}`)
    }
  }

  try {
    const tokenPath = join(homedir(), '.bde', 'oauth-token')
    // DL-7: Enforce restrictive permissions (user-only read/write)
    writeFileSync(tokenPath, tokenToWrite, { encoding: 'utf8', mode: 0o600 })
    invalidateOAuthToken() // Force re-read on next call
    return true
  } catch {
    return false
  }
}

/** Reset caches — for testing only. */
export function _resetEnvCache(): void {
  _cachedEnv = null
  _cachedOAuthToken = null
  _tokenLoadedAt = 0
  _cachedClaudeCliPath = null
}

let _cachedClaudeCliPath: string | null = null

/**
 * Returns the on-disk path to the bundled @anthropic-ai/claude-agent-sdk cli.js.
 *
 * Why this exists: the SDK resolves its cli.js via `dirname(import.meta.url) + 'cli.js'`.
 * In a packaged Electron app the SDK is loaded from inside `app.asar` (a virtual
 * filesystem), so the resolved path lives inside the asar archive — and
 * child_process.spawn() can't execute scripts inside an asar. Translating the
 * path to its app.asar.unpacked twin (electron-builder unpacks the SDK because
 * it ships native binaries / wasm) gives spawn() a real on-disk path to fork.
 *
 * In dev / tests this returns the regular node_modules path unchanged.
 *
 * Pass the result to the SDK's `pathToClaudeCodeExecutable` option.
 */
export function getClaudeCliPath(): string {
  if (_cachedClaudeCliPath) return _cachedClaudeCliPath
  // Prefer require.resolve so this works whether main is bundled as ESM or CJS.
  // Anchored at this file's URL so the lookup is always local to env-utils.ts.
  const req = createRequire(import.meta.url)
  // The SDK exposes sdk.mjs as its main entry — resolve it then walk to cli.js,
  // because cli.js itself is not in the package's `exports` map.
  const sdkMain = req.resolve('@anthropic-ai/claude-agent-sdk')
  const cliPath = join(dirname(sdkMain), 'cli.js').replace(
    `${join('app.asar', '')}`,
    `${join('app.asar.unpacked', '')}`
  )
  _cachedClaudeCliPath = cliPath
  return cliPath
}
