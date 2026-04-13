import { describe, it, expect } from 'vitest'
import { withMaxOldSpaceOption, AGENT_PROCESS_MAX_OLD_SPACE_MB } from '../sdk-adapter'

describe('sdk-adapter', () => {
  describe('withMaxOldSpaceOption', () => {
    it('should add flag if NODE_OPTIONS is empty', () => {
      const result = withMaxOldSpaceOption(undefined, 1024)
      expect(result).toBe('--max-old-space-size=1024')
    })

    it('should add flag if NODE_OPTIONS is whitespace', () => {
      const result = withMaxOldSpaceOption('  ', 1024)
      expect(result).toBe('--max-old-space-size=1024')
    })

    it('should append to existing NODE_OPTIONS', () => {
      const result = withMaxOldSpaceOption('--expose-gc', 1024)
      expect(result).toBe('--expose-gc --max-old-space-size=1024')
    })

    it('should not add duplicate flag if already present', () => {
      const result = withMaxOldSpaceOption('--max-old-space-size=2048', 1024)
      expect(result).toBe('--max-old-space-size=2048')
    })

    it('should honor existing max-old-space-size even if different', () => {
      const result = withMaxOldSpaceOption('--expose-gc --max-old-space-size=512', 1024)
      expect(result).toBe('--expose-gc --max-old-space-size=512')
    })

    it('should use default AGENT_PROCESS_MAX_OLD_SPACE_MB constant', () => {
      const result = withMaxOldSpaceOption(undefined, AGENT_PROCESS_MAX_OLD_SPACE_MB)
      expect(result).toBe(`--max-old-space-size=${AGENT_PROCESS_MAX_OLD_SPACE_MB}`)
    })

    it('should handle complex NODE_OPTIONS with multiple flags', () => {
      const existing = '--expose-gc --trace-warnings --max-http-header-size=16384'
      const result = withMaxOldSpaceOption(existing, 2048)
      expect(result).toBe(
        '--expose-gc --trace-warnings --max-http-header-size=16384 --max-old-space-size=2048'
      )
    })

    it('should preserve exact existing value when flag already present', () => {
      const existing = '--trace-gc --max-old-space-size=8192'
      const result = withMaxOldSpaceOption(existing, 1024)
      expect(result).toBe(existing)
    })
  })
})
