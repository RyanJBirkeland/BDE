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
      tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
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
        name: 'bde',
        localPath: '/tmp/bde',
        githubOwner: 'example',
        githubRepo: 'bde',
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
