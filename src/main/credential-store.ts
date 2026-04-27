/**
 * Low-level Claude credential I/O — reads the macOS Keychain entry and the
 * file-based OAuth token, detects the Claude Code CLI on disk, and reports
 * a unified `AuthStatus`.
 *
 * Kept separate from `auth-guard.ts` and `services/credential-service.ts` so
 * both can depend on it without depending on each other.
 */
import { execFile, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import { getOAuthToken } from './env-utils'

function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve({ stdout, stderr })
    })
  })
}

export interface AuthStatus {
  cliFound: boolean
  tokenFound: boolean
  tokenExpired: boolean
  expiresAt?: Date
}

/**
 * Shape of the JSON value the macOS `security` CLI prints for the
 * 'Claude Code-credentials' entry. We can't trust the OS to hand us the
 * exact shape (user could edit the entry; different SDK versions may write
 * different fields), so validate at the parse boundary and treat any
 * structural mismatch as "no credential".
 */
const KeychainOAuthSchema = z
  .object({
    accessToken: z.string().optional(),
    expiresAt: z.string().optional()
  })
  .strict()

const KeychainPayloadSchema = z
  .object({
    claudeAiOauth: KeychainOAuthSchema.optional()
  })
  .strict()

export type KeychainOAuth = z.infer<typeof KeychainOAuthSchema>
export type KeychainPayload = z.infer<typeof KeychainPayloadSchema>

export interface CredentialStore {
  readToken(): Promise<KeychainPayload | null>
  /**
   * Reads the file-based OAuth token at `~/.fleet/oauth-token`. Used as a
   * fallback when the Keychain lookup returns null — which happens for
   * unsigned/newly-installed bundles whose code identity isn't on the
   * keychain entry's ACL. The file is written by the agent manager's
   * Keychain-refresh path and is what the runtime uses to authenticate
   * spawns, so its presence is sufficient proof of authentication even
   * when the UI can't reach the Keychain directly.
   *
   * Returns the raw access token string, or null if the file is missing
   * or fails validation (insecure permissions, symlink, etc.).
   */
  readFileToken(): string | null
  detectCli(): boolean
}

// Fallback paths used only when `which` is unavailable — kept for robustness
const CLI_FALLBACK_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.local', 'bin')]

// DL-22: Rate limiting for keychain reads to prevent abuse
const KEYCHAIN_RATE_LIMIT_MS = 1000 // 1 second between reads
let lastKeychainRead = 0
let cachedKeychainResult: KeychainPayload | null = null

export class MacOSCredentialStore implements CredentialStore {
  async readToken(): Promise<KeychainPayload | null> {
    // DL-22: Enforce rate limit — return cached result instead of throwing
    const now = Date.now()
    const timeSinceLastRead = now - lastKeychainRead
    if (timeSinceLastRead < KEYCHAIN_RATE_LIMIT_MS) {
      return cachedKeychainResult
    }
    lastKeychainRead = now

    try {
      const { stdout } = await execFileAsync('/usr/bin/security', [
        'find-generic-password',
        '-s',
        'Claude Code-credentials',
        '-w'
      ])
      const parsed = KeychainPayloadSchema.safeParse(JSON.parse(stdout.trim()))
      if (!parsed.success) {
        cachedKeychainResult = null
        return null
      }
      cachedKeychainResult = parsed.data
      return cachedKeychainResult
    } catch {
      cachedKeychainResult = null
      return null
    }
  }

  detectCli(): boolean {
    // Try `which claude` first — handles nvm, npm-global, mise, asdf, and any other install location.
    // Using /usr/bin/which directly to avoid PATH shadowing and because this runs synchronously.
    const result = spawnSync('/usr/bin/which', ['claude'], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.trim()) return true
    // Fallback: check common paths directly in case `which` itself is unavailable
    return CLI_FALLBACK_PATHS.some((dir) => existsSync(join(dir, 'claude')))
  }

  readFileToken(): string | null {
    return getOAuthToken()
  }
}

export const defaultCredentialStore = new MacOSCredentialStore()

export async function checkAuthStatus(
  store: CredentialStore = defaultCredentialStore
): Promise<AuthStatus> {
  const cliFound = store.detectCli()
  const payload = await store.readToken()

  if (payload === null) {
    // Keychain read failed entirely — typical for unsigned/newly-installed
    // bundles whose code identity isn't on the keychain entry's ACL. Fall
    // back to the file-based OAuth token the runtime uses for agent spawns;
    // if it exists and validates, the user IS authenticated. We can't see
    // expiry metadata from the raw file, so report the token as unexpired
    // and let the SDK produce a 401 at spawn time if it's actually stale.
    return fileFallbackStatus(store, cliFound)
  }

  const oauth = payload.claudeAiOauth
  if (!oauth?.accessToken) {
    return fileFallbackStatus(store, cliFound)
  }

  if (!oauth.expiresAt) {
    return { cliFound, tokenFound: true, tokenExpired: true }
  }
  const expiresMs = parseInt(oauth.expiresAt, 10)
  if (Number.isNaN(expiresMs)) {
    return { cliFound, tokenFound: true, tokenExpired: true }
  }
  const expiresAt = new Date(expiresMs)
  const tokenExpired = new Date() >= expiresAt

  return { cliFound, tokenFound: true, tokenExpired, expiresAt }
}

function fileFallbackStatus(store: CredentialStore, cliFound: boolean): AuthStatus {
  const fileToken = store.readFileToken()
  if (fileToken) {
    return { cliFound, tokenFound: true, tokenExpired: false }
  }
  return { cliFound, tokenFound: false, tokenExpired: false }
}
