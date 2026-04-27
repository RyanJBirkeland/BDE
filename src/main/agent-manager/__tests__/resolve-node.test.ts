import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('node:fs')
vi.mock('node:os')
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>()
  return { ...actual }
})

import { resolveNodeExecutable } from '../resolve-node'

const mockExistsSync = vi.fn()
const mockReaddirSync = vi.fn()
const mockHomedir = vi.fn(() => '/home/user')

vi.mocked(await import('node:fs')).existsSync = mockExistsSync
vi.mocked(await import('node:fs')).readdirSync = mockReaddirSync as never
vi.mocked(await import('node:os')).homedir = mockHomedir

afterEach(() => {
  vi.clearAllMocks()
  delete (process.versions as Record<string, string>)['electron']
})

describe('resolveNodeExecutable', () => {
  it('returns process.execPath when running inside Electron', () => {
    ;(process.versions as Record<string, string>)['electron'] = '30.0.0'
    mockExistsSync.mockReturnValue(false)
    const result = resolveNodeExecutable()
    expect(result).toBe(process.execPath)
  })

  it('returns fnm node path when it exists', () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === '/home/user/.local/share/fnm/aliases/default/bin/node'
    )
    mockReaddirSync.mockReturnValue([])
    const result = resolveNodeExecutable()
    expect(result).toBe('/home/user/.local/share/fnm/aliases/default/bin/node')
  })

  it('returns highest nvm version node when fnm absent', () => {
    const nvmBin = '/home/user/.nvm/versions/node/v22.0.0/bin/node'
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/home/user/.nvm/versions/node') return true
      if (p === nvmBin) return true
      return false
    })
    mockReaddirSync.mockReturnValue(['v18.0.0', 'v22.0.0', 'v20.0.0'])
    const result = resolveNodeExecutable()
    expect(result).toBe(nvmBin)
  })

  it('picks highest nvm version by semver not lexicographic order', () => {
    const nvmBin = '/home/user/.nvm/versions/node/v22.1.0/bin/node'
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/home/user/.nvm/versions/node') return true
      if (p === nvmBin) return true
      return false
    })
    mockReaddirSync.mockReturnValue(['v9.11.0', 'v22.1.0', 'v18.20.4'])
    const result = resolveNodeExecutable()
    expect(result).toBe(nvmBin)
  })

  it('returns Homebrew Apple Silicon node when fnm and nvm absent', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/opt/homebrew/bin/node')
    mockReaddirSync.mockReturnValue([])
    const result = resolveNodeExecutable()
    expect(result).toBe('/opt/homebrew/bin/node')
  })

  it('returns Homebrew Intel node as fallback', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/usr/local/bin/node')
    mockReaddirSync.mockReturnValue([])
    const result = resolveNodeExecutable()
    expect(result).toBe('/usr/local/bin/node')
  })

  it('returns undefined when no node installation found', () => {
    mockExistsSync.mockReturnValue(false)
    mockReaddirSync.mockReturnValue([])
    const result = resolveNodeExecutable()
    expect(result).toBeUndefined()
  })
})
