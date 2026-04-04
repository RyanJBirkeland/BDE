import { describe, it, expect } from 'vitest'
import {
  computeStructuralChecks,
  checkAntiPatterns,
  checkTestSection,
  checkHandlerCountAwareness,
  checkPreloadSync,
  checkComplexity,
  extractFilePaths
} from '../useReadinessChecks'

describe('computeStructuralChecks', () => {
  it('fails when title is empty', () => {
    const checks = computeStructuralChecks({ title: '', repo: 'BDE', spec: '' })
    const titleCheck = checks.find((c) => c.id === 'title-present')
    expect(titleCheck?.status).toBe('fail')
  })

  it('passes when title is non-empty', () => {
    const checks = computeStructuralChecks({ title: 'Fix bug', repo: 'BDE', spec: '' })
    const titleCheck = checks.find((c) => c.id === 'title-present')
    expect(titleCheck?.status).toBe('pass')
  })

  it('fails when spec is empty', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: '' })
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('fail')
  })

  it('warns when spec is very short (1-50 chars)', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: 'Short spec here' })
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('warn')
  })

  it('passes when spec is >50 chars', () => {
    const longSpec = 'A'.repeat(51)
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: longSpec })
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('pass')
  })

  it('warns when spec has 1 heading', () => {
    const spec = '## Problem\nSome description that is long enough to pass the length check yes'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const specStructure = checks.find((c) => c.id === 'spec-structure')
    expect(specStructure?.status).toBe('warn')
  })

  it('passes when spec has 2+ headings', () => {
    const spec = '## Problem\nDescription\n## Solution\nMore text that is long enough'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const specStructure = checks.find((c) => c.id === 'spec-structure')
    expect(specStructure?.status).toBe('pass')
  })

  it('fails when spec has no headings', () => {
    const spec = 'Just a wall of text without any markdown headings at all and its pretty long'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const specStructure = checks.find((c) => c.id === 'spec-structure')
    expect(specStructure?.status).toBe('fail')
  })

  it('always passes repo check when repo is set', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: '' })
    const repoCheck = checks.find((c) => c.id === 'repo-selected')
    expect(repoCheck?.status).toBe('pass')
  })
})

describe('computeStructuralChecks with specType', () => {
  it('test type: short spec is warn (advisory) not fail', () => {
    const checks = computeStructuralChecks(
      { title: 'Test auth', repo: 'BDE', spec: 'Run auth tests' },
      'test'
    )
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('warn')
  })

  it('test type: no headings is warn (advisory) not fail', () => {
    const checks = computeStructuralChecks(
      {
        title: 'Test',
        repo: 'BDE',
        spec: 'Run the integration test suite for authentication module'
      },
      'test'
    )
    const structure = checks.find((c) => c.id === 'spec-structure')
    expect(structure?.status).toBe('warn')
  })

  it('feature type: short spec is fail (required)', () => {
    const checks = computeStructuralChecks(
      { title: 'Add feature', repo: 'BDE', spec: 'Short' },
      'feature'
    )
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('fail')
  })

  it('null specType defaults to feature profile (required)', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: 'Short' }, null)
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('fail')
  })

  it('refactor type: uses 30-char threshold', () => {
    const spec = 'Refactor the auth module code here'
    const checks = computeStructuralChecks({ title: 'Refactor', repo: 'BDE', spec }, 'refactor')
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('pass')
  })
})

describe('H2: file path extraction', () => {
  it('extracts ts/tsx/css paths from spec', () => {
    const spec = 'Modify src/main/index.ts and src/renderer/src/App.tsx'
    const paths = extractFilePaths(spec)
    expect(paths).toContain('src/main/index.ts')
    expect(paths).toContain('src/renderer/src/App.tsx')
  })

  it('deduplicates repeated paths', () => {
    const spec = 'src/main/index.ts is referenced and src/main/index.ts again'
    const paths = extractFilePaths(spec)
    expect(paths.filter((p) => p === 'src/main/index.ts')).toHaveLength(1)
  })

  it('returns empty array when no paths present', () => {
    expect(extractFilePaths('No file paths here')).toHaveLength(0)
  })

  it('shows file-paths check in computeStructuralChecks when paths found', () => {
    const spec =
      '## Plan\nModify src/main/index.ts\n## Tests\nRun npm test and verify assertions'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const filePathCheck = checks.find((c) => c.id === 'file-paths')
    expect(filePathCheck?.status).toBe('pass')
    expect(filePathCheck?.message).toContain('1 path')
  })

  it('omits file-paths check when no paths in spec', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: 'No paths here' })
    const filePathCheck = checks.find((c) => c.id === 'file-paths')
    expect(filePathCheck).toBeUndefined()
  })
})

