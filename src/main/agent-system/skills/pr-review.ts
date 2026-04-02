import type { BDESkill } from './types'

export const prReviewSkill: BDESkill = {
  id: 'pr-review',
  trigger: 'User asks about PR review, merge conflicts, CI failures, or rebasing',
  description: 'Review PRs, check CI, resolve conflicts using gh CLI and PR Station',
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
1. Create worktree: \`git worktree add ~/worktrees/bde/rebase-<branch> <branch>\`
2. Rebase: \`cd ~/worktrees/bde/rebase-<branch> && git rebase origin/main\`
3. Resolve conflicts, then \`git add <file> && git rebase --continue\`
4. For modify/delete conflicts: \`git rm <file>\`
5. Push: \`git push --force-with-lease origin <branch>\`
6. Cleanup: \`git worktree remove ~/worktrees/bde/rebase-<branch>\`

## Merge Strategies
- **Squash** (default): Combines all commits. Best for feature branches.
- **Merge commit**: Preserves history. Use for large PRs.
- **Rebase**: Linear history. Use when branch is clean.

## BDE PR Station
PR Station view (Cmd+5) provides inline code review with CI badges, diff comments, batch review submission, and merge controls.
`,
  capabilities: ['gh-cli', 'git-rebase', 'pr-station']
}
