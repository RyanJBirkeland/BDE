import { describe, it, expect } from 'vitest'
import { AGENT_COMMANDS } from '../commands'

describe('AGENT_COMMANDS', () => {
  it('includes the Phase 5 expanded commands', () => {
    const names = AGENT_COMMANDS.map((c) => c.name)
    expect(names).toContain('/stop')
    expect(names).toContain('/retry')
    expect(names).toContain('/focus')
    expect(names).toContain('/checkpoint')
    expect(names).toContain('/test')
    expect(names).toContain('/scope')
    expect(names).toContain('/status')
  })

  it('every command has a description', () => {
    for (const cmd of AGENT_COMMANDS) {
      expect(cmd.description).toBeTruthy()
      expect(cmd.name.startsWith('/')).toBe(true)
    }
  })
})