describe('H3: anti-pattern linting', () => {
  it('warns on "explore the codebase"', () => {
    const result = checkAntiPatterns('## Plan\nExplore the codebase and fix any issues')
    expect(result.status).toBe('warn')
  })

  it('warns on "investigate"', () => {
    const result = checkAntiPatterns('## Plan\nInvestigate the authentication module')
    expect(result.status).toBe('warn')
  })

  it('warns on "find any issues"', () => {
    const result = checkAntiPatterns('## Plan\nFind any issues in the auth code')
    expect(result.status).toBe('warn')
  })

  it('warns on "improve where needed"', () => {
    const result = checkAntiPatterns('## Plan\nImprove where needed throughout the module')
    expect(result.status).toBe('warn')
  })

  it('warns on "fix as needed"', () => {
    const result = checkAntiPatterns('## Plan\nFix as needed after reviewing the code')
    expect(result.status).toBe('warn')
  })

  it('warns on "clean up"', () => {
    const result = checkAntiPatterns('## Plan\nClean up the old handler registrations')
    expect(result.status).toBe('warn')
  })

  it('warns on "refactor where appropriate"', () => {
    const result = checkAntiPatterns(
      '## Plan\nRefactor where appropriate to improve readability'
    )
    expect(result.status).toBe('warn')
  })

  it('passes on explicit instructions', () => {
    const result = checkAntiPatterns(
      '## Plan\nModify src/main/index.ts to add safeHandle for sprint:create'
    )
    expect(result.status).toBe('pass')
  })

  it('is case-insensitive', () => {
    const result = checkAntiPatterns('## Plan\nEXPLORE THE CODEBASE')
    expect(result.status).toBe('warn')
  })

  it('reflects in computeStructuralChecks', () => {
    const spec = '## Plan\nExplore the codebase and find any issues\n## Tests\nRun npm test'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const antiPattern = checks.find((c) => c.id === 'anti-pattern')
    expect(antiPattern?.status).toBe('warn')
  })

  it('passes in computeStructuralChecks on clean spec', () => {
    const spec = '## Plan\nModify src/main/index.ts to add handler\n## Tests\nRun npm test'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const antiPattern = checks.find((c) => c.id === 'anti-pattern')
    expect(antiPattern?.status).toBe('pass')
  })
})

describe('H4: test section detection', () => {
  it('warns when no test section present', () => {
    const result = checkTestSection('## Problem\nBug\n## Fix\nFix it')
    expect(result.status).toBe('warn')
  })

  it('passes when "## How to Test" heading present', () => {
    const result = checkTestSection('## Problem\nBug\n## How to Test\nRun npm test')
    expect(result.status).toBe('pass')
  })

  it('passes when "## Testing" heading present', () => {
    const result = checkTestSection('## Problem\nBug\n## Testing\nRun the test suite')
    expect(result.status).toBe('pass')
  })

  it('passes when "## Verification" heading present', () => {
    const result = checkTestSection('## Problem\nBug\n## Verification\nVerify the fix works')
    expect(result.status).toBe('pass')
  })

  it('passes when "## How to Verify" heading present', () => {
    const result = checkTestSection('## Plan\nFix\n## How to Verify\nCheck behavior')
    expect(result.status).toBe('pass')
  })

  it('is case-insensitive for heading match', () => {
    const result = checkTestSection('## Plan\nDo stuff\n## TESTING\nRun tests')
    expect(result.status).toBe('pass')
  })

  it('reflects in computeStructuralChecks', () => {
    const spec = '## Problem\nBug\n## Fix\nFix it with long enough text to pass length check'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const testCheck = checks.find((c) => c.id === 'test-section')
    expect(testCheck?.status).toBe('warn')
  })

  it('passes in computeStructuralChecks when test section exists', () => {
    const spec = '## Problem\nBug\n## How to Test\nRun npm test and verify output'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const testCheck = checks.find((c) => c.id === 'test-section')
    expect(testCheck?.status).toBe('pass')
  })
})

