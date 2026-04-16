import { execFile, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve({ stdout: stdout as string, stderr: stderr as string })
    })
  })
}

export interface AuthStatus {
  cliFound: boolean
  tokenFound: boolean
  tokenExpired: boolean
  expiresAt?: Date
}

export interface KeychainOAuth {
  accessToken?: string
  expiresAt?: string
}

export interface KeychainPayload {
  claudeAiOauth?: KeychainOAuth
}

// ── CredentialStore abstraction ─────────────────────────────────────

export interface CredentialStore {
  readToken(): Promise<KeychainPayload | null>
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
      cachedKeychainResult = JSON.parse(stdout.trim()) as KeychainPayload
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
}

const defaultCredentialStore = new MacOSCredentialStore()

// ── Public API ──────────────────────────────────────────────────────

export async function checkAuthStatus(
  store: CredentialStore = defaultCredentialStore
): Promise<AuthStatus> {
  const cliFound = store.detectCli()
  const payload = await store.readToken()

  const oauth = payload?.claudeAiOauth
  if (!oauth?.accessToken) {
    return { cliFound, tokenFound: false, tokenExpired: false }
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

export async function ensureSubscriptionAuth(
  store: CredentialStore = defaultCredentialStore
): Promise<void> {
  // DL-16: Clear env vars unconditionally to prevent bypass (even on error path)
  delete process.env['ANTHROPIC_API_KEY']
  delete process.env['ANTHROPIC_AUTH_TOKEN']

  const status = await checkAuthStatus(store)

  if (!status.tokenFound) {
    throw new Error('No Claude subscription token found — run: claude login')
  }

  if (status.tokenExpired) {
    throw new Error('Claude subscription token expired — run: claude login')
  }
}
