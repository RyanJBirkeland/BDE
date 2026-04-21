export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  content: string
  lineNo: { old?: number | undefined; new?: number | undefined }
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

export function parseDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return []

  const files: DiffFile[] = []
  const diffParts = raw.split(/^diff --git /m).filter(Boolean)

  for (const part of diffParts) {
    const lines = part.split('\n')

    // Extract file path from +++ line
    const pppLine = lines.find((l) => l.startsWith('+++ '))
    if (!pppLine) continue
    const path = pppLine.replace('+++ b/', '').replace('+++ /dev/null', '(deleted)')

    const hunks: DiffHunk[] = []
    let additions = 0
    let deletions = 0
    let currentHunk: DiffHunk | null = null
    let oldLine = 0
    let newLine = 0

    for (const line of lines) {
      if (line.startsWith('@@ ')) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
        if (match && match[1] && match[2]) {
          oldLine = parseInt(match[1], 10)
          newLine = parseInt(match[2], 10)
          currentHunk = { header: line, lines: [] }
          hunks.push(currentHunk)
        }
        continue
      }

      if (!currentHunk) continue

      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'add',
          content: line.slice(1),
          lineNo: { new: newLine }
        })
        newLine++
        additions++
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'del',
          content: line.slice(1),
          lineNo: { old: oldLine }
        })
        oldLine++
        deletions++
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'ctx',
          content: line.slice(1),
          lineNo: { old: oldLine, new: newLine }
        })
        oldLine++
        newLine++
      }
    }

    files.push({ path, hunks, additions, deletions })
  }

  return files
}

/** Parse a single diff --git block into a DiffFile */
function parsePart(part: string): DiffFile | null {
  const lines = part.split('\n')
  const pppLine = lines.find((l) => l.startsWith('+++ '))
  if (!pppLine) return null
  const path = pppLine.replace('+++ b/', '').replace('+++ /dev/null', '(deleted)')

  const hunks: DiffHunk[] = []
  let additions = 0
  let deletions = 0
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
      if (match && match[1] && match[2]) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
        currentHunk = { header: line, lines: [] }
        hunks.push(currentHunk)
      }
      continue
    }
    if (!currentHunk) continue
    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), lineNo: { new: newLine } })
      newLine++
      additions++
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'del', content: line.slice(1), lineNo: { old: oldLine } })
      oldLine++
      deletions++
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'ctx',
        content: line.slice(1),
        lineNo: { old: oldLine, new: newLine }
      })
      oldLine++
      newLine++
    }
  }
  return { path, hunks, additions, deletions }
}

/**
 * Async chunked parser — yields to the event loop between files so the UI
 * stays responsive for large diffs. Delivers progressive results via callback.
 */
export function parseDiffChunked(
  raw: string,
  onProgress: (files: DiffFile[]) => void,
  signal?: AbortSignal | undefined
): Promise<DiffFile[]> {
  return new Promise((resolve, reject) => {
    if (!raw.trim()) {
      onProgress([])
      resolve([])
      return
    }

    const parts = raw.split(/^diff --git /m).filter(Boolean)
    const files: DiffFile[] = []
    let index = 0

    function processNext(): void {
      if (signal?.aborted) {
        reject(new DOMException('Diff parsing aborted', 'AbortError'))
        return
      }

      const batchEnd = Math.min(index + 10, parts.length)
      while (index < batchEnd) {
        const part = parts[index]
        const file = part ? parsePart(part) : null
        if (file) files.push(file)
        index++
      }

      onProgress([...files])

      if (index < parts.length) {
        requestAnimationFrame(processNext)
      } else {
        resolve(files)
      }
    }

    requestAnimationFrame(processNext)
  })
}

/** Count total diff lines across all files */
export function countDiffLines(files: DiffFile[]): number {
  let total = 0
  for (const f of files) {
    for (const h of f.hunks) {
      total += h.lines.length
    }
  }
  return total
}
