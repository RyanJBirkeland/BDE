/**
 * Pure parser for sprint task spec markdown.
 *
 * Extracts structured data from spec sections without performing any I/O.
 * Safe to import from renderer or shared code — no main-process-only deps.
 */

const FILES_TO_CHANGE_HEADING = /^##\s+files\s+to\s+change\s*$/i
const NEXT_HEADING = /^##\s+/

/**
 * Extracts the list of paths declared in a spec's `## Files to Change` section.
 *
 * Handles the four bullet variants found in BDE specs:
 *   - `- \`src/foo/bar.ts\``                  (backtick-quoted path)
 *   - `- src/foo/bar.ts`                      (bare path)
 *   - `- src/foo/bar.ts (new file)`           (parenthetical suffix)
 *   - `- src/foo/bar.ts — description`        (em-dash suffix)
 *
 * Returns `[]` when the section is absent, ensuring callers that deal with
 * prompt-type tasks (which have no structured sections) see no behavior change.
 */
export function extractFilesToChange(spec: string): string[] {
  const lines = spec.split('\n')
  const sectionStart = findSectionStart(lines)
  if (sectionStart === -1) return []

  return collectPathsUntilNextSection(lines, sectionStart + 1)
}

function findSectionStart(lines: string[]): number {
  return lines.findIndex((line) => FILES_TO_CHANGE_HEADING.test(line.trim()))
}

function collectPathsUntilNextSection(lines: string[], fromIndex: number): string[] {
  const paths: string[] = []

  for (let i = fromIndex; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (NEXT_HEADING.test(line)) break

    const path = extractPathFromBullet(line)
    if (path) paths.push(path)
  }

  return paths
}

/**
 * Extracts the file path from a single bullet line, stripping backticks,
 * parenthetical suffixes, and em-dash descriptions.
 *
 * Returns `null` when the line is not a bullet or contains no recognizable path.
 */
function extractPathFromBullet(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('-')) return null

  const content = trimmed.slice(1).trim()
  if (!content) return null

  const unquoted = stripBackticks(content)
  const withoutSuffix = stripPathSuffix(unquoted)
  const path = withoutSuffix.trim()

  return looksLikeFilePath(path) ? path : null
}

function stripBackticks(content: string): string {
  if (content.startsWith('`') && content.endsWith('`') && content.length > 2) {
    return content.slice(1, -1).trim()
  }
  // Backtick may appear only around the path portion, before a suffix
  const backtickMatch = /^`([^`]+)`/.exec(content)
  if (backtickMatch) return backtickMatch[1] ?? content
  return content
}

/**
 * Strips trailing parenthetical annotations and em-dash descriptions,
 * leaving only the bare file path.
 *
 * Examples:
 *   `src/foo.ts (new file)` → `src/foo.ts`
 *   `src/foo.ts — description` → `src/foo.ts`
 *   `src/foo.ts - does something` → `src/foo.ts`
 */
function stripPathSuffix(content: string): string {
  // Remove trailing parenthetical: `path (annotation)`
  const parenIndex = content.indexOf(' (')
  if (parenIndex !== -1) return content.slice(0, parenIndex)

  // Remove em-dash description: `path — description` or `path — description`
  const emDashIndex = content.search(/\s[—–]\s/)
  if (emDashIndex !== -1) return content.slice(0, emDashIndex)

  return content
}

function looksLikeFilePath(candidate: string): boolean {
  // Must contain a slash (relative path like src/foo/bar.ts) or a dot extension
  return candidate.includes('/') || /\.\w+$/.test(candidate)
}
