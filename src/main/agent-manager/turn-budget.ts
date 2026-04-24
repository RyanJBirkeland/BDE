/**
 * turn-budget.ts — Spec-aware turn budget and tool policy for pipeline agents.
 *
 * Pipeline tasks routinely need 50-75 turns: read the affected files, make the
 * edit, write the test, run the test, fix what the test surfaces, commit. The
 * Phase-B 2026-04-24 measurement showed that a 30-turn cap exhausted on every
 * task tested — including a 2-line change with one regression test — because
 * test-writing alone consumes 15-25 turns. A higher floor is the simpler fix.
 *
 * The explicit `## Multi-File: true` header is preserved as a user signal even
 * though it currently maps to the same budget as the default. Future tuning
 * may diverge them (e.g. raise the multi-file ceiling to 100+ once we've
 * confirmed 75 is sufficient for the common case).
 *
 * The pipeline tool policy lives here too so it stays co-located with the rest
 * of the spec-aware spawn tuning.
 */

const DEFAULT_MAX_TURNS = 75
const MULTI_FILE_MAX_TURNS = 75

/**
 * Explicit opt-in header that authors can add to a spec to request a higher
 * turn budget. Case-sensitive on purpose — the spec format itself is informal,
 * and we don't want to accidentally match prose like "multi-file" inside a
 * sentence.
 */
const MULTI_FILE_HEADER = '## Multi-File: true'

/**
 * Returns the pipeline agent `maxTurns` budget for a given spec.
 *
 * Today the header and default both resolve to 75 turns. The header path is
 * retained so a future change can raise the multi-file ceiling without
 * touching call sites.
 */
export function computeMaxTurns(spec: string): number {
  if (spec.includes(MULTI_FILE_HEADER)) {
    return MULTI_FILE_MAX_TURNS
  }
  return DEFAULT_MAX_TURNS
}

/**
 * Tools blocked for pipeline agents.
 *
 * Two classes of entries:
 *
 * 1. **Reconnaissance Bash subcommands** (`git log`, `git status`, …) that
 *    burn turns without producing value when the spec already describes the
 *    target files.
 * 2. **Network and credential-reach tools** (`curl`, `wget`, `ssh`, `scp`,
 *    `nc`, `gh`, `WebFetch`, `WebSearch`) that are outside the pipeline
 *    agent's legitimate responsibilities (edit code inside the worktree, run
 *    tests) and provide direct exfiltration / lateral-movement primitives if
 *    a spec contains a prompt-injection payload. The Code Review Station
 *    drives PR creation and pushing, not the agent itself.
 *
 * The SDK's `disallowedTools` uses tool-name + pattern strings matching
 * Claude Code's permission rule syntax: `Bash(<command>:*)` matches any
 * Bash invocation whose command line starts with `<command>`; a bare tool
 * name (e.g. `WebFetch`) disables the tool entirely.
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
  'Bash(git log --grep:*)',
  'Bash(curl:*)',
  'Bash(wget:*)',
  'Bash(ssh:*)',
  'Bash(scp:*)',
  'Bash(nc:*)',
  'Bash(gh:*)',
  'WebFetch',
  'WebSearch'
]
