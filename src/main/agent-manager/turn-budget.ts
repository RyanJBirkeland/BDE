/**
 * turn-budget.ts — Spec-aware turn budget and tool policy for pipeline agents.
 *
 * Pipeline specs vary widely in scope: a single CSS tweak completes in 10-15 turns,
 * while a multi-file refactor may legitimately need 50+ turns for reads, edits,
 * and verification. A one-size-fits-all `maxTurns` either starves big tasks or
 * wastes capacity (and invites runaway loops) on small ones.
 *
 * This module classifies a spec into a turn budget by scanning for simple markers:
 * an explicit opt-in header, cross-stack file types, and file-path density.
 *
 * The pipeline tool policy lives here too so it stays co-located with the rest
 * of the spec-aware spawn tuning.
 */

/** Pipeline turn budgets, in ascending order of spec complexity. */
const DEFAULT_MAX_TURNS = 30
const MIXED_STACK_MAX_TURNS = 50
const MULTI_FILE_MAX_TURNS = 75

/**
 * Explicit opt-in header that authors can add to a spec to request the highest
 * turn budget. Case-sensitive on purpose — the spec format itself is informal,
 * and we don't want to accidentally match prose like "multi-file" inside a
 * sentence.
 */
const MULTI_FILE_HEADER = '## Multi-File: true'

/**
 * Minimum number of `src/` path occurrences in a spec for the mixed-stack
 * branch to apply. Three is the smallest count where an agent is plausibly
 * editing "several" files rather than one file plus an incidental mention.
 */
const MIXED_STACK_SRC_PATH_THRESHOLD = 3

/**
 * Returns the pipeline agent `maxTurns` budget for a given spec.
 *
 * Rule tree:
 *   1. Spec contains the exact opt-in header → 75 turns.
 *   2. Spec mentions both `.tsx` and `.css` (case-insensitive) OR lists at
 *      least {@link MIXED_STACK_SRC_PATH_THRESHOLD} `src/` file paths → 50.
 *   3. Otherwise → 30.
 *
 * Inputs may be empty — callers without a spec should fall back to a
 * sensible default themselves rather than passing `''` here.
 */
export function computeMaxTurns(spec: string): number {
  if (spec.includes(MULTI_FILE_HEADER)) {
    return MULTI_FILE_MAX_TURNS
  }
  if (isMixedStackSpec(spec) || hasHighFilePathDensity(spec)) {
    return MIXED_STACK_MAX_TURNS
  }
  return DEFAULT_MAX_TURNS
}

function isMixedStackSpec(spec: string): boolean {
  const lower = spec.toLowerCase()
  return lower.includes('.tsx') && lower.includes('.css')
}

function hasHighFilePathDensity(spec: string): boolean {
  return countSrcPathOccurrences(spec) >= MIXED_STACK_SRC_PATH_THRESHOLD
}

function countSrcPathOccurrences(spec: string): number {
  // Match ` src/` or `/src/` — both indicate a file path rather than prose.
  const matches = spec.match(/[ /]src\//g)
  return matches ? matches.length : 0
}

/**
 * Bash subcommands blocked for pipeline agents.
 *
 * Reconnaissance commands (`git log`, `git status`, etc.) burn turns without
 * producing value when the spec already describes the target files. The SDK's
 * `disallowedTools` uses tool-name + pattern strings matching Claude Code's
 * permission rule syntax: `Bash(<command>:*)` matches any Bash invocation
 * whose command line starts with `<command>`.
 *
 * Confirmed against `@anthropic-ai/claude-agent-sdk` Options.disallowedTools
 * (string[]).
 */
export const PIPELINE_DISALLOWED_TOOLS: readonly string[] = [
  'Bash(git log:*)',
  'Bash(git status:*)',
  'Bash(git ls-remote:*)',
  'Bash(git diff:*)',
  'Bash(git reflog:*)',
  'Bash(git log --grep:*)'
]
