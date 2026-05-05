import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32
const FILE_MODE = 0o600
const DIR_MODE = 0o700
const TOKEN_HEX_PATTERN = new RegExp(`^[0-9a-f]{${TOKEN_BYTES * 2}}$`)

function rotatedAtFilePath(tokenPath: string): string {
  return tokenPath + '-rotated-at'
}

export interface TokenStoreLogger {
  warn(msg: string): void
  error(msg: string): void
}

export interface TokenStoreOptions {
  logger?: TokenStoreLogger
}

export interface TokenReadResult {
  token: string
  created: boolean
  path: string
}

export function tokenFilePath(): string {
  return join(homedir(), '.fleet', 'mcp-token')
}

function isWellFormedToken(value: string): boolean {
  return TOKEN_HEX_PATTERN.test(value)
}

async function lockParentDirectoryPermissions(filePath: string): Promise<void> {
  const dir = dirname(filePath)
  await fs.mkdir(dir, { recursive: true, mode: DIR_MODE })
  await fs.chmod(dir, DIR_MODE)
}

async function writeExclusive(filePath: string, contents: string): Promise<boolean> {
  try {
    const handle = await fs.open(filePath, 'wx', FILE_MODE)
    try {
      await handle.write(contents)
    } finally {
      await handle.close()
    }
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
}

async function overwriteWithMode(filePath: string, contents: string): Promise<void> {
  await fs.writeFile(filePath, contents, { mode: FILE_MODE, flag: 'w' })
  await fs.chmod(filePath, FILE_MODE)
}

interface GenerateAndWriteResult {
  token: string
  created: boolean
}

/**
 * Generates a random token and writes it to `filePath`. When `writeExclusive`
 * returns false (EEXIST — another process wrote the file concurrently), attempts
 * to read and validate the existing content. A valid race-written token is
 * returned as-is with `created: false`; corrupt or unreadable content falls
 * through to `overwriteWithMode` with `created: true`.
 */
async function generateAndWrite(filePath: string): Promise<GenerateAndWriteResult> {
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const payload = token + '\n'
  await lockParentDirectoryPermissions(filePath)
  const createdFresh = await writeExclusive(filePath, payload)
  if (createdFresh) return { token, created: true }

  // EEXIST: a concurrent process wrote the file. Try to honour its token.
  try {
    const existing = (await fs.readFile(filePath, 'utf8')).trim()
    if (isWellFormedToken(existing)) {
      return { token: existing, created: false }
    }
  } catch {
    // Unreadable — fall through to overwrite below
  }

  await overwriteWithMode(filePath, payload)
  return { token, created: true }
}

async function warnIfModeDrifted(
  filePath: string,
  logger: TokenStoreLogger | undefined
): Promise<void> {
  if (!logger) return
  try {
    const stat = await fs.stat(filePath)
    const mode = stat.mode & 0o777
    if (mode !== FILE_MODE) {
      logger.warn(
        `token-store: token file mode drifted to ${mode.toString(8)} at ${filePath} — expected ${FILE_MODE.toString(8)}`
      )
    }
  } catch {
    // Non-fatal: a stat failure shouldn't lock the user out of their server.
  }
}

export async function readOrCreateToken(
  filePath: string = tokenFilePath(),
  options: TokenStoreOptions = {}
): Promise<TokenReadResult> {
  const { logger } = options
  try {
    const contents = await fs.readFile(filePath, 'utf8')
    const token = contents.trim()
    if (isWellFormedToken(token)) {
      await warnIfModeDrifted(filePath, logger)
      return { token, created: false, path: filePath }
    }
    logger?.warn(`token-store: corrupt token at ${filePath} — regenerating`)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
      logger?.error(`token-store read failed: code=${code} path=${filePath} — ${detail}`)
      throw err
    }
  }
  const result = await generateAndWrite(filePath)
  return { token: result.token, created: result.created, path: filePath }
}

export async function readRotatedAt(
  filePath: string = tokenFilePath()
): Promise<string | null> {
  try {
    const contents = await fs.readFile(rotatedAtFilePath(filePath), 'utf8')
    return contents.trim() || null
  } catch {
    return null
  }
}

export async function regenerateToken(
  filePath: string = tokenFilePath()
): Promise<TokenReadResult> {
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  await lockParentDirectoryPermissions(filePath)
  await overwriteWithMode(filePath, token + '\n')
  await overwriteWithMode(rotatedAtFilePath(filePath), new Date().toISOString() + '\n')
  return { token, created: true, path: filePath }
}
