import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { dirname, join } from 'node:path'
import * as os from 'node:os'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { readOrCreateToken, regenerateToken, tokenFilePath } from './token-store'

const HEX_TOKEN = /^[0-9a-f]{64}$/

function makeTestLogger(): { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn(), error: vi.fn() }
}

describe('token-store', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bde-mcp-token-'))
    filePath = join(dir, 'mcp-token')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('generates a 64-hex-char token when file is absent', async () => {
    const token = await readOrCreateToken(filePath)
    expect(token).toMatch(HEX_TOKEN)
    const stat = await fs.stat(filePath)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('returns existing token on second call', async () => {
    const first = await readOrCreateToken(filePath)
    const second = await readOrCreateToken(filePath)
    expect(second).toBe(first)
  })

  it('regenerateToken overwrites the file with a new value', async () => {
    const first = await readOrCreateToken(filePath)
    const second = await regenerateToken(filePath)
    expect(second).not.toBe(first)
    expect(second).toMatch(HEX_TOKEN)
    const onDisk = (await fs.readFile(filePath, 'utf8')).trim()
    expect(onDisk).toBe(second)
  })

  it('regenerates when existing file contains non-hex content', async () => {
    await fs.writeFile(filePath, 'not-a-token\n')
    const token = await readOrCreateToken(filePath)
    expect(token).toMatch(HEX_TOKEN)
    const onDisk = (await fs.readFile(filePath, 'utf8')).trim()
    expect(onDisk).toBe(token)
  })

  it('regenerates when existing file contains wrong-length hex', async () => {
    await fs.writeFile(filePath, 'a'.repeat(32) + '\n')
    const token = await readOrCreateToken(filePath)
    expect(token).toMatch(HEX_TOKEN)
    expect(token).not.toBe('a'.repeat(32))
    const onDisk = (await fs.readFile(filePath, 'utf8')).trim()
    expect(onDisk).toBe(token)
  })

  it('regenerates when existing file contains only whitespace', async () => {
    await fs.writeFile(filePath, '   \n')
    const token = await readOrCreateToken(filePath)
    expect(token).toMatch(HEX_TOKEN)
    const onDisk = (await fs.readFile(filePath, 'utf8')).trim()
    expect(onDisk).toBe(token)
  })

  it('creates a missing parent directory on first generation', async () => {
    const suffix = randomBytes(8).toString('hex')
    const missingDir = join(tmpdir(), `bde-mcp-token-missing-${suffix}`)
    const nestedPath = join(missingDir, 'nested', 'mcp-token')
    try {
      const token = await readOrCreateToken(nestedPath)
      expect(token).toMatch(HEX_TOKEN)
      const stat = await fs.stat(nestedPath)
      expect(stat.isFile()).toBe(true)
    } finally {
      await fs.rm(missingDir, { recursive: true, force: true })
    }
  })

  it('locks the parent directory to 0o700 on first generation', async () => {
    await readOrCreateToken(filePath)
    const parentStat = await fs.stat(dirname(filePath))
    expect(parentStat.mode & 0o777).toBe(0o700)
  })

  it('tightens a pre-existing parent directory with mode 0o755 down to 0o700', async () => {
    await fs.chmod(dir, 0o755)
    const before = await fs.stat(dir)
    expect(before.mode & 0o777).toBe(0o755)

    await readOrCreateToken(filePath)

    const after = await fs.stat(dir)
    expect(after.mode & 0o777).toBe(0o700)
  })

  it('rethrows non-ENOENT read errors instead of swallowing them', async () => {
    const eaccesError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(eaccesError)
    await expect(readOrCreateToken(filePath)).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('logs non-ENOENT read errors before rethrowing them', async () => {
    const logger = makeTestLogger()
    const eaccesError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(eaccesError)

    await expect(readOrCreateToken(filePath, { logger })).rejects.toMatchObject({ code: 'EACCES' })

    expect(logger.error).toHaveBeenCalledTimes(1)
    const message = logger.error.mock.calls[0][0] as string
    expect(message).toContain('code=EACCES')
    expect(message).toContain(filePath)
  })

  it('warns via logger when regenerating a corrupt token', async () => {
    const logger = makeTestLogger()
    await fs.writeFile(filePath, 'not-a-token\n')

    const token = await readOrCreateToken(filePath, { logger })

    expect(token).toMatch(HEX_TOKEN)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const message = logger.warn.mock.calls[0][0] as string
    expect(message).toContain('corrupt token')
    expect(message).toContain(filePath)
  })

  it('warns when a valid token on disk has drifted from mode 0o600', async () => {
    const logger = makeTestLogger()
    const validToken = 'a'.repeat(64)
    await fs.writeFile(filePath, validToken + '\n')
    await fs.chmod(filePath, 0o644)

    const token = await readOrCreateToken(filePath, { logger })

    expect(token).toBe(validToken)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const message = logger.warn.mock.calls[0][0] as string
    expect(message).toContain('drifted')
    expect(message).toContain(filePath)
  })

  it('does not warn when a valid token is at mode 0o600', async () => {
    const logger = makeTestLogger()
    await readOrCreateToken(filePath, { logger })

    await readOrCreateToken(filePath, { logger })

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('writes the token file with mode 0o600 after generation', async () => {
    await regenerateToken(filePath)
    const stat = await fs.stat(filePath)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('regeneration after corrupt content keeps mode 0o600', async () => {
    await fs.writeFile(filePath, 'garbage\n', { mode: 0o644 })
    await fs.chmod(filePath, 0o644)

    await readOrCreateToken(filePath)

    const stat = await fs.stat(filePath)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('tokenFilePath is absolute, under the home directory, and named mcp-token', () => {
    const p = tokenFilePath()
    expect(path.isAbsolute(p)).toBe(true)
    expect(p.startsWith(os.homedir())).toBe(true)
    expect(path.basename(p)).toBe('mcp-token')
  })
})