describe('H5: handler count awareness', () => {
  it('returns null when no handler mentions in spec', () => {
    const result = checkHandlerCountAwareness('## Plan\nAdd a new feature to the dashboard')
    expect(result).toBeNull()
  })

  it('warns when safeHandle mentioned without test mention', () => {
    const result = checkHandlerCountAwareness(
      '## Plan\nAdd safeHandle for the new IPC channel'
    )
    expect(result?.status).toBe('warn')
  })

  it('warns when "IPC handler" mentioned without test mention', () => {
    const result = checkHandlerCountAwareness(
      '## Plan\nRegister a new IPC handler for file reads'
    )
    expect(result?.status).toBe('warn')
  })

  it('passes when handler mentioned alongside "handler count"', () => {
    const result = checkHandlerCountAwareness(
      '## Plan\nAdd safeHandle and update handler count in test'
    )
    expect(result?.status).toBe('pass')
  })

  it('passes when handler mentioned alongside "test"', () => {
    const result = checkHandlerCountAwareness(
      '## Plan\nAdd safeHandle\n## Testing\nUpdate the test assertions'
    )
    expect(result?.status).toBe('pass')
  })

  it('passes when handler mentioned alongside "assertion"', () => {
    const result = checkHandlerCountAwareness(
      '## Plan\nAdd safeHandle\n## Verification\nUpdate the assertion count'
    )
    expect(result?.status).toBe('pass')
  })

  it('reflects in computeStructuralChecks', () => {
    const spec =
      '## Plan\nAdd safeHandle for the new channel in src/main/index.ts\n## Overview\nJust do it'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const handlerCheck = checks.find((c) => c.id === 'handler-count')
    expect(handlerCheck?.status).toBe('warn')
  })
})

describe('H6: preload declaration sync', () => {
  it('returns null when no preload mention', () => {
    const result = checkPreloadSync('## Plan\nModify src/main/index.ts only')
    expect(result).toBeNull()
  })

  it('warns when preload mentioned without .d.ts mention', () => {
    const result = checkPreloadSync('## Plan\nUpdate src/preload/index.ts to add new method')
    expect(result?.status).toBe('warn')
  })

  it('passes when preload and index.d.ts both mentioned', () => {
    const result = checkPreloadSync(
      '## Plan\nUpdate preload/index.ts\n## Files\nAlso update index.d.ts'
    )
    expect(result?.status).toBe('pass')
  })

  it('passes when preload and .d.ts both mentioned', () => {
    const result = checkPreloadSync(
      '## Plan\nUpdate preload and update the .d.ts type declarations'
    )
    expect(result?.status).toBe('pass')
  })

  it('reflects in computeStructuralChecks', () => {
    const spec =
      '## Plan\nAdd method to preload/index.ts\n## Testing\nRun typecheck to verify'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const preloadCheck = checks.find((c) => c.id === 'preload-sync')
    expect(preloadCheck?.status).toBe('warn')
  })

  it('passes in computeStructuralChecks when d.ts mentioned', () => {
    const spec =
      '## Plan\nAdd method to preload/index.ts and update index.d.ts\n## Testing\nRun typecheck'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const preloadCheck = checks.find((c) => c.id === 'preload-sync')
    expect(preloadCheck?.status).toBe('pass')
  })
})

describe('H7: complexity estimation', () => {
  it('passes for 0 file paths', () => {
    const result = checkComplexity('## Plan\nNo file paths here')
    expect(result.status).toBe('pass')
    expect(result.message).toBe('Reasonable scope')
  })

  it('passes for 1-8 file paths', () => {
    const paths = Array.from(
      { length: 5 },
      (_, i) => `src/renderer/src/components/foo${i}.tsx`
    ).join('\n')
    const result = checkComplexity(paths)
    expect(result.status).toBe('pass')
    expect(result.message).toContain('5 files')
  })

  it('warns for 9-15 file paths', () => {
    const paths = Array.from(
      { length: 10 },
      (_, i) => `src/renderer/src/components/foo${i}.tsx`
    ).join('\n')
    const result = checkComplexity(paths)
    expect(result.status).toBe('warn')
    expect(result.message).toContain('10 files')
  })

  it('fails for 16+ file paths', () => {
    const paths = Array.from(
      { length: 20 },
      (_, i) => `src/renderer/src/components/foo${i}.tsx`
    ).join('\n')
    const result = checkComplexity(paths)
    expect(result.status).toBe('fail')
    expect(result.message).toContain('20 files')
  })

  it('reflects in computeStructuralChecks for high complexity', () => {
    const paths = Array.from(
      { length: 16 },
      (_, i) => `src/renderer/src/components/foo${i}.tsx`
    ).join('\n')
    const spec = `## Plan\n${paths}\n## Testing\nRun tests`
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const complexityCheck = checks.find((c) => c.id === 'complexity')
    expect(complexityCheck?.status).toBe('fail')
  })

  it('reflects in computeStructuralChecks for medium complexity', () => {
    const paths = Array.from(
      { length: 10 },
      (_, i) => `src/renderer/src/components/foo${i}.tsx`
    ).join('\n')
    const spec = `## Plan\n${paths}\n## Testing\nRun tests`
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const complexityCheck = checks.find((c) => c.id === 'complexity')
    expect(complexityCheck?.status).toBe('warn')
  })
})
