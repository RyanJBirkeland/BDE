import { systemIntrospectionSkill } from './system-introspection'
import { taskOrchestrationSkill } from './task-orchestration'
import { codePatternsSkill } from './code-patterns'
import { prReviewSkill } from './pr-review'
import { debuggingSkill } from './debugging'

/**
 * Consolidate all skill guidance into a single markdown string for interactive agents.
 *
 * Skills provide actionable guidance for common agent tasks: system introspection
 * (querying SQLite, reading logs), task orchestration (creating tasks, setting dependencies),
 * and code patterns (generating BDE-idiomatic code like IPC handlers, Zustand stores).
 *
 * This function is called by `buildAgentPrompt()` when the agent type is assistant or adhoc. Pipeline agents do not receive skills since
 * they execute specs, not open-ended exploration.
 *
 * @returns Markdown string with all skill guidance concatenated (separated by "---")
 */
export function getAllSkills(): string {
  const skills = [
    systemIntrospectionSkill,
    taskOrchestrationSkill,
    codePatternsSkill,
    prReviewSkill,
    debuggingSkill
  ]

  return skills.map(s => s.guidance).join('\n\n---\n\n')
}

/**
 * Get all BDE skills as structured data objects.
 *
 * Each skill object includes:
 * - `id`: Unique skill identifier
 * - `trigger`: When this skill should be used
 * - `description`: What the skill does
 * - `guidance`: Step-by-step instructions and examples (markdown)
 * - `capabilities`: Optional list of what this skill enables
 *
 * Use this function when you need programmatic access to skill metadata.
 * For prompt injection, use `getAllSkills()` instead.
 *
 * @returns Array of BDESkill objects
 */
export function getSkillList() {
  return [
    systemIntrospectionSkill,
    taskOrchestrationSkill,
    codePatternsSkill,
    prReviewSkill,
    debuggingSkill
  ]
}
