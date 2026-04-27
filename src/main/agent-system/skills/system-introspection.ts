import type { BDESkill } from './types'

export const systemIntrospectionSkill: BDESkill = {
  id: 'system-introspection',
  trigger: 'User asks about queue health, active agents, task status, or logs',
  description: 'Query BDE system state (queue, agents, logs, dependencies)',
  guidance: `# System Introspection

You can directly inspect BDE's internal state:

## Check Queue Health
Query SQLite:
\`\`\`sql
SELECT status, COUNT(*) FROM sprint_tasks GROUP BY status;
\`\`\`

Look for:
- High blocked count → dependency issues
- Stalled active tasks → check started_at (>1hr)

## View Active Agents
\`\`\`sql
SELECT id, status, task, started_at
FROM agent_runs
WHERE status='running';
\`\`\`

Cross-reference with ~/.bde/bde.log for detailed output.

## Inspect Task Status
\`\`\`sql
SELECT * FROM sprint_tasks WHERE id='...';
\`\`\`

Check depends_on field for dependency chains.

## Diagnose Pipeline Stalls
- Tasks stuck in 'active' for >1hr (check started_at)
- Check ~/.bde/bde.log for watchdog timeouts
- Verify worktrees exist: ls ~/.bde/worktrees/

## Example Usage
\`\`\`bash
# Check queue health
sqlite3 ~/.bde/bde.db "SELECT status, COUNT(*) FROM sprint_tasks GROUP BY status"

# Read recent agent logs
tail -100 ~/.bde/bde.log
\`\`\`
`,
  capabilities: ['sqlite-query', 'file-read-logs']
}
