import type { BDESkill } from './types'

export const debuggingSkill: BDESkill = {
  id: 'debugging',
  trigger: 'User reports failed tasks, agent errors, pipeline stalls, or unexpected behavior',
  description: 'Diagnose agent failures, inspect logs, fix stuck tasks',
  guidance: `# Debugging Agent Issues

## Check Agent Logs
\`\`\`bash
tail -200 ~/.bde/bde.log
grep -i "error\\|fail\\|timeout" ~/.bde/bde.log | tail -50
\`\`\`

## Inspect Task History
\`\`\`sql
SELECT id, title, status, claimed_by, started_at, notes FROM sprint_tasks WHERE id = '...';
SELECT * FROM task_changes WHERE task_id = '...' ORDER BY changed_at DESC LIMIT 20;
SELECT id, title, status, notes FROM sprint_tasks WHERE status IN ('error', 'failed');
\`\`\`

## Reset Errored Tasks
Must clear BOTH status AND claimed_by via SQLite:
\`\`\`sql
UPDATE sprint_tasks SET status='queued', claimed_by=NULL, notes=NULL, started_at=NULL, completed_at=NULL, fast_fail_count=0 WHERE id='...';
\`\`\`

## Clean Stale Worktrees & Branches
\`\`\`bash
git worktree prune
git branch | grep agent/ | xargs git branch -D
\`\`\`

## Common Failure Modes
- **OAuth token expired**: Refresh ~/.bde/oauth-token
- **Fast-fail (3 failures in 30s)**: Check bde.log, fix root cause, reset task
- **Watchdog timeout (1hr)**: Increase max_runtime_ms or reduce task scope
- **Worktree conflicts**: Run prune + delete stale branches first
`,
  capabilities: ['file-read-logs', 'sqlite-query', 'git-worktree']
}
