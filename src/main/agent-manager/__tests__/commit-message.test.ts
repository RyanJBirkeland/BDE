import { describe, it, expect } from 'vitest'
import { buildCommitMessage } from '../commit-message'
import type { SprintTask } from '../../../shared/types/task-types'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-test-id',
    title: 'Some task title',
    repo: 'bde',
    prompt: null,
    priority: 1,
    status: 'queued',
    notes: null,
    spec: null,
    retry_count: 0,
    fast_fail_count: 0,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    template_name: null,
    depends_on: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

const FIX_WITH_FILES_SPEC = `## Summary
Fix login crash.

## Files to Change
- src/main/auth/login.ts
- src/main/auth/session.ts

## How to Test
Run \`npm test\`.
`

const FEATURE_WITH_FILES_SPEC = `## Summary
Improve timeout error copy.

## Files to Change
- src/renderer/src/components/ui/ErrorMessage.tsx

## How to Test
Visual check.
`

describe('buildCommitMessage — spec_type → commit type mapping', () => {
  it('maps feature to feat', () => {
    const task = makeTask({ id: 'id-1', title: 'Add login page', spec_type: 'feature' })
    expect(buildCommitMessage(task)).toMatch(/^feat\(/)
  })

  it('maps bug-fix to fix', () => {
    const task = makeTask({ id: 'id-2', title: 'Fix crash', spec_type: 'bug-fix' })
    expect(buildCommitMessage(task)).toMatch(/^fix\(/)
  })

  it('maps refactor to refactor', () => {
    const task = makeTask({ id: 'id-3', title: 'Refactor auth', spec_type: 'refactor' })
    expect(buildCommitMessage(task)).toMatch(/^refactor\(/)
  })

  it('maps test-coverage to test', () => {
    const task = makeTask({ id: 'id-4', title: 'Add auth tests', spec_type: 'test-coverage' })
    expect(buildCommitMessage(task)).toMatch(/^test\(/)
  })

  it('maps freeform to chore', () => {
    const task = makeTask({ id: 'id-5', title: 'Update config', spec_type: 'freeform' })
    expect(buildCommitMessage(task)).toMatch(/^chore\(/)
  })

  it('maps prompt to chore', () => {
    const task = makeTask({ id: 'id-6', title: 'Misc work', spec_type: 'prompt' })
    expect(buildCommitMessage(task)).toMatch(/^chore\(/)
  })

  it('falls back to chore for unknown spec_type', () => {
    const task = makeTask({ id: 'id-7', title: 'Something', spec_type: 'unknown-type' })
    expect(buildCommitMessage(task)).toMatch(/^chore\(/)
  })

  it('falls back to chore when spec_type is null', () => {
    const task = makeTask({ id: 'id-8', title: 'Something', spec_type: null })
    expect(buildCommitMessage(task)).toMatch(/^chore\(/)
  })
})

describe('buildCommitMessage — scope extraction', () => {
  it('extracts basename without extension from first file in ## Files to Change', () => {
    const task = makeTask({
      id: 'task-42',
      title: 'T-42 [P1] Fix login crash',
      spec_type: 'bug-fix',
      spec: FIX_WITH_FILES_SPEC
    })
    expect(buildCommitMessage(task)).toMatch(/^fix\(login\): Fix login crash/)
  })

  it('uses scope from feature task first file', () => {
    const task = makeTask({
      id: 'task-5',
      title: 'T-5 [P2] Improve timeout error copy',
      spec_type: 'feature',
      spec: FEATURE_WITH_FILES_SPEC
    })
    expect(buildCommitMessage(task)).toMatch(/^feat\(errormessage\): Improve timeout error copy/)
  })

  it('falls back to agent when spec is null', () => {
    const task = makeTask({
      id: 'task-10',
      title: 'T-10 [P1] Do something',
      spec_type: 'feature',
      spec: null
    })
    expect(buildCommitMessage(task)).toMatch(/^feat\(agent\): Do something/)
  })

  it('falls back to agent when ## Files to Change section is absent', () => {
    const task = makeTask({
      id: 'task-11',
      title: 'T-11 [P1] Update config',
      spec_type: 'feature',
      spec: '## Summary\nJust some work.\n\n## How to Test\nManual.'
    })
    expect(buildCommitMessage(task)).toMatch(/^feat\(agent\): Update config/)
  })

  it('falls back to agent when spec is a prompt-type with no files section', () => {
    const task = makeTask({
      id: 'task-12',
      title: 'Do some freeform work',
      spec_type: 'prompt',
      spec: null
    })
    expect(buildCommitMessage(task)).toMatch(/^chore\(agent\): Do some freeform work/)
  })
})

describe('buildCommitMessage — title prefix stripping', () => {
  it('strips T-N [PN] prefix from title', () => {
    const task = makeTask({
      id: 'task-42',
      title: 'T-42 [P1] Fix login crash',
      spec_type: 'bug-fix',
      spec: FIX_WITH_FILES_SPEC
    })
    const message = buildCommitMessage(task)
    expect(message).toContain('Fix login crash')
    expect(message).not.toContain('T-42')
    expect(message).not.toContain('[P1]')
  })

  it('strips PR-N [PN] prefix from title', () => {
    const task = makeTask({
      id: 'pr-4',
      title: 'PR-4 [P1] Add commit message feature',
      spec_type: 'feature',
      spec: FIX_WITH_FILES_SPEC
    })
    const message = buildCommitMessage(task)
    expect(message).toContain('Add commit message feature')
    expect(message).not.toContain('PR-4')
    expect(message).not.toContain('[P1]')
  })

  it('leaves title unchanged when no recognized prefix is present', () => {
    const task = makeTask({
      id: 'task-99',
      title: 'Improve onboarding flow',
      spec_type: 'feature',
      spec: FIX_WITH_FILES_SPEC
    })
    expect(buildCommitMessage(task)).toContain('Improve onboarding flow')
  })
})

describe('buildCommitMessage — Task-Id trailer', () => {
  it('appends Task-Id trailer after a blank line', () => {
    const task = makeTask({
      id: 'task-42',
      title: 'T-42 [P1] Fix login crash',
      spec_type: 'bug-fix',
      spec: FIX_WITH_FILES_SPEC
    })
    const message = buildCommitMessage(task)
    expect(message).toContain('\n\nTask-Id: task-42')
  })

  it('full message matches expected format for acceptance criterion 1', () => {
    const task = makeTask({
      id: 'task-42-id',
      title: 'T-42 [P1] Fix login crash',
      spec_type: 'bug-fix',
      spec: FIX_WITH_FILES_SPEC
    })
    expect(buildCommitMessage(task)).toBe(
      'fix(login): Fix login crash\n\nTask-Id: task-42-id'
    )
  })
})
