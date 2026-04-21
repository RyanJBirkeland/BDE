import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32
const FILE_MODE = 0o600
const DIR_MODE = 0o700
const TOKEN_HEX_PATTERN = new RegExp(`^[0-9a-f]{${TOKEN_BYTES * 2}}$`)

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
  return join(homedir(), '.bde', 'mcp-token')
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

async function generateAndWrite(filePath: string): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const payload = token + '\n'
  await lockParentDirectoryPermissions(filePath)
  const createdFresh = await writeExclusive(filePath, payload)
  if (!createdFresh) await overwriteWithMode(filePath, payload)
  return token
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
  const token = await generateAndWrite(filePath)
  return { token, created: true, path: filePath }
}

export async function regenerateToken(
  filePath: string = tokenFilePath()
): Promise<TokenReadResult> {
  const token = await generateAndWrite(filePath)
  return { token, created: true, path: filePath }
}
