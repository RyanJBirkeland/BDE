import { promisify } from 'util'
import { execFile, spawn } from 'child_process'
import { readdir, stat, access, mkdir } from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { parseGitHubRemote } from '../../shared/git-remote'
import { getSettingJson } from '../settings'
import { safeHandle } from '../ipc-utils'
import { broadcast } from '../broadcast'
import type { LocalRepoInfo, GithubRepoInfo, CloneProgressEvent } from '../../shared/ipc-channels'
import { createLogger } from '../logger'
import { getErrorMessage } from '../../shared/errors'

const execFileAsync = promisify(execFile)
const logger = createLogger('repo-discovery')

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
}

function expandTilde(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
}

function getConfiguredRepos(): RepoConfig[] {
  return (getSettingJson('repos') as RepoConfig[] | null) ?? []
}

function validateDir(dir: string): void {
  if (typeof dir !== 'string' || (!dir.startsWith('/') && !dir.startsWith('~'))) {
    throw new Error(`Invalid directory: must be an absolute path`)
  }
  if (dir.includes('..')) {
    throw new Error(`Invalid directory: path traversal not allowed`)
  }
}

export async function scanLocalRepos(dirs: string[]): Promise<LocalRepoInfo[]> {
  for (const d of dirs) validateDir(d)

  const configured = getConfiguredRepos()
  const configuredPaths = new Set(configured.map((r) => r.localPath))

  const results: LocalRepoInfo[] = []

  for (const rawDir of dirs) {
    const dir = expandTilde(rawDir)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (err) {
      logger.warn(`[discoverRepos] failed to read directory ${dir}: ${getErrorMessage(err)}`)
      continue
    }

    const checks = entries.map(async (entry) => {
      const fullPath = path.join(dir, entry)
      try {
        const s = await stat(fullPath)
        if (!s.isDirectory()) return null
        await access(path.join(fullPath, '.git'))
      } catch (err) {
        logger.warn(`[discoverRepos] failed to stat or access ${fullPath}: ${getErrorMessage(err)}`)
        return null
      }

      if (configuredPaths.has(fullPath)) return null

      let owner: string | undefined
      let repo: string | undefined
      try {
        const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
          cwd: fullPath
        })
        const parsed = parseGitHubRemote(stdout.trim())
        if (parsed) {
          owner = parsed.owner
          repo = parsed.repo
        }
      } catch (err) {
        logger.warn(`[discoverRepos] failed to get remote for ${fullPath}: ${getErrorMessage(err)}`)
        // No remote — still return it
      }

      return { name: entry, localPath: fullPath, owner, repo } as LocalRepoInfo
    })

    const found = await Promise.all(checks)
    for (const r of found) {
      if (r) results.push(r)
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listGithubRepos(): Promise<GithubRepoInfo[]> {
  const configured = getConfiguredRepos()
  const configuredSet = new Set(
    configured
      .filter((r) => r.githubOwner && r.githubRepo)
      .map((r) => `${r.githubOwner}/${r.githubRepo}`.toLowerCase())
  )

  let stdout: string
  try {
    const result = await execFileAsync('gh', [
      'repo',
      'list',
      '--json',
      'name,owner,description,visibility,url',
      '--limit',
      '100'
    ])
    stdout = result.stdout
  } catch (err: unknown) {
    const e = err as { code?: string; stderr?: string; message?: string }
    if (e.code === 'ENOENT') {
      throw new Error('GitHub CLI (gh) is not installed. Install it from https://cli.github.com/')
    }
    if (e.stderr?.includes('auth login') || e.stderr?.includes('not logged')) {
      throw new Error('GitHub CLI is not authenticated. Run `gh auth login` in your terminal.')
    }
    throw new Error(`Failed to list GitHub repos: ${e.message}`)
  }

  const raw = JSON.parse(stdout) as Array<{
    name: string
    owner: { login: string }
    description: string | null
    visibility: string
    url: string
  }>

  return raw
    .map((r) => ({
      name: r.name,
      owner: r.owner.login,
      description: r.description ?? undefined,
      isPrivate: r.visibility === 'PRIVATE',
      url: r.url
    }))
    .filter((r) => !configuredSet.has(`${r.owner}/${r.name}`.toLowerCase()))
}

export function cloneRepo(owner: string, repo: string, destDir: string): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new Error(
      `Invalid repository identifier: owner and repo must contain only alphanumeric characters, hyphens, underscores, and dots`
    )
  }

  const expanded = expandTilde(destDir)
  const target = path.join(expanded, repo)
  const url = `https://github.com/${owner}/${repo}.git`

  const sendEvent = (evt: Partial<CloneProgressEvent>): void => {
    broadcast('repos:cloneProgress', { owner, repo, line: '', done: false, ...evt })
  }

  mkdir(expanded, { recursive: true })
    .then(() => {
      const proc = spawn('git', ['clone', '--progress', url, target], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })

      proc.stdout?.on('data', (data: Buffer) => {
        data
          .toString()
          .split('\n')
          .filter(Boolean)
          .forEach((line) => sendEvent({ line }))
      })
      proc.stderr?.on('data', (data: Buffer) => {
        data
          .toString()
          .split('\n')
          .filter(Boolean)
          .forEach((line) => sendEvent({ line }))
      })

      proc.on('close', (code) => {
        if (code === 0) {
          sendEvent({ done: true, localPath: target })
        } else {
          sendEvent({ done: true, error: `Clone failed with exit code ${code}` })
        }
      })

      proc.on('error', (err) => {
        sendEvent({ done: true, error: `Clone error: ${err.message}` })
      })
    })
    .catch((err) => {
      sendEvent({ done: true, error: `Failed to create directory: ${err.message}` })
    })
}

export function registerRepoDiscoveryHandlers(): void {
  safeHandle('repos:scanLocal', async (_e, dirs: string[]) => {
    return scanLocalRepos(dirs)
  })

  safeHandle('repos:listGithub', async () => {
    return listGithubRepos()
  })

  safeHandle('repos:clone', async (_e, owner: string, repo: string, destDir: string) => {
    cloneRepo(owner, repo, destDir)
  })
}
