import { describe, it, expect } from 'vitest'
import { getAllMemory } from '../index'
import { ipcConventions } from '../ipc-conventions'
import { testingPatterns } from '../testing-patterns'
import { architectureRules } from '../architecture-rules'

describe('Memory System', () => {
  it('should consolidate all memory modules', () => {
    const memory = getAllMemory()
    expect(memory).toContain('IPC Conventions')
    expect(memory).toContain('Testing Patterns')
    expect(memory).toContain('Architecture Rules')
  })

  it('should separate modules with markdown dividers', () => {
    const memory = getAllMemory()
    expect(memory).toContain('---')
  })

  it('should include IPC conventions content', () => {
    expect(ipcConventions).toContain('safeHandle')
    expect(ipcConventions).toContain('Handler Registration')
  })

  it('should include testing patterns content', () => {
    expect(testingPatterns).toContain('72%')
    expect(testingPatterns).toContain('Coverage Requirements')
  })

  it('should include architecture rules content', () => {
    expect(architectureRules).toContain('Process Boundaries')
    expect(architectureRules).toContain('Zustand')
  })
})
