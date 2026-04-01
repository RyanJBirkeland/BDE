import type { BDESkill } from './types'

export const taskOrchestrationSkill: BDESkill = {
  id: 'task-orchestration',
  trigger: 'User wants to create tasks, set dependencies, or manage queue',
  description: 'Create and manage sprint tasks with dependencies',
  guidance: `# Task Orchestration

## Creating Tasks
Use the sprint:create IPC channel:
- Requires: title, repo, prompt or spec
- spec = structured markdown with ## headings (for status='queued')
- prompt = freeform text (for backlog)

\`\`\`typescript
// Example: Create task via IPC
await window.api.sprint.create({
  title: 'Fix bug in IPC handler',
  repo: 'bde',
  spec: '## Goal\\nFix the race condition...\\n\\n## Approach\\n...',
  status: 'queued'
})
\`\`\`

## Setting Dependencies
- Hard: downstream blocked until upstream succeeds
- Soft: downstream unblocks regardless
- Format: \`depends_on: [{id: 'task-id', type: 'hard'}]\`
- Cycles rejected at creation

\`\`\`typescript
// Example: Create task with dependencies
await window.api.sprint.create({
  title: 'Add tests for feature',
  repo: 'bde',
  spec: '## Goal\\nAdd unit tests...',
  depends_on: [{ id: 'parent-task-id', type: 'hard' }]
})
\`\`\`

## Bulk Operations
1. Create parent task with full spec
2. Create child tasks with depends_on → parent
3. Soft deps between siblings if order doesn't matter

## Queue API Alternative
http://localhost:18790/queue/tasks
- POST /queue/tasks — create
- PATCH /queue/tasks/:id/dependencies — update deps
- Auth: Bearer token from Settings > Agent Manager

\`\`\`bash
# Example: Create via Queue API
curl -X POST http://localhost:18790/queue/tasks \\
  -H "Authorization: Bearer \${BDE_API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Task title",
    "repo": "bde",
    "spec": "## Goal\\n..."
  }'
\`\`\`
`,
  capabilities: ['ipc-sprint-create', 'queue-api-call']
}
