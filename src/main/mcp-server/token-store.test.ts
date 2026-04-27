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
    dir = await fs.mkdtemp(join(tmpdir(), 'fleet-mcp-token-'))
    filePath = join(dir, 'mcp-token')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('generates a 64-hex-char token when file is absent', async () => {
    const result = await readOrCreateToken(filePath)
    expect(result.token).toMatch(HEX_TOKEN)
    expect(result.created).toBe(true)
    expect(result.path).toBe(filePath)
    const stat = await fs.stat(filePath)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('returns existing token on second call with created=false', async () => {
    const first = await readOrCreateToken(filePath)
    const second = await readOrCreateToken(filePath)
    expect(second.token).toBe(first.token)
    expect(second.created).toBe(false)
    expect(second.path).toBe(filePath)
  })

  it('regenerateToken overwrites the file with a new value and flags created=true', async () => {
    const first = await readOrCreateToken(filePath)
    const second = await regenerateToken(filePath)
    expect(second.token).not.toBe(first.token)
    expect(second.token).toMatch(HEX_TOKEN)
    expect(second.created).toBe(true)
    expect(second.path).toBe(filePath)
    const onDisk = (await fs.readFile(filePath, 'utf8')).trim()
    expect(onDisk).toBe(second.token)
  })

  it('regenerates when existing file contains non-hex content and flags created=true', async () => {
    await fs.writeFile(filePath, 'not-a-token\n')
    const result = await readOrCreateToken(filePath)
    expect(result.token).toMatch(HEX_TOKEN)
    expect(result.created).toBe(true)
    const onDisk = (await fs.readFile(filePath, 'utf8')).trim()
    expect(onDisk).toBe(result.token)
  })

  it('regenerates when existing file contains wrong-length hex', async () => {
    await fs.writeFile(filePath, 'a'.repeat(32) + '\n')
    const result = await readOrCreateToken(filePath)
    expect(result.token).toMatch(HEX_TOKEN)
    expect(result.token).not.toBe('a'.repeat(32))
    expect(result.created).toBe(true)
    const onDisk = (await fs.readFile(filePath, 'utf8')).trim()
    expect(onDisk).toBe(result.token)
  })

  it('regenerates when existing file contains only whitespace', async () => {
    await fs.writeFile(filePath, '   \n')
    const result = await readOrCreateToken(filePath)
    expect(result.token).toMatch(HEX_TOKEN)
    expect(result.created).toBe(true)
    const onDisk = (await fs.readFile(filePath, 'utf8')).trim()
    expect(onDisk).toBe(result.token)
  })

  it('creates a missing parent directory on first generation', async () => {
    const suffix = randomBytes(8).toString('hex')
    const missingDir = join(tmpdir(), `fleet-mcp-token-missing-${suffix}`)
    const nestedPath = join(missingDir, 'nested', 'mcp-token')
    try {
      const result = await readOrCreateToken(nestedPath)
      expect(result.token).toMatch(HEX_TOKEN)
      expect(result.created).toBe(true)
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

    const result = await readOrCreateToken(filePath, { logger })

    expect(result.token).toMatch(HEX_TOKEN)
    expect(result.created).toBe(true)
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

    const result = await readOrCreateToken(filePath, { logger })

    expect(result.token).toBe(validToken)
    expect(result.created).toBe(false)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const message = logger.warn.mock.calls[0][0] as string
    expect(message).toContain('drifted')
    expect(message).toContain(filePath)
  })

  it('does not warn when a valid token is at mode 0o600', async () => {
    const logger = makeTestLogger()
    await readOrCreateToken(filePath, { logger })

    const result = await readOrCreateToken(filePath, { logger })

    expect(result.created).toBe(false)
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

  it('returns existing valid token when EEXIST race occurs during generation', async () => {
    const existingToken = 'a'.repeat(64)

    // Simulate the EEXIST race: the file does not exist when readOrCreateToken
    // first checks (ENOENT on readFile), but another process writes a valid
    // token between that check and our writeExclusive call. We model this by
    // mocking fs.open to inject EEXIST, then writing the valid token to disk
    // so the subsequent readFile in generateAndWrite finds it.
    const realOpen = fs.open.bind(fs)
    let interceptedExclusive = false
    vi.spyOn(fs, 'open').mockImplementation(async (p, flag, ...rest) => {
      if (!interceptedExclusive && flag === 'wx') {
        interceptedExclusive = true
        // Write the "race winner" token before throwing EEXIST
        await fs.writeFile(filePath, existingToken + '\n', { mode: 0o600 })
        const err = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        throw err
      }
      return realOpen(p as string, flag as string, ...(rest as []))
    })

    const result = await readOrCreateToken(filePath)

    expect(result.token).toBe(existingToken)
    expect(result.created).toBe(false)
  })

  it('overwrites when EEXIST occurs but existing content is corrupt', async () => {
    // Write corrupt content to simulate a file that exists but is invalid.
    // readOrCreateToken will detect the bad content, fall through to
    // generateAndWrite, which hits EEXIST (the file is already on disk),
    // reads the corrupt content again, and falls back to overwriteWithMode.
    await fs.writeFile(filePath, 'bad-token\n', { mode: 0o600 })

    const result = await readOrCreateToken(filePath)

    expect(result.token).toMatch(HEX_TOKEN)
    expect(result.token).not.toBe('bad-token')
    expect(result.created).toBe(true)
  })
})
