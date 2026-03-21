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

const CLI_SEARCH_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.local', 'bin')]

function detectClaudeCli(): boolean {
  return CLI_SEARCH_PATHS.some((dir) => existsSync(join(dir, 'claude')))
}

interface KeychainOAuth {
  accessToken?: string
  expiresAt?: string
}

interface KeychainPayload {
  claudeAiOauth?: KeychainOAuth
}

async function readKeychainToken(): Promise<KeychainPayload | null> {
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

export async function checkAuthStatus(): Promise<AuthStatus> {
  const cliFound = detectClaudeCli()
  const payload = await readKeychainToken()

  const oauth = payload?.claudeAiOauth
  if (!oauth?.accessToken) {
    return { cliFound, tokenFound: false, tokenExpired: false }
  }

  const expiresAt = new Date(parseInt(oauth.expiresAt!, 10))
  const tokenExpired = new Date() >= expiresAt

  return { cliFound, tokenFound: true, tokenExpired, expiresAt }
}

export async function ensureSubscriptionAuth(): Promise<void> {
  const status = await checkAuthStatus()

  if (!status.tokenFound) {
    throw new Error('No Claude subscription token found — run: claude login')
  }

  if (status.tokenExpired) {
    throw new Error('Claude subscription token expired — run: claude login')
  }

  delete process.env['ANTHROPIC_API_KEY']
  delete process.env['ANTHROPIC_AUTH_TOKEN']
}
