import { describe, it, expect } from 'vitest'
import {
  INTERACTIVE_AGENT_SETTINGS_SOURCES,
  TEXT_HELPER_SETTINGS_SOURCES
} from '../sdk-policy'

describe('sdk-policy', () => {
  it('interactive agents use user+local sources — no project to avoid double-injecting CLAUDE.md', () => {
    expect(INTERACTIVE_AGENT_SETTINGS_SOURCES).toEqual(['user', 'local'])
    expect(INTERACTIVE_AGENT_SETTINGS_SOURCES).not.toContain('project')
  })

  it('text-only helpers use empty sources — skip all settings to minimize cost', () => {
    expect(TEXT_HELPER_SETTINGS_SOURCES).toEqual([])
  })
})
