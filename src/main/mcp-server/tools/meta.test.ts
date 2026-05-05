import { describe, it, expect, vi } from 'vitest'
import { registerMetaTools, type MetaToolsDeps } from './meta'
import { TASK_STATUSES, VALID_TRANSITIONS } from '../../../shared/task-state-machine'
import type { RepoConfig } from '../../paths'

type ToolResult = {
  isError?: boolean
  content: Array<{ type: 'text'; text: string }>
}
type ToolHandler = (args: unknown) => Promise<ToolResult>

function mockServer() {
  const handlers = new Map<string, ToolHandler>()
  return {
    server: {
      registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
        handlers.set(name, handler)
      }
    } as any,
    call: (name: string, args: unknown): Promise<ToolResult> => {
      const handler = handlers.get(name)
      if (!handler) throw new Error(`no handler for ${name}`)
      return handler(args)
    }
  }
}

function parseBody(res: ToolResult): unknown {
  expect(res.isError).not.toBe(true)
  return JSON.parse(res.content[0].text)
}

function fakeDeps(overrides: Partial<MetaToolsDeps> = {}): MetaToolsDeps {
  return {
    getRepos: vi.fn(() => [] as RepoConfig[]),
    ...overrides
  }
}

describe('meta.repos', () => {
  it('returns the RepoConfig[] provided by getRepos', async () => {
    const repos: RepoConfig[] = [
      {
        name: 'fleet',
        localPath: '/tmp/fleet',
        githubOwner: 'example',
        githubRepo: 'fleet',
        color: '#00ff88'
      }
    ]
    const deps = fakeDeps({ getRepos: vi.fn(() => repos) })
    const { server, call } = mockServer()
    registerMetaTools(server, deps)

    const res = await call('meta.repos', {})

    expect(parseBody(res)).toEqual(repos)
    expect(deps.getRepos).toHaveBeenCalledTimes(1)
  })

  it('returns an empty array when no repos are configured', async () => {
    const deps = fakeDeps({ getRepos: vi.fn(() => []) })
    const { server, call } = mockServer()
    registerMetaTools(server, deps)

    const res = await call('meta.repos', {})

    expect(parseBody(res)).toEqual([])
  })
})

describe('meta.taskStatuses', () => {
  it('returns the canonical TASK_STATUSES array', async () => {
    const { server, call } = mockServer()
    registerMetaTools(server, fakeDeps())

    const body = parseBody(await call('meta.taskStatuses', {})) as {
      statuses: string[]
      transitions: Record<string, string[]>
    }

    expect(body.statuses).toEqual([...TASK_STATUSES])
  })

  it('returns transitions matching VALID_TRANSITIONS (set values flattened to arrays)', async () => {
    const { server, call } = mockServer()
    registerMetaTools(server, fakeDeps())

    const body = parseBody(await call('meta.taskStatuses', {})) as {
      statuses: string[]
      transitions: Record<string, string[]>
    }

    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      expect(body.transitions[from]).toEqual([...targets])
    }
  })

  it('returns a defensive copy of transitions — not the VALID_TRANSITIONS object itself', async () => {
    const { server, call } = mockServer()
    registerMetaTools(server, fakeDeps())

    const body = parseBody(await call('meta.taskStatuses', {})) as {
      transitions: Record<string, unknown>
    }

    expect(body.transitions).not.toBe(VALID_TRANSITIONS)
    for (const key of Object.keys(body.transitions)) {
      expect(body.transitions[key]).not.toBe(VALID_TRANSITIONS[key])
    }
  })
})

describe('meta.dependencyConditions', () => {
  it('returns the task and epic dependency condition vocabularies', async () => {
    const { server, call } = mockServer()
    registerMetaTools(server, fakeDeps())

    const body = parseBody(await call('meta.dependencyConditions', {})) as {
      task: string[]
      epic: string[]
    }

    expect(body.task).toEqual(['hard', 'soft'])
    expect(body.epic).toEqual(['on_success', 'always', 'manual'])
  })
})

describe('meta.repos — credential safety', () => {
  it('strips envVars from each repo before returning it to the caller', async () => {
    const reposWithSecrets: RepoConfig[] = [
      {
        name: 'fleet',
        localPath: '/tmp/fleet',
        githubOwner: 'example',
        githubRepo: 'fleet',
        envVars: { NODE_AUTH_TOKEN: 'ghp_secret_token', OTHER_SECRET: 'super-secret' }
      }
    ]
    const deps = fakeDeps({ getRepos: vi.fn(() => reposWithSecrets) })
    const { server, call } = mockServer()
    registerMetaTools(server, deps)

    const res = await call('meta.repos', {})
    const responseText = res.content[0].text

    expect(responseText).not.toContain('envVars')
    expect(responseText).not.toContain('ghp_secret_token')
    expect(responseText).not.toContain('super-secret')
    expect(responseText).not.toContain('NODE_AUTH_TOKEN')
  })

  it('returns all non-credential repo fields intact after stripping envVars', async () => {
    const repo: RepoConfig = {
      name: 'fleet',
      localPath: '/tmp/fleet',
      githubOwner: 'example',
      githubRepo: 'fleet',
      color: '#00ff88',
      envVars: { NODE_AUTH_TOKEN: 'ghp_secret_token' }
    }
    const deps = fakeDeps({ getRepos: vi.fn(() => [repo]) })
    const { server, call } = mockServer()
    registerMetaTools(server, deps)

    const body = parseBody(await call('meta.repos', {})) as RepoConfig[]

    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('fleet')
    expect(body[0].localPath).toBe('/tmp/fleet')
    expect(body[0].githubOwner).toBe('example')
    expect(body[0].githubRepo).toBe('fleet')
    expect(body[0].color).toBe('#00ff88')
  })
})
