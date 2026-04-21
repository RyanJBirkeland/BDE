import { describe, it, expect } from 'vitest'
import { getAllSkills, getSkillList, selectSkills } from '../index'
import { systemIntrospectionSkill } from '../system-introspection'
import { taskOrchestrationSkill } from '../task-orchestration'
import { codePatternsSkill } from '../code-patterns'
import { prReviewSkill } from '../pr-review'
import { debuggingSkill } from '../debugging'

describe('Skills System', () => {
  describe('getAllSkills', () => {
    it('should consolidate all skill guidance', () => {
      const skills = getAllSkills()
      expect(skills).toContain('System Introspection')
      expect(skills).toContain('Task Orchestration')
      expect(skills).toContain('BDE Code Patterns')
      expect(skills).toContain('PR Review')
      expect(skills).toContain('Debugging')
    })

    it('should separate skills with markdown dividers', () => {
      const skills = getAllSkills()
      expect(skills).toContain('---')
    })
  })

  describe('getSkillList', () => {
    it('should return all skills as structured data', () => {
      const skills = getSkillList()
      expect(skills).toHaveLength(5)
      expect(skills[0].id).toBe('system-introspection')
      expect(skills[1].id).toBe('task-orchestration')
      expect(skills[2].id).toBe('code-patterns')
      expect(skills[3].id).toBe('pr-review')
      expect(skills[4].id).toBe('debugging')
    })
  })

  describe('individual skills', () => {
    it('system introspection should have capabilities', () => {
      expect(systemIntrospectionSkill.capabilities).toContain('sqlite-query')
      expect(systemIntrospectionSkill.capabilities).toContain('file-read-logs')
    })

    it('task orchestration should have capabilities', () => {
      expect(taskOrchestrationSkill.capabilities).toContain('ipc-sprint-create')
    })

    it('code patterns should have capability', () => {
      expect(codePatternsSkill.capabilities).toContain('code-generation')
    })

    it('pr review should have capabilities', () => {
      expect(prReviewSkill.capabilities).toContain('gh-cli')
      expect(prReviewSkill.capabilities).toContain('git-rebase')
      expect(prReviewSkill.capabilities).toContain('code-review-station')
    })

    it('debugging should have capabilities', () => {
      expect(debuggingSkill.capabilities).toContain('file-read-logs')
      expect(debuggingSkill.capabilities).toContain('sqlite-query')
      expect(debuggingSkill.capabilities).toContain('git-worktree')
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

  describe('selectSkills', () => {
    it('always includes code-patterns skill', () => {
      const result = selectSkills('write a button component')
      const codePatterns = getSkillList().find((s) => s.id === 'code-patterns')!
      expect(result).toContain(codePatterns.guidance.slice(0, 50))
    })

    it('includes pr-review skill when task mentions PR', () => {
      const result = selectSkills('review this PR and check for merge conflicts')
      const prSkill = getSkillList().find((s) => s.id === 'pr-review')!
      expect(result).toContain(prSkill.guidance.slice(0, 50))
    })

    it('returns all skills when task has no relevant keywords', () => {
      const result = selectSkills('add a zustand selector for task count')
      // Generic task with no skill-related keywords falls back to all skills
      expect(result).toBe(getAllSkills())
    })

    it('includes debugging skill when task mentions failed task', () => {
      const result = selectSkills('debug why this pipeline task keeps failing with agent errors')
      const debugSkill = getSkillList().find((s) => s.id === 'debugging')!
      expect(result).toContain(debugSkill.guidance.slice(0, 50))
    })

    it('falls back to all skills when taskContent is empty', () => {
      expect(selectSkills('')).toBe(getAllSkills())
    })

    it('falls back to all skills when taskContent is whitespace', () => {
      expect(selectSkills('   ')).toBe(getAllSkills())
    })
  })
})
