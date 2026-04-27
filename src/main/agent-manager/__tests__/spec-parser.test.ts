import { describe, it, expect } from 'vitest'
import { extractFilesToChange } from '../spec-parser'

describe('extractFilesToChange', () => {
  describe('bullet variants', () => {
    it('parses backtick-quoted paths', () => {
      const spec = `
## Files to Change
- \`src/foo/bar.ts\`
- \`src/baz/qux.ts\`
`
      expect(extractFilesToChange(spec)).toEqual(['src/foo/bar.ts', 'src/baz/qux.ts'])
    })

    it('parses bare paths', () => {
      const spec = `
## Files to Change
- src/foo/bar.ts
- src/baz/qux.ts
`
      expect(extractFilesToChange(spec)).toEqual(['src/foo/bar.ts', 'src/baz/qux.ts'])
    })

    it('strips parenthetical new-file annotation', () => {
      const spec = `
## Files to Change
- src/foo/bar.ts (new file)
`
      expect(extractFilesToChange(spec)).toEqual(['src/foo/bar.ts'])
    })

    it('strips em-dash description', () => {
      const spec = `
## Files to Change
- src/foo/bar.ts — adds the new feature
`
      expect(extractFilesToChange(spec)).toEqual(['src/foo/bar.ts'])
    })

    it('strips backtick path before a parenthetical', () => {
      const spec = `
## Files to Change
- \`src/foo/bar.ts\` (new file)
`
      expect(extractFilesToChange(spec)).toEqual(['src/foo/bar.ts'])
    })
  })

  describe('section detection', () => {
    it('returns empty array when ## Files to Change section is absent', () => {
      const spec = `
## Goal
Do something.

## How to Test
Run tests.
`
      expect(extractFilesToChange(spec)).toEqual([])
    })

    it('returns empty array for an empty string', () => {
      expect(extractFilesToChange('')).toEqual([])
    })

    it('stops collecting paths at the next ## heading', () => {
      const spec = `
## Files to Change
- src/foo.ts
- src/bar.ts

## How to Test
- npm test
`
      expect(extractFilesToChange(spec)).toEqual(['src/foo.ts', 'src/bar.ts'])
    })

    it('is case-insensitive for the section heading', () => {
      const spec = `
## files to change
- src/foo.ts
`
      expect(extractFilesToChange(spec)).toEqual(['src/foo.ts'])
    })
  })

  describe('path filtering', () => {
    it('excludes non-path bullet entries', () => {
      const spec = `
## Files to Change
- src/foo.ts
- Run npm install first
`
      // "Run npm install first" has no slash and no extension — excluded
      expect(extractFilesToChange(spec)).toEqual(['src/foo.ts'])
    })

    it('includes paths with only a file extension and no slash', () => {
      const spec = `
## Files to Change
- config.json
`
      expect(extractFilesToChange(spec)).toEqual(['config.json'])
    })

    it('ignores blank lines between bullets', () => {
      const spec = `
## Files to Change
- src/a.ts

- src/b.ts
`
      expect(extractFilesToChange(spec)).toEqual(['src/a.ts', 'src/b.ts'])
    })
  })

  describe('real-world spec formats', () => {
    it('handles a full spec with multiple sections', () => {
      const spec = `
## Goal
Add a new feature.

## Files to Change
- \`src/main/agent-manager/spec-parser.ts\` (new file)
- \`src/main/agent-manager/run-agent.ts\`
- \`src/shared/types/task-types.ts\`

## How to Test
Run npm test.
`
      expect(extractFilesToChange(spec)).toEqual([
        'src/main/agent-manager/spec-parser.ts',
        'src/main/agent-manager/run-agent.ts',
        'src/shared/types/task-types.ts'
      ])
    })
  })
})
