import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function execFileAsync(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
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

const CLI_SEARCH_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.local', 'bin')]

export class MacOSCredentialStore implements CredentialStore {
  async readToken(): Promise<KeychainPayload | null> {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        'Claude Code-credentials',
        '-w',
      ])
      return JSON.parse(stdout.trim()) as KeychainPayload
    } catch {
      return null
    }
  }

  detectCli(): boolean {
    return CLI_SEARCH_PATHS.some((dir) => existsSync(join(dir, 'claude')))
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
  const status = await checkAuthStatus(store)

  if (!status.tokenFound) {
    throw new Error('No Claude subscription token found — run: claude login')
  }

  if (status.tokenExpired) {
    throw new Error('Claude subscription token expired — run: claude login')
  }

  delete process.env['ANTHROPIC_API_KEY']
  delete process.env['ANTHROPIC_AUTH_TOKEN']
}
