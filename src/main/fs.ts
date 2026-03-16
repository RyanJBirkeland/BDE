import { mkdir, readdir, readFile, writeFile, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { safeHandle } from './ipc-utils'

export interface MemoryFile {
  path: string
  name: string
  size: number
  modifiedAt: number
}

const MEMORY_ROOT = join(homedir(), '.openclaw/workspace/memory')

async function listMemoryFiles(): Promise<MemoryFile[]> {
  const files: MemoryFile[] = []
  await walkDir(MEMORY_ROOT, '', files)
  files.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return files
}

async function walkDir(root: string, relative: string, out: MemoryFile[]): Promise<void> {
  const dir = join(root, relative)
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // directory doesn't exist yet
  }
  for (const entry of entries) {
    const relPath = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await walkDir(root, relPath, out)
    } else if (entry.name.endsWith('.md')) {
      try {
        const info = await stat(join(root, relPath))
        out.push({
          path: relPath,
          name: entry.name,
          size: info.size,
          modifiedAt: info.mtimeMs
        })
      } catch {
        // skip files we can't stat
      }
    }
  }
}

async function readMemoryFile(relativePath: string): Promise<string> {
  const safePath = normalizePath(relativePath)
  return readFile(join(MEMORY_ROOT, safePath), 'utf-8')
}

async function writeMemoryFile(relativePath: string, content: string): Promise<void> {
  const safePath = normalizePath(relativePath)
  const resolvedPath = join(MEMORY_ROOT, safePath)
  await mkdir(dirname(resolvedPath), { recursive: true })
  await writeFile(resolvedPath, content, 'utf-8')
}

function normalizePath(relativePath: string): string {
  // Prevent path traversal
  const normalized = relativePath.replace(/\\/g, '/').replace(/\.\./g, '')
  if (normalized.startsWith('/')) return normalized.slice(1)
  return normalized
}

export function registerFsHandlers(): void {
  safeHandle('list-memory-files', () => listMemoryFiles())
  safeHandle('read-memory-file', (_e, path: string) => readMemoryFile(path))
  safeHandle('write-memory-file', (_e, path: string, content: string) =>
    writeMemoryFile(path, content)
  )
}
