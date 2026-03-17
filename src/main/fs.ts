import { mkdir, readdir, readFile, writeFile, stat } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import { homedir } from 'os'
import { dialog } from 'electron'
import { safeHandle } from './ipc-utils'

export interface MemoryFile {
  path: string
  name: string
  size: number
  modifiedAt: number
}

const MEMORY_ROOT = resolve(homedir(), '.openclaw/workspace/memory')
const AGENT_LOGS_ROOT = resolve(homedir(), '.bde/agent-logs')
const TMP_ROOT = resolve('/tmp')
const MAX_READ_BYTES = 10 * 1024 * 1024 // 10 MB

export function validateMemoryPath(p: string): string {
  const resolved = resolve(MEMORY_ROOT, p)
  if (!resolved.startsWith(MEMORY_ROOT + '/') && resolved !== MEMORY_ROOT) {
    throw new Error(
      `Path traversal blocked: "${p}" resolves outside ${MEMORY_ROOT}`
    )
  }
  return resolved
}

export function validateLogPath(p: string): string {
  const resolved = resolve(p)
  const inAgentLogs =
    resolved.startsWith(AGENT_LOGS_ROOT + '/') || resolved === AGENT_LOGS_ROOT
  const inTmp = resolved.startsWith(TMP_ROOT + '/') || resolved === TMP_ROOT
  if (!inAgentLogs && !inTmp) {
    throw new Error(
      `Path traversal blocked: "${p}" is not under ${AGENT_LOGS_ROOT} or ${TMP_ROOT}`
    )
  }
  return resolved
}

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

export async function readMemoryFile(relativePath: string): Promise<string> {
  const safePath = validateMemoryPath(relativePath)
  const info = await stat(safePath)
  if (info.size > MAX_READ_BYTES) {
    throw new Error(
      `File too large: ${info.size} bytes exceeds ${MAX_READ_BYTES} byte limit`
    )
  }
  return readFile(safePath, 'utf-8')
}

async function writeMemoryFile(relativePath: string, content: string): Promise<void> {
  const safePath = validateMemoryPath(relativePath)
  await mkdir(dirname(safePath), { recursive: true })
  await writeFile(safePath, content, 'utf-8')
}

// ── Attachment file helpers ──────────────────────────────

const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_TEXT_BYTES = 10 * 1024 * 1024 // 10 MB

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
}

/** Validates the path is absolute and not a traversal attack. */
export function validateSafePath(filePath: string): string {
  const resolved = resolve(filePath)
  if (resolved !== filePath && resolved !== resolve(filePath)) {
    throw new Error(`Path traversal blocked: "${filePath}"`)
  }
  // Must be absolute
  if (!resolved.startsWith('/')) {
    throw new Error(`Path must be absolute: "${filePath}"`)
  }
  return resolved
}

async function openFileDialog(
  opts?: { filters?: Electron.FileFilter[] }
): Promise<string[] | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: opts?.filters ?? [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      {
        name: 'Text Files',
        extensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'txt', 'json', 'py', 'sh', 'css', 'html']
      },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  return result.canceled ? null : result.filePaths
}

async function readFileAsBase64(
  filePath: string
): Promise<{ data: string; mimeType: string; name: string }> {
  const safe = validateSafePath(filePath)
  const info = await stat(safe)
  if (info.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${(info.size / 1024 / 1024).toFixed(1)} MB exceeds 5 MB limit`)
  }
  const buf = await readFile(safe)
  const ext = extname(safe).toLowerCase().replace('.', '')
  return {
    data: buf.toString('base64'),
    mimeType: IMAGE_MIME[ext] ?? 'application/octet-stream',
    name: basename(safe)
  }
}

async function readFileAsText(
  filePath: string
): Promise<{ content: string; name: string }> {
  const safe = validateSafePath(filePath)
  const info = await stat(safe)
  if (info.size > MAX_TEXT_BYTES) {
    throw new Error(
      `File too large: ${(info.size / 1024 / 1024).toFixed(1)} MB exceeds 10 MB limit`
    )
  }
  const content = await readFile(safe, 'utf-8')
  return { content, name: basename(safe) }
}

export function registerFsHandlers(): void {
  // TODO: AX-S1 — add 'list-memory-files', 'read-memory-file', 'write-memory-file' to IpcChannelMap
  safeHandle('list-memory-files', () => listMemoryFiles())
  safeHandle('read-memory-file', (_e, path: string) => readMemoryFile(path))
  safeHandle('write-memory-file', (_e, path: string, content: string) =>
    writeMemoryFile(path, content)
  )

  // Attachment file handlers
  safeHandle('open-file-dialog', (_e, opts?: { filters?: Electron.FileFilter[] }) =>
    openFileDialog(opts)
  )
  safeHandle('read-file-as-base64', (_e, filePath: string) => readFileAsBase64(filePath))
  safeHandle('read-file-as-text', (_e, filePath: string) => readFileAsText(filePath))
}
