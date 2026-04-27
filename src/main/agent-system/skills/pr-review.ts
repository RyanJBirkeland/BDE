import type { FLEETSkill } from './types'

export const prReviewSkill: FLEETSkill = {
  id: 'pr-review',
  trigger: 'User asks about PR review, merge conflicts, CI failures, or rebasing',
  description: 'Review PRs, check CI, resolve conflicts using gh CLI and the Code Review Station',
  guidance: `# PR Review & Merge

## Check PR Status
\`\`\`bash
gh pr list --state open
gh pr view <number> --json title,state,mergeable,statusCheckRollup
gh pr checks <number>
\`\`\`

## Review Code Changes
\`\`\`bash
gh pr diff <number>
gh pr diff <number> --name-only
\`\`\`

## Resolve Merge Conflicts
1. Create worktree: \`git worktree add ~/.fleet/worktrees/rebase-<branch> <branch>\`
2. Rebase: \`cd ~/.fleet/worktrees/rebase-<branch> && git rebase origin/main\`
3. Resolve conflicts, then \`git add <file> && git rebase --continue\`
4. For modify/delete conflicts: \`git rm <file>\`
5. Push: \`git push --force-with-lease origin <branch>\`
6. Cleanup: \`git worktree remove ~/.fleet/worktrees/rebase-<branch>\`

## Merge Strategies
- **Squash** (default): Combines all commits. Best for feature branches.
- **Merge commit**: Preserves history. Use for large PRs.
- **Rebase**: Linear history. Use when branch is clean.

## FLEET Code Review Station
The Code Review Station (Cmd+5) provides diff inspection, commit history, conversation tab, and per-task actions: Ship It (merge + push in one click), Merge Locally, Create PR, Request Revision, Rebase, and Discard. Agent worktrees are preserved for human inspection at \`review\` status.
`,
  capabilities: ['gh-cli', 'git-rebase', 'code-review-station']
}
