/**
 * Task query language parser and executor.
 *
 * Supports structured queries like:
 * - status:active
 * - repo:BDE
 * - priority:<=2
 * - tag:frontend
 * - created:>7d
 * - Free text search (matches title)
 *
 * Example: `status:failed priority:<=2 tag:frontend "auth bug"`
 */

import type { SprintTask } from '../../../shared/types'

export type ComparisonOp = '=' | '<' | '>' | '<=' | '>='

export type TaskPredicate =
  | { type: 'status'; value: string }
  | { type: 'repo'; value: string }
  | { type: 'priority'; op: ComparisonOp; value: number }
  | { type: 'tag'; value: string }
  | { type: 'created'; op: ComparisonOp; value: number } // value in days
  | { type: 'text'; value: string }

/**
 * Parse a query string into predicates.
 *
 * @param query - Raw query string (e.g., "status:failed priority:<=2 auth")
 * @returns Array of predicates to apply
 */
export function parseTaskQuery(query: string): TaskPredicate[] {
  if (!query.trim()) return []

  const predicates: TaskPredicate[] = []
  const tokens = tokenize(query)

  for (const token of tokens) {
    const predicate = parseToken(token)
    if (predicate) predicates.push(predicate)
  }

  return predicates
}

/**
 * Tokenize query string, preserving quoted strings.
 */
function tokenize(query: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < query.length; i++) {
    const char = query[i]

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ' ' && !inQuotes) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) tokens.push(current)

  return tokens
}

/**
 * Parse a single token into a predicate.
 */
function parseToken(token: string): TaskPredicate | null {
  // Try to parse as field:value
  const colonIndex = token.indexOf(':')
  if (colonIndex === -1) {
    // No colon — treat as free text
    return { type: 'text', value: token }
  }

  const field = token.slice(0, colonIndex).toLowerCase()
  const value = token.slice(colonIndex + 1)

  if (!value) return null // Empty value

  switch (field) {
    case 'status':
      return { type: 'status', value: value.toLowerCase() }

    case 'repo':
      return { type: 'repo', value }

    case 'tag':
      return { type: 'tag', value }

    case 'priority':
      return parsePriorityPredicate(value)

    case 'created':
      return parseCreatedPredicate(value)

    default:
      // Unknown field — treat as free text
      return { type: 'text', value: token }
  }
}

/**
 * Parse priority predicate with comparison operators.
 * Supports: priority:2, priority:<=2, priority:>1
 */
function parsePriorityPredicate(value: string): TaskPredicate | null {
  const match = value.match(/^([<>]=?|=)?(\d+)$/)
  if (!match) return null

  const op = (match[1] || '=') as ComparisonOp
  const numStr = match[2]
  if (!numStr) return null
  const num = parseInt(numStr, 10)

  if (isNaN(num)) return null

  return { type: 'priority', op, value: num }
}

/**
 * Parse created date predicate with comparison operators.
 * Supports: created:>7d, created:<=30d
 * Value is in days relative to now.
 */
function parseCreatedPredicate(value: string): TaskPredicate | null {
  const match = value.match(/^([<>]=?|=)?(\d+)d$/)
  if (!match) return null

  const op = (match[1] || '=') as ComparisonOp
  const daysStr = match[2]
  if (!daysStr) return null
  const days = parseInt(daysStr, 10)

  if (isNaN(days)) return null

  return { type: 'created', op, value: days }
}

/**
 * Apply predicates to filter tasks.
 * All predicates are combined with AND logic.
 */
export function applyPredicates(tasks: SprintTask[], predicates: TaskPredicate[]): SprintTask[] {
  if (predicates.length === 0) return tasks

  return tasks.filter((task) => predicates.every((pred) => matchesPredicate(task, pred)))
}

/**
 * Check if a task matches a single predicate.
 */
function matchesPredicate(task: SprintTask, predicate: TaskPredicate): boolean {
  switch (predicate.type) {
    case 'status':
      return task.status.toLowerCase() === predicate.value

    case 'repo':
      return task.repo === predicate.value

    case 'tag':
      return task.tags?.includes(predicate.value) ?? false

    case 'priority':
      return compareNumber(task.priority, predicate.op, predicate.value)

    case 'created': {
      const createdAt = new Date(task.created_at)
      const now = new Date()
      const ageInDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
      return compareNumber(ageInDays, predicate.op, predicate.value)
    }

    case 'text':
      return task.title.toLowerCase().includes(predicate.value.toLowerCase())

    default:
      return true
  }
}

/**
 * Compare numbers with an operator.
 */
function compareNumber(a: number, op: ComparisonOp, b: number): boolean {
  switch (op) {
    case '=':
      return a === b
    case '<':
      return a < b
    case '>':
      return a > b
    case '<=':
      return a <= b
    case '>=':
      return a >= b
    default:
      return false
  }
}
