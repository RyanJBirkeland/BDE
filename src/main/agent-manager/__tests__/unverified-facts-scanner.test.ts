import { describe, it, expect } from 'vitest'
import { scanForUnverifiedFacts } from '../unverified-facts-scanner'

// ---------------------------------------------------------------------------
// Helpers for building synthetic unified diffs
// ---------------------------------------------------------------------------

function makeDiff(file: string, addedLines: string[]): string {
  const header = [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,0 +1,${addedLines.length} @@`
  ].join('\n')
  const body = addedLines.map((line) => `+${line}`).join('\n')
  return `${header}\n${body}`
}

const EMPTY_PACKAGE_JSON = '{}'

const PACKAGE_JSON_WITH_TYPESCRIPT = JSON.stringify({
  devDependencies: { typescript: '^5.0.0' }
})

// ---------------------------------------------------------------------------
// Rule 1 — brew install with tap (slash in name)
// ---------------------------------------------------------------------------

describe('Rule 1 — brew install with tap', () => {
  it('flags brew install with a slash in the package name', () => {
    const diff = makeDiff('README.md', ['brew install fake/tap/name'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch('FABRICATED-FACT CHECK')
    expect(warnings[0]).toMatch('brew install fake/tap/name')
  })

  it('does not flag brew install without a tap (no slash)', () => {
    const diff = makeDiff('README.md', ['brew install git'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings).toHaveLength(0)
  })

  it('does not flag deleted lines with brew tap', () => {
    const diff = [
      `diff --git a/README.md b/README.md`,
      `--- a/README.md`,
      `+++ b/README.md`,
      `@@ -1,1 +1,0 @@`,
      `-brew install fake/tap/name`
    ].join('\n')
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 2 — npm install -g with unknown package
// ---------------------------------------------------------------------------

describe('Rule 2 — npm install -g with unknown package', () => {
  it('flags npm install -g for a package not in package.json', () => {
    const diff = makeDiff('setup.sh', ['npm install -g some-unknown-tool'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch('FABRICATED-FACT CHECK')
    expect(warnings[0]).toMatch('npm install -g some-unknown-tool')
  })

  it('does not flag npm install -g for a package in devDependencies', () => {
    const diff = makeDiff('setup.sh', ['npm install -g typescript'])
    const warnings = scanForUnverifiedFacts(diff, PACKAGE_JSON_WITH_TYPESCRIPT)
    expect(warnings).toHaveLength(0)
  })

  it('does not flag npm install -g for a package in dependencies', () => {
    const pkgJson = JSON.stringify({ dependencies: { rimraf: '^5.0.0' } })
    const diff = makeDiff('setup.sh', ['npm install -g rimraf'])
    const warnings = scanForUnverifiedFacts(diff, pkgJson)
    expect(warnings).toHaveLength(0)
  })

  it('flags npm install -g when package.json is malformed', () => {
    const diff = makeDiff('setup.sh', ['npm install -g some-tool'])
    const warnings = scanForUnverifiedFacts(diff, '{not valid json}')
    // Malformed package.json → treat package as unknown
    expect(warnings).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Rule 3 — URLs with unapproved hostnames
// ---------------------------------------------------------------------------

describe('Rule 3 — URL hostname allowlist', () => {
  it('does not flag a URL pointing to docs.claude.com', () => {
    const diff = makeDiff('README.md', ['See https://docs.claude.com/overview'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings).toHaveLength(0)
  })

  it('does not flag a URL pointing to anthropic.com', () => {
    const diff = makeDiff('README.md', ['Visit https://anthropic.com'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings).toHaveLength(0)
  })

  it('does not flag a URL pointing to a subdomain of an approved host', () => {
    const diff = makeDiff('README.md', ['Visit https://api.anthropic.com/v1/messages'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings).toHaveLength(0)
  })

  it('does not flag github.com', () => {
    const diff = makeDiff('README.md', ['Source: https://github.com/owner/repo'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings).toHaveLength(0)
  })

  it('does not flag npmjs.com', () => {
    const diff = makeDiff('README.md', ['Package: https://npmjs.com/package/foo'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings).toHaveLength(0)
  })

  it('flags a URL with an unknown hostname', () => {
    const diff = makeDiff('setup.sh', ['curl https://example.com/install.sh'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings.some((w) => w.includes('example.com'))).toBe(true)
  })

  it('flags multiple unknown URLs on the same line', () => {
    const diff = makeDiff('README.md', ['See https://unknown-a.com/x and https://unknown-b.com/y'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Rule 4 — pipe-to-shell patterns
// ---------------------------------------------------------------------------

describe('Rule 4 — pipe-to-shell', () => {
  it('flags curl | bash', () => {
    const diff = makeDiff('setup.sh', ['curl https://example.com/install.sh | bash'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings.some((w) => w.includes('FABRICATED-FACT CHECK'))).toBe(true)
    expect(warnings.some((w) => w.includes('bash'))).toBe(true)
  })

  it('flags wget | sh', () => {
    const diff = makeDiff('setup.sh', ['wget -qO- https://example.com/install.sh | sh'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings.some((w) => w.includes('FABRICATED-FACT CHECK'))).toBe(true)
  })

  it('flags curl | sh', () => {
    const diff = makeDiff('install.sh', ['curl -s https://example.com | sh'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings.some((w) => w.includes('FABRICATED-FACT CHECK'))).toBe(true)
  })

  it('flags wget | bash', () => {
    const diff = makeDiff('install.sh', ['wget -O - https://example.com | bash'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings.some((w) => w.includes('FABRICATED-FACT CHECK'))).toBe(true)
  })

  it('does not flag curl without pipe', () => {
    const diff = makeDiff('setup.sh', ['curl -o file.tar.gz https://github.com/owner/repo'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    // curl without pipe should not trigger rule 4 (may still trigger rule 3 if unknown hostname)
    const pipeWarnings = warnings.filter(
      (w) => w.includes('curl') && w.includes('bash') && !w.includes('github.com')
    )
    expect(pipeWarnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Warning format
// ---------------------------------------------------------------------------

describe('Warning message format', () => {
  it('includes line number, filename, and match in the warning', () => {
    const diff = makeDiff('scripts/install.sh', ['brew install my/tap/pkg'])
    const warnings = scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/FABRICATED-FACT CHECK: line \d+ of scripts\/install\.sh:/)
    expect(warnings[0]).toContain('verify before merge')
  })
})

// ---------------------------------------------------------------------------
// Empty diff / no issues
// ---------------------------------------------------------------------------

describe('Empty or clean diffs', () => {
  it('returns an empty array for an empty diff', () => {
    expect(scanForUnverifiedFacts('', EMPTY_PACKAGE_JSON)).toEqual([])
  })

  it('returns an empty array when the diff has no added lines', () => {
    const diff = [
      `diff --git a/README.md b/README.md`,
      `--- a/README.md`,
      `+++ b/README.md`,
      `@@ -1,1 +1,1 @@`,
      ` unchanged line`
    ].join('\n')
    expect(scanForUnverifiedFacts(diff, EMPTY_PACKAGE_JSON)).toEqual([])
  })

  it('returns an empty array for a clean diff with only approved content', () => {
    const diff = makeDiff('README.md', [
      'See https://docs.claude.com for details.',
      'Install via: npm install typescript',
      'Run: brew install git'
    ])
    const warnings = scanForUnverifiedFacts(diff, PACKAGE_JSON_WITH_TYPESCRIPT)
    expect(warnings).toHaveLength(0)
  })
})
