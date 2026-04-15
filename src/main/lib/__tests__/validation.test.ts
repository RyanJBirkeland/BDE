import { describe, it, expect } from 'vitest'
import { isValidAgentId, AGENT_ID_PATTERN } from '../validation'

describe('AGENT_ID_PATTERN', () => {
  it('is exported and matches expected regex', () => {
    expect(AGENT_ID_PATTERN).toBeInstanceOf(RegExp)
    expect(AGENT_ID_PATTERN.source).toBe('^[a-zA-Z0-9_-]{1,64}$')
  })
})

describe('isValidAgentId', () => {
  describe('valid agent IDs', () => {
    it('accepts alphanumeric characters', () => {
      expect(isValidAgentId('abc123')).toBe(true)
      expect(isValidAgentId('ABC123')).toBe(true)
      expect(isValidAgentId('Agent42')).toBe(true)
    })

    it('accepts hyphens and underscores', () => {
      expect(isValidAgentId('agent-123')).toBe(true)
      expect(isValidAgentId('agent_456')).toBe(true)
      expect(isValidAgentId('my-agent_id-789')).toBe(true)
    })

    it('accepts single character', () => {
      expect(isValidAgentId('a')).toBe(true)
      expect(isValidAgentId('1')).toBe(true)
      expect(isValidAgentId('_')).toBe(true)
      expect(isValidAgentId('-')).toBe(true)
    })

    it('accepts exactly 64 characters', () => {
      const maxLength = 'a'.repeat(64)
      expect(isValidAgentId(maxLength)).toBe(true)
    })

    it('accepts mixed valid characters up to 64 chars', () => {
      const id = 'Agent-123_Test-456_ID-789_ABCD-EFGH-1234-5678-9012-3456-7890-XYZ'
      expect(id.length).toBe(64)
      expect(isValidAgentId(id)).toBe(true)
    })
  })

  describe('invalid agent IDs', () => {
    it('rejects empty string', () => {
      expect(isValidAgentId('')).toBe(false)
    })

    it('rejects strings longer than 64 characters', () => {
      const tooLong = 'a'.repeat(65)
      expect(isValidAgentId(tooLong)).toBe(false)
    })

    it('rejects path traversal attempts', () => {
      expect(isValidAgentId('../etc')).toBe(false)
      expect(isValidAgentId('../../passwd')).toBe(false)
      expect(isValidAgentId('./local')).toBe(false)
      expect(isValidAgentId('/absolute/path')).toBe(false)
    })

    it('rejects strings with special characters', () => {
      expect(isValidAgentId('agent@123')).toBe(false)
      expect(isValidAgentId('agent#456')).toBe(false)
      expect(isValidAgentId('agent$789')).toBe(false)
      expect(isValidAgentId('agent!test')).toBe(false)
      expect(isValidAgentId('agent*wild')).toBe(false)
    })

    it('rejects strings with spaces', () => {
      expect(isValidAgentId('agent 123')).toBe(false)
      expect(isValidAgentId(' agent')).toBe(false)
      expect(isValidAgentId('agent ')).toBe(false)
    })

    it('rejects strings with dots', () => {
      expect(isValidAgentId('agent.123')).toBe(false)
      expect(isValidAgentId('.')).toBe(false)
      expect(isValidAgentId('..')).toBe(false)
    })

    it('rejects strings with slashes', () => {
      expect(isValidAgentId('agent/123')).toBe(false)
      expect(isValidAgentId('agent\\123')).toBe(false)
    })

    it('rejects non-string types', () => {
      expect(isValidAgentId(null)).toBe(false)
      expect(isValidAgentId(undefined)).toBe(false)
      expect(isValidAgentId(123)).toBe(false)
      expect(isValidAgentId({})).toBe(false)
      expect(isValidAgentId([])).toBe(false)
      expect(isValidAgentId(true)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('rejects newlines and control characters', () => {
      expect(isValidAgentId('agent\n123')).toBe(false)
      expect(isValidAgentId('agent\r123')).toBe(false)
      expect(isValidAgentId('agent\t123')).toBe(false)
    })

    it('rejects unicode characters outside ASCII alphanumeric', () => {
      expect(isValidAgentId('agentø123')).toBe(false)
      expect(isValidAgentId('agent✓123')).toBe(false)
      expect(isValidAgentId('agentétest')).toBe(false)
    })
  })
})
