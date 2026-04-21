/**
 * Epic templates — pre-configured epics with task stubs.
 * Each template includes epic metadata and a set of tasks with spec stubs.
 */

import type { SpecType } from '../../../../shared/spec-validation'

export interface EpicTaskStub {
  title: string
  spec: string
  spec_type: SpecType
  priority?: number | undefined
}

export interface EpicTemplate {
  id: string
  name: string
  icon: string
  goal: string
  description: string
  tasks: EpicTaskStub[]
}

export const EPIC_TEMPLATES: EpicTemplate[] = [
  {
    id: 'feature-dev',
    name: 'Feature Development',
    icon: '🚀',
    goal: 'Build a new feature end-to-end with spec, implementation, and tests',
    description: 'Complete feature lifecycle from spec to tests',
    tasks: [
      {
        title: 'Feature spec and design',
        spec: '## Problem\n\n## Solution\n\n## Files to Change\n\n## Out of Scope\n',
        spec_type: 'feature',
        priority: 1
      },
      {
        title: 'Implement feature',
        spec: '## Problem\n\n## Solution\n\n## Files to Change\n\n## Out of Scope\n',
        spec_type: 'feature',
        priority: 2
      },
      {
        title: 'Add feature tests',
        spec: '## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n',
        spec_type: 'test',
        priority: 3
      }
    ]
  },
  {
    id: 'bug-fix',
    name: 'Bug Investigation & Fix',
    icon: '🐛',
    goal: 'Investigate, reproduce, and fix a reported bug with regression tests',
    description: 'Systematic bug resolution workflow',
    tasks: [
      {
        title: 'Reproduce and investigate bug',
        spec: '## Bug Description\n\n## Root Cause\n\n## Fix\n\n## Files to Change\n\n## How to Test\n',
        spec_type: 'bugfix',
        priority: 1
      },
      {
        title: 'Implement fix',
        spec: '## Bug Description\n\n## Root Cause\n\n## Fix\n\n## Files to Change\n\n## How to Test\n',
        spec_type: 'bugfix',
        priority: 2
      },
      {
        title: 'Add regression tests',
        spec: '## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n',
        spec_type: 'test',
        priority: 3
      }
    ]
  },
  {
    id: 'refactor',
    name: 'Refactoring Initiative',
    icon: '♻️',
    goal: 'Clean up and reorganize code to improve maintainability',
    description: 'Structured refactoring with safety checks',
    tasks: [
      {
        title: 'Refactor implementation',
        spec: "## What's Being Refactored\n\n## Target State\n\n## Files to Change\n\n## Out of Scope\n",
        spec_type: 'refactor',
        priority: 1
      },
      {
        title: 'Verify refactoring safety',
        spec: '## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n',
        spec_type: 'test',
        priority: 2
      }
    ]
  },
  {
    id: 'test-coverage',
    name: 'Test Coverage',
    icon: '✅',
    goal: 'Add comprehensive test coverage for existing functionality',
    description: 'Systematic test expansion',
    tasks: [
      {
        title: 'Unit tests',
        spec: '## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n',
        spec_type: 'test',
        priority: 1
      },
      {
        title: 'Integration tests',
        spec: '## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n',
        spec_type: 'test',
        priority: 2
      },
      {
        title: 'Edge cases and error handling',
        spec: '## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n',
        spec_type: 'test',
        priority: 3
      }
    ]
  }
]
