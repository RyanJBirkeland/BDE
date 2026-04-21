import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { join } from 'node:path'
import * as os from 'node:os'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { readOrCreateToken, regenerateToken, tokenFilePath } from './token-store'

const HEX_TOKEN = /^[0-9a-f]{64}$/

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

  it('rethrows non-ENOENT read errors instead of swallowing them', async () => {
    const eaccesError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(eaccesError)
    await expect(readOrCreateToken(filePath)).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('writes the token file with mode 0o600 after generation', async () => {
    await regenerateToken(filePath)
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
