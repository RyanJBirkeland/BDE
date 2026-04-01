import { systemIntrospectionSkill } from './system-introspection'
import { taskOrchestrationSkill } from './task-orchestration'
import { codePatternsSkill } from './code-patterns'

/**
 * Consolidate all skills into a single markdown string for interactive agents
 */
export function getAllSkills(): string {
  const skills = [
    systemIntrospectionSkill,
    taskOrchestrationSkill,
    codePatternsSkill
  ]

  return skills.map(s => s.guidance).join('\n\n---\n\n')
}

/**
 * Get all skills as structured data
 */
export function getSkillList() {
  return [
    systemIntrospectionSkill,
    taskOrchestrationSkill,
    codePatternsSkill
  ]
}
