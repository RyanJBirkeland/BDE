const MAX_DIFF_CHARS = 12000

export function buildReviewSummaryPrompt(diffStat: string, taskTitle: string): string {
  const truncated =
    diffStat.length > MAX_DIFF_CHARS
      ? diffStat.slice(0, MAX_DIFF_CHARS) + '\n... (truncated)'
      : diffStat

  return `You are reviewing code changes for a task titled "${taskTitle}".

Here is the diff stat:
\`\`\`
${truncated}
\`\`\`

Write a concise review summary in 2-4 bullet points. Include:
- Number of files changed, insertions, deletions
- Types of changes (new features, bug fixes, tests, refactoring, styling)
- Any potential risks or concerns (breaking changes, missing tests, large files)
- Overall assessment: safe to merge, needs attention, or risky

Keep the summary under 200 words. Be direct and factual.`
}
