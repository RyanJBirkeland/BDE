import { describe, it, expect } from 'vitest'
import { getAllSkills, getSkillList } from '../index'
import { systemIntrospectionSkill } from '../system-introspection'
import { taskOrchestrationSkill } from '../task-orchestration'
import { codePatternsSkill } from '../code-patterns'

describe('Skills System', () => {
  describe('getAllSkills', () => {
    it('should consolidate all skill guidance', () => {
      const skills = getAllSkills()
      expect(skills).toContain('System Introspection')
      expect(skills).toContain('Task Orchestration')
      expect(skills).toContain('BDE Code Patterns')
    })

    it('should separate skills with markdown dividers', () => {
      const skills = getAllSkills()
      expect(skills).toContain('---')
    })
  })

  describe('getSkillList', () => {
    it('should return all skills as structured data', () => {
      const skills = getSkillList()
      expect(skills).toHaveLength(3)
      expect(skills[0].id).toBe('system-introspection')
      expect(skills[1].id).toBe('task-orchestration')
      expect(skills[2].id).toBe('code-patterns')
    })
  })

  describe('individual skills', () => {
    it('system introspection should have capabilities', () => {
      expect(systemIntrospectionSkill.capabilities).toContain('sqlite-query')
      expect(systemIntrospectionSkill.capabilities).toContain('file-read-logs')
    })

    it('task orchestration should have capabilities', () => {
      expect(taskOrchestrationSkill.capabilities).toContain('ipc-sprint-create')
      expect(taskOrchestrationSkill.capabilities).toContain('queue-api-call')
    })

    it('code patterns should have capability', () => {
      expect(codePatternsSkill.capabilities).toContain('code-generation')
    })

    it('all skills should have required fields', () => {
      const skills = getSkillList()
      for (const skill of skills) {
        expect(skill.id).toBeTruthy()
        expect(skill.trigger).toBeTruthy()
        expect(skill.description).toBeTruthy()
        expect(skill.guidance).toBeTruthy()
      }
    })
  })
})
