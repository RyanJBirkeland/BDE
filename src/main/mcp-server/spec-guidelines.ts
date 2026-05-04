/**
 * Spec guidelines returned by the `meta.specGuidelines` MCP tool.
 *
 * Maintained here rather than importing from the renderer's documentation-data.ts
 * because that module depends on lucide-react (a renderer-only package).
 * Both files describe the same rules — if you update one, update the other.
 */

export function buildSpecGuidelinesMarkdown(): string {
  return `# FLEET Task Spec Guidelines

Call this tool before drafting a task spec. The pipeline agent reads the spec once and executes it literally — spec quality directly determines code quality.

---

## Required sections

Every spec must contain these four \`##\` headings. The validator rejects specs missing any of them.

- \`## Context\` — why this change is needed; what problem it solves; what the agent must understand about the codebase before starting
- \`## Files to Change\` — explicit list of every file that will be modified, with a brief note on what each file gets
- \`## Implementation Steps\` — numbered, prescriptive steps the agent executes in order
- \`## How to Test\` — exact commands or actions to verify the work is complete

Headings are matched case-insensitively but must otherwise match exactly (e.g. \`## Context\`, not \`## Background\`).

---

## Scope guidelines

- **200–500 words** is the target. Under 200 is too vague; over 500 usually means the task does too much.
- **One feature per task.** If the spec says "and also...", split into two tasks.
- **Include exact file paths.** Agents waste 15–20% of their budget on exploration when paths are missing.

---

## Files to Change format

Each entry must include a path token containing \`/\` or a file extension.

✅ PASS: \`src/main/services/auth-service.ts\` — add \`refreshToken()\` method
❌ FAIL: \`auth service\` — update the refresh method

✅ PASS: \`internal/task/repository.go\` — extend \`list()\` with date-range clauses
❌ FAIL: \`repository\` — update list query

---

## Implementation Steps format

Steps must be a numbered list. Each step is a concrete directive — not a question, not an option. Steps must not present alternatives.

✅ PASS: Add \`DueBefore *time.Time\` to the \`TaskFilter\` struct in \`internal/task/filter.go\`.
❌ FAIL: Either add the field to \`TaskFilter\` or create a separate \`DateFilter\` struct.

✅ PASS: Extend \`SpecValidator.validate()\` in \`src/shared/spec-validation.ts\` to check the prescriptiveness rule.
❌ FAIL: Decide whether to extend the existing validator or add a new one for this rule.

---

## The prescriptiveness rule

Steps must not present alternatives, even without the banned words. The validator pattern-matches on "alternatives presented" semantically, not just a word list.

**Banned phrases** (cause immediate validation failure): \`decide\`, \`choose\`, \`consider\`, \`if you prefer\`, \`depending on your preference\`, \`you could also\`, \`either...or\`.

**The broader rule**: if a step gives the agent two or more paths to the same goal, it fails. Pick one and specify it.

---

## The idiom-first principle

Before prescribing a code shape, grep the codebase for the existing pattern. If the codebase uses \`.as(String.class)\` for type casting in nine Specifications, do not spec \`criteriaBuilder.function("CAST", String.class, ...)\` from memory.

The pipeline agent is told to trust the spec over its own knowledge. If the spec prescribes a non-idiomatic pattern, the agent will use it.

---

## Prompt envelope context

The pipeline agent receives your spec inside a structured prompt envelope. Understanding this framing helps you write better specs:

- **RULES OF ENGAGEMENT preamble**: "TRUST THE SPEC... do NOT run reconnaissance commands". The agent is told to follow your spec literally, not to explore alternatives.
- **Output budget hint**: agents are warned when they approach their turn limit.
- **Time-limit section**: a watchdog (default 1 hour) terminates the agent if it runs too long.
- **Definition of Done**: the agent is told to commit all work and transition the task to review status.
- **Pre-Review Verification Gate**: the agent verifies its own work (typecheck, tests, lint) before transitioning.

Implications: do not spec reconnaissance steps (\`git log\`, \`grep -r\`, etc.) — the agent's rules forbid them. Do not write exploration language ("investigate", "find issues") — give explicit instructions.

---

## Revision pathway note

When you re-queue a task via \`tasks.update { status: "queued" }\`, the agent reruns but does NOT receive a structured \`<revision_feedback>\` block. The in-app "Request Revision" button populates this block with specific reviewer feedback; the MCP path does not.

If you need the agent to act on specific revision feedback, include it in the \`spec\` field before re-queuing — update \`spec\` and \`status\` in the same \`tasks.update\` call.

---

## Validation workflow

1. Call \`meta.specGuidelines\` — read the rules (you're doing this now)
2. Draft the spec following the guidelines above
3. Call \`tasks.validateSpec\` with your draft — fix any issues the validator reports
4. Call \`tasks.create\` with the validated spec

\`tasks.validateSpec\` runs the full validator chain and returns issues with codes and messages. It is safe to call repeatedly without side effects.

---

## Worked example

\`\`\`markdown
## Context

The task list endpoint (\`GET /tasks\`) does not support filtering by due date. Users need to narrow results to tasks due within a date range for dashboard widgets and report exports. The existing \`TaskFilter\` struct and \`TaskRepository.list()\` method accept optional filter fields — add \`due_before\` and \`due_after\` to both.

## Files to Change

- \`internal/task/filter.go\` — Add \`DueBefore\` and \`DueAfter\` fields to \`TaskFilter\`
- \`internal/task/repository.go\` — Extend \`list()\` SQL query with optional date-range clauses
- \`internal/task/handler.go\` — Parse \`due_before\` and \`due_after\` query params, validate ISO-8601 format, pass to filter
- \`internal/task/handler_test.go\` — Add table-driven test cases for valid ranges, invalid format (expect 400), and empty result set

## Implementation Steps

1. Add \`DueBefore *time.Time\` and \`DueAfter *time.Time\` to the \`TaskFilter\` struct in \`filter.go\`.
2. In \`repository.go\`, append \`AND due_at <= ?\` and \`AND due_at >= ?\` clauses to the list query when the fields are non-nil. Use the existing parameterized query builder — do not concatenate strings.
3. In \`handler.go\`, extract \`due_before\` and \`due_after\` from \`r.URL.Query()\`. Parse each with \`time.Parse(time.RFC3339, ...)\`. Return HTTP 400 with message \`"due_before must be ISO-8601"\` if parsing fails.
4. Pass the parsed \`*time.Time\` values into \`TaskFilter\` and call \`repo.List(ctx, filter)\`.
5. In \`handler_test.go\`, add three test cases to the existing \`TestListTasks\` table: valid range returning two tasks, \`due_before\` with invalid format expecting status 400, and a range with no matching tasks expecting an empty array (not null).

## How to Test

Run \`go test ./internal/task/... -run TestListTasks\` — all cases must pass. Then start the server with \`go run ./cmd/server\` and confirm \`GET /tasks?due_before=2026-06-01T00:00:00Z\` returns only tasks due before June.
\`\`\`
`
}
