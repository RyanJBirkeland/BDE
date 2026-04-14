import { systemIntrospectionSkill } from './system-introspection'
import { taskOrchestrationSkill } from './task-orchestration'
import { codePatternsSkill } from './code-patterns'
import { prReviewSkill } from './pr-review'
import { debuggingSkill } from './debugging'
import type { BDESkill } from './types'

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

  return skills.map((s) => s.guidance).join('\n\n---\n\n')
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
export function getSkillList(): BDESkill[] {
  return [
    systemIntrospectionSkill,
    taskOrchestrationSkill,
    codePatternsSkill,
    prReviewSkill,
    debuggingSkill
  ]
}

const SKILL_STOP_WORDS = new Set(['user', 'asks', 'about', 'when', 'wants', 'task'])

function skillKeywords(trigger: string): Set<string> {
  return new Set(
    trigger
      .toLowerCase()
      .split(/\W+/)
      .filter((tok) => tok.length >= 3 && !SKILL_STOP_WORDS.has(tok))
  )
}

/**
 * Returns guidance for skills whose trigger keywords match the task content.
 * codePatternsSkill is always included as a baseline for interactive coding agents.
 * Falls back to all skills when taskContent is empty or contains no relevant keywords
 * (interactive session with no task context or generic task description).
 *
 * @param taskContent The user's task or request text
 * @returns Markdown string with matched skill guidance (separated by "---")
 */
export function selectSkills(taskContent: string): string {
  if (!taskContent.trim()) return getAllSkills()

  const lower = taskContent.toLowerCase()
  const skills = getSkillList()
  const matched: BDESkill[] = []
  let foundNonCodePatterns = false

  for (const skill of skills) {
    if (skill.id === 'code-patterns') {
      matched.push(skill) // always include as baseline
      continue
    }
    const keywords = skillKeywords(skill.trigger)
    const matches = [...keywords].some((kw) => lower.includes(kw))
    if (matches) {
      matched.push(skill)
      foundNonCodePatterns = true
    }
  }

  // If only code-patterns matched (no relevant keywords found), fall back to all skills
  if (!foundNonCodePatterns) return getAllSkills()

  return matched.map((s) => s.guidance).join('\n\n---\n\n')
}
