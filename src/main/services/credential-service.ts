/**
 * CredentialService — unified credential resolution.
 *
 * Wraps the three existing Claude credential entry points
 * (`auth-guard.ts`, `agent-manager/oauth-checker.ts`, `env-utils.ts`) behind a
 * single discriminated return shape. Adds first-class GitHub resolution that
 * reads env vars → gh CLI → the `githubOptedOut` setting.
 *
 * The existing three Claude entry points still exist and are still used — this
 * service is the vocabulary every *new* call site should prefer, especially
 * pre-spawn validation (V0.6) and PR-action handlers. A follow-up will
 * migrate the old sites to delegate here; until then both paths coexist.
 *
 * See `docs/superpowers/specs/credential-service.md` for the full design.
 */
import { getOAuthToken, refreshOAuthTokenFromKeychain } from '../env-utils'
import { checkAuthStatus, MacOSCredentialStore, type CredentialStore } from '../auth-guard'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { getSetting } from '../settings'
import type { Logger } from '../logger'

const execFileAsync = promisify(execFile)

export type CredentialKind = 'claude' | 'github'

export type CredentialStatus = 'ok' | 'missing' | 'expired' | 'keychain-locked' | 'cli-missing'

export type CredentialResult =
  | {
      kind: CredentialKind
      status: 'ok'
      token: string
      expiresAt: Date | null
      cliFound: boolean
    }
  | {
      kind: CredentialKind
      status: Exclude<CredentialStatus, 'ok'>
      token: null
      expiresAt: null
      cliFound: boolean
      actionable: string | null
    }

/** Canonical guidance strings — used by toasts, task notes, and spawn failures. */
export const CREDENTIAL_GUIDANCE: Record<
  CredentialKind,
  Partial<Record<Exclude<CredentialStatus, 'ok'>, string>>
> = {
  claude: {
    missing: 'Run: claude login',
    expired: 'Run: claude login to refresh your session',
    'keychain-locked': 'macOS Keychain is locked — unlock it and try again',
    'cli-missing': 'Install Claude Code CLI and add it to your PATH'
  },
  github: {
    missing: 'Run: gh auth login',
    expired: 'Run: gh auth refresh',
    'cli-missing': 'Install the GitHub CLI (gh) and add it to your PATH'
  }
}

export interface ClaudeCredentialStore {
  readCachedToken(): string | null
  refreshFromKeychain(): Promise<boolean>
  describeAuth(): Promise<{
    cliFound: boolean
    tokenFound: boolean
    tokenExpired: boolean
    expiresAt?: Date
  }>
}

export interface GithubCredentialStore {
  getEnvToken(): string | null
  detectCli(): boolean
  isAuthenticated(): Promise<boolean>
  isOptedOut(): boolean
}

export interface CredentialService {
  getCredential(kind: CredentialKind): Promise<CredentialResult>
  refreshCredential(kind: CredentialKind): Promise<CredentialResult>
  invalidateCache(kind: CredentialKind): void
}

const SUCCESS_TTL_MS = 5 * 60 * 1000
const FAILURE_TTL_MS = 30 * 1000

interface CacheEntry {
  result: CredentialResult
  expiresAt: number
}

function okResult(
  kind: CredentialKind,
  token: string,
  expiresAt: Date | null,
  cliFound: boolean
): CredentialResult {
  return { kind, status: 'ok', token, expiresAt, cliFound }
}

function failResult(
  kind: CredentialKind,
  status: Exclude<CredentialStatus, 'ok'>,
  cliFound: boolean,
  customMessage?: string | null
): CredentialResult {
  const actionable =
    customMessage === null ? null : (customMessage ?? CREDENTIAL_GUIDANCE[kind][status] ?? null)
  return {
    kind,
    status,
    token: null,
    expiresAt: null,
    cliFound,
    actionable
  }
}

// ── Concrete Claude store backed by the existing auth-guard + env-utils ──

class DefaultClaudeStore implements ClaudeCredentialStore {
  private readonly keychainStore: CredentialStore

  constructor(keychainStore: CredentialStore = new MacOSCredentialStore()) {
    this.keychainStore = keychainStore
  }

  readCachedToken(): string | null {
    return getOAuthToken()
  }

  async refreshFromKeychain(): Promise<boolean> {
    return refreshOAuthTokenFromKeychain()
  }

  async describeAuth(): Promise<{
    cliFound: boolean
    tokenFound: boolean
    tokenExpired: boolean
    expiresAt?: Date
  }> {
    return checkAuthStatus(this.keychainStore)
  }
}

