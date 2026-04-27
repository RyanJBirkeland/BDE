/**
 * unverified-facts-scanner.ts — Heuristic scan for concrete-looking values
 * that pipeline agents may have invented (fabricated package names, unknown
 * hostnames, pipe-to-shell patterns).
 *
 * This module is advisory only. All warnings are appended to task notes —
 * they never block a commit, change task status, or prevent review transition.
 *
 * The exported function is intentionally pure (no I/O) so it can be
 * tested with synthetic diff strings without any mocking.
 */

/** Hostnames whose URLs are considered pre-approved and suppressed from warnings. */
const APPROVED_HOSTNAMES: readonly string[] = [
  'docs.claude.com',
  'anthropic.com',
  'github.com',
  'npmjs.com',
  'nodejs.org',
  'electronjs.org',
  'vitejs.dev',
  'vitest.dev',
  'typescript-eslint.io',
  'eslint.org',
  'prettier.io'
]

/**
 * Matches `brew install <name>` where the package name contains a slash —
 * the slash is the hallmark of a third-party tap (e.g. `fake/tap/name`).
 */
const BREW_TAP_INSTALL = /brew install ([^\s]+\/[^\s]+)/

/**
 * Matches `npm install -g <pkg>`. The package name ends at the next
 * whitespace or end-of-string.
 */
const NPM_GLOBAL_INSTALL = /npm install -g ([^\s]+)/

/**
 * Matches HTTP/HTTPS URLs. Captures the full URL for hostname extraction.
 * Uses a non-greedy match so trailing punctuation is not swallowed.
 */
const URL_PATTERN = /https?:\/\/([^/\s]+)/g

/**
 * Matches pipe-to-shell patterns that execute untrusted remote scripts:
 * `curl | bash`, `wget | sh`, `curl | sh`, `wget | bash`.
 */
const PIPE_TO_SHELL = /\b(?:curl|wget)\b[^|]*\|\s*(?:bash|sh)\b/

/** Warning message prefix — stable string callers can match on. */
const WARNING_PREFIX = 'FABRICATED-FACT CHECK'

/**
 * Scans a unified diff for heuristic signals of fabricated external
 * references and returns one warning string per match. An empty array
 * means no issues were found.
 *
 * @param diff              Output of `git diff HEAD~1 HEAD` (unified format).
 * @param packageJsonContent  Raw text of `package.json` — used to determine
 *                          whether a globally-installed npm package is already
 *                          a known project dependency.
 */
export function scanForUnverifiedFacts(diff: string, packageJsonContent: string): string[] {
  const knownDependencies = extractKnownDependencies(packageJsonContent)
  const warnings: string[] = []

  let currentFile = ''
  let lineNumber = 0

  for (const rawLine of diff.split('\n')) {
    const fileHeader = parseFileHeader(rawLine)
    if (fileHeader) {
      currentFile = fileHeader
      lineNumber = 0
      continue
    }

    if (rawLine.startsWith('@@')) {
      lineNumber = parseHunkStartLine(rawLine)
      continue
    }

    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      // Deleted lines — skip, only added lines matter.
      continue
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      const addedContent = rawLine.slice(1)
      const lineWarnings = scanAddedLine(addedContent, lineNumber, currentFile, knownDependencies)
      warnings.push(...lineWarnings)
      lineNumber++
    } else {
      // Context line — advance line counter without scanning.
      lineNumber++
    }
  }

  return warnings
}

// ---------------------------------------------------------------------------
// Private helpers — each at one level of abstraction below their caller
// ---------------------------------------------------------------------------

/**
 * Returns all package names from the `dependencies` and `devDependencies`
 * fields of a `package.json` string. Returns an empty set on parse failure
 * so scan continues conservatively (and may produce false positives).
 */
function extractKnownDependencies(packageJsonContent: string): Set<string> {
  try {
    const parsed = JSON.parse(packageJsonContent) as Record<string, unknown>
    const deps = Object.keys((parsed.dependencies as Record<string, unknown>) ?? {})
    const devDeps = Object.keys((parsed.devDependencies as Record<string, unknown>) ?? {})
    return new Set([...deps, ...devDeps])
  } catch {
    return new Set()
  }
}

/**
 * Extracts the destination file path from a `+++ b/<path>` diff header line.
 * Returns `null` for any other line.
 */
function parseFileHeader(line: string): string | null {
  if (!line.startsWith('+++ b/')) return null
  return line.slice('+++ b/'.length)
}

/**
 * Reads the starting line number from a `@@ -a,b +c,d @@` hunk header.
 * Returns 0 when the header cannot be parsed.
 */
function parseHunkStartLine(hunkHeader: string): number {
  const match = hunkHeader.match(/@@ -\d+(?:,\d+)? \+(\d+)/)
  return match ? parseInt(match[1]!, 10) : 0
}

/**
 * Scans a single added line (content only, leading `+` stripped) for all
 * four heuristic patterns and returns any resulting warnings.
 */
function scanAddedLine(
  content: string,
  lineNumber: number,
  file: string,
  knownDependencies: Set<string>
): string[] {
  const warnings: string[] = []

  const brewWarning = checkBrewTapInstall(content, lineNumber, file)
  if (brewWarning) warnings.push(brewWarning)

  const npmWarning = checkNpmGlobalInstall(content, lineNumber, file, knownDependencies)
  if (npmWarning) warnings.push(npmWarning)

  const urlWarnings = checkUnknownUrls(content, lineNumber, file)
  warnings.push(...urlWarnings)

  const pipeWarning = checkPipeToShell(content, lineNumber, file)
  if (pipeWarning) warnings.push(pipeWarning)

  return warnings
}

function checkBrewTapInstall(content: string, lineNumber: number, file: string): string | null {
  const match = BREW_TAP_INSTALL.exec(content)
  if (!match) return null
  return formatWarning(lineNumber, file, match[0])
}

function checkNpmGlobalInstall(
  content: string,
  lineNumber: number,
  file: string,
  knownDependencies: Set<string>
): string | null {
  const match = NPM_GLOBAL_INSTALL.exec(content)
  if (!match) return null
  const packageName = match[1]!
  if (knownDependencies.has(packageName)) return null
  return formatWarning(lineNumber, file, match[0])
}

function checkUnknownUrls(content: string, lineNumber: number, file: string): string[] {
  const warnings: string[] = []
  let match: RegExpExecArray | null

  const pattern = new RegExp(URL_PATTERN.source, 'g')
  while ((match = pattern.exec(content)) !== null) {
    const hostname = match[1]!
    if (!isApprovedHostname(hostname)) {
      warnings.push(formatWarning(lineNumber, file, match[0]))
    }
  }

  return warnings
}

function checkPipeToShell(content: string, lineNumber: number, file: string): string | null {
  const match = PIPE_TO_SHELL.exec(content)
  if (!match) return null
  return formatWarning(lineNumber, file, match[0])
}

/**
 * Returns true when the hostname exactly matches an approved entry or is a
 * subdomain of one (e.g. `api.anthropic.com` → approved via `anthropic.com`).
 */
function isApprovedHostname(hostname: string): boolean {
  return APPROVED_HOSTNAMES.some(
    (approved) => hostname === approved || hostname.endsWith(`.${approved}`)
  )
}

function formatWarning(lineNumber: number, file: string, match: string): string {
  return `${WARNING_PREFIX}: line ${lineNumber} of ${file}: \`${match}\` — verify before merge.`
}
