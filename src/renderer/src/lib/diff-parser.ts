export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  content: string
  lineNo: { old?: number; new?: number }
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
        if (match) {
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