// ── Concrete GitHub store reading env → gh CLI → setting ──

const CLI_FALLBACK_PATHS = ['/usr/local/bin', '/opt/homebrew/bin']

class DefaultGithubStore implements GithubCredentialStore {
  getEnvToken(): string | null {
    const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
    return fromEnv && fromEnv.length >= 20 ? fromEnv : null
  }

  detectCli(): boolean {
    // Cheap best-effort check — good enough to distinguish "cli missing"
    // from "cli present but not logged in". The follow-up `isAuthenticated()`
    // call exercises the actual binary and catches PATH misses.
    return CLI_FALLBACK_PATHS.some((dir) => existsSync(joinPath(dir, 'gh')))
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      await execFileAsync('gh', ['auth', 'status', '--active'], { timeout: 5_000 })
      return true
    } catch {
      return false
    }
  }

  isOptedOut(): boolean {
    return getSetting('githubOptedOut') === 'true'
  }
}

// ── Service implementation ──

export function createCredentialService(deps: {
  logger: Logger
  claudeStore?: ClaudeCredentialStore
  githubStore?: GithubCredentialStore
}): CredentialService {
  const claude = deps.claudeStore ?? new DefaultClaudeStore()
  const github = deps.githubStore ?? new DefaultGithubStore()
  const cache = new Map<CredentialKind, CacheEntry>()

  async function resolveClaude(): Promise<CredentialResult> {
    const auth = await claude.describeAuth()
    if (!auth.cliFound) {
      return failResult('claude', 'cli-missing', false)
    }

    // Refresh proactively before reading the token file — matches the
    // existing oauth-checker.ts and adhoc-agent.ts pattern.
    const refreshed = await claude.refreshFromKeychain()
    if (!refreshed && !auth.tokenFound) {
      return failResult('claude', 'missing', auth.cliFound)
    }

    const token = claude.readCachedToken()
    if (!token) {
      const status = auth.tokenFound && auth.tokenExpired ? 'expired' : 'missing'
      return failResult('claude', status, auth.cliFound)
    }

    if (auth.tokenExpired) {
      return failResult('claude', 'expired', auth.cliFound)
    }

    return okResult('claude', token, auth.expiresAt ?? null, auth.cliFound)
  }

  async function resolveGithub(): Promise<CredentialResult> {
    if (github.isOptedOut()) {
      return failResult('github', 'missing', github.detectCli(), null)
    }

    const envToken = github.getEnvToken()
    if (envToken) {
      return okResult('github', envToken, null, github.detectCli())
    }

    const cliFound = github.detectCli()
    if (!cliFound) {
      return failResult('github', 'cli-missing', false)
    }

    const authed = await github.isAuthenticated()
    if (!authed) {
      return failResult('github', 'missing', cliFound)
    }

    // gh stores the token inside its own config — we don't need to read it
    // ourselves, we only need to know the caller's `gh` subprocesses will
    // succeed. Report ok with a placeholder token so callers can check
    // `status === 'ok'` without needing the literal value.
    return okResult('github', 'gh-managed', null, cliFound)
  }

  function readCache(kind: CredentialKind): CredentialResult | null {
    const entry = cache.get(kind)
    if (!entry) return null
    if (Date.now() >= entry.expiresAt) {
      cache.delete(kind)
      return null
    }
    return entry.result
  }

  function writeCache(result: CredentialResult): void {
    const ttl = result.status === 'ok' ? SUCCESS_TTL_MS : FAILURE_TTL_MS
    cache.set(result.kind, { result, expiresAt: Date.now() + ttl })
  }

  async function resolve(kind: CredentialKind): Promise<CredentialResult> {
    const result = kind === 'claude' ? await resolveClaude() : await resolveGithub()
    writeCache(result)
    return result
  }

  return {
    async getCredential(kind) {
      const cached = readCache(kind)
      if (cached) return cached
      return resolve(kind)
    },
    async refreshCredential(kind) {
      cache.delete(kind)
      return resolve(kind)
    },
    invalidateCache(kind) {
      cache.delete(kind)
    }
  }
}

// ── Module-level singleton for non-DI call sites ──

let _defaultService: CredentialService | null = null

export function getDefaultCredentialService(logger: Logger): CredentialService {
  if (!_defaultService) {
    _defaultService = createCredentialService({ logger })
  }
  return _defaultService
}

/** Reset the singleton — for tests only. */
export function _resetDefaultCredentialService(): void {
  _defaultService = null
}
