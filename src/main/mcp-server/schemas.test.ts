import { describe, it, expect } from 'vitest'
import {
  TaskStatusSchema,
  TaskWriteFieldsSchema,
  TaskListSchema,
  TaskHistorySchema,
  EpicWriteFieldsSchema
} from './schemas'
import { TASK_STATUSES } from '../../shared/task-state-machine'

/**
 * These tests pin the precise boundaries of every length-capped / range-capped
 * field the MCP server accepts. They also pin a representative sample of
 * `.describe()` strings — the enriched error messages surfaced to clients via
 * `toJsonRpcError` are part of the contract now, so silent deletions (or
 * drift) should show up as failing tests.
 *
 * When a legitimate product change moves a boundary, the expected-value table
 * changes in the same PR as the schema — that co-location is the point.
 */

const minimalValidTask = { title: 't', repo: 'bde' }

function taskWith<K extends string>(field: K, value: unknown): Record<string, unknown> {
  return { ...minimalValidTask, [field]: value }
}

describe('TaskStatusSchema', () => {
  it('accepts every declared task status literal', () => {
    for (const status of TASK_STATUSES) {
      expect(() => TaskStatusSchema.parse(status)).not.toThrow()
    }
  })

  it('rejects values not in the 9-literal union', () => {
    expect(() => TaskStatusSchema.parse('bogus')).toThrow()
    expect(() => TaskStatusSchema.parse('')).toThrow()
    expect(() => TaskStatusSchema.parse('QUEUED')).toThrow()
  })
})

describe('TaskWriteFieldsSchema — string length boundaries', () => {
  const stringBoundaries: Array<{
    field: keyof typeof TaskWriteFieldsSchema.shape
    min: number
    max: number
  }> = [
    { field: 'title', min: 1, max: 500 },
    { field: 'repo', min: 1, max: 200 },
    { field: 'template_name', min: 1, max: 200 }
  ]

  for (const { field, min, max } of stringBoundaries) {
    describe(`${String(field)} (${min}-${max} chars)`, () => {
      it(`accepts ${min}-char value`, () => {
        expect(() => TaskWriteFieldsSchema.parse(taskWith(field, 'x'.repeat(min)))).not.toThrow()
      })

      it(`accepts ${max}-char value`, () => {
        expect(() => TaskWriteFieldsSchema.parse(taskWith(field, 'x'.repeat(max)))).not.toThrow()
      })

      if (min > 0) {
        it(`rejects ${min - 1}-char value (empty)`, () => {
          expect(() => TaskWriteFieldsSchema.parse(taskWith(field, ''))).toThrow()
        })
      }

      it(`rejects ${max + 1}-char value (one over cap)`, () => {
        expect(() => TaskWriteFieldsSchema.parse(taskWith(field, 'x'.repeat(max + 1)))).toThrow()
      })
    })
  }

  const optionalStringMaxBoundaries: Array<{
    field: keyof typeof TaskWriteFieldsSchema.shape
    max: number
  }> = [
    { field: 'prompt', max: 200_000 },
    { field: 'spec', max: 200_000 },
    { field: 'notes', max: 10_000 },
    { field: 'cross_repo_contract', max: 10_000 }
  ]

  for (const { field, max } of optionalStringMaxBoundaries) {
    describe(`${String(field)} (max ${max} chars)`, () => {
      it(`accepts ${max}-char value`, () => {
        expect(() => TaskWriteFieldsSchema.parse(taskWith(field, 'x'.repeat(max)))).not.toThrow()
      })

      it(`rejects ${max + 1}-char value (one over cap)`, () => {
        expect(() => TaskWriteFieldsSchema.parse(taskWith(field, 'x'.repeat(max + 1)))).toThrow()
      })
    })
  }
})

describe('TaskWriteFieldsSchema — priority range', () => {
  it('accepts priority 0 (lowest)', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('priority', 0))).not.toThrow()
  })

  it('accepts priority 10 (highest)', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('priority', 10))).not.toThrow()
  })

  it('rejects priority -1', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('priority', -1))).toThrow()
  })

  it('rejects priority 11', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('priority', 11))).toThrow()
  })

  it('rejects non-integer priority 1.5', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('priority', 1.5))).toThrow()
  })
})

describe('TaskWriteFieldsSchema — tags array', () => {
  it('accepts 32-item tag array', () => {
    const tags = Array.from({ length: 32 }, (_, i) => `tag${i}`)
    expect(() => TaskWriteFieldsSchema.parse(taskWith('tags', tags))).not.toThrow()
  })

  it('rejects 33-item tag array', () => {
    const tags = Array.from({ length: 33 }, (_, i) => `tag${i}`)
    expect(() => TaskWriteFieldsSchema.parse(taskWith('tags', tags))).toThrow()
  })

  it('accepts 64-char tag', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('tags', ['x'.repeat(64)]))).not.toThrow()
  })

  it('rejects 65-char tag', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('tags', ['x'.repeat(65)]))).toThrow()
  })

  it('rejects empty tag string', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('tags', ['']))).toThrow()
  })
})

describe('TaskWriteFieldsSchema — depends_on array', () => {
  it('accepts 32 dependencies', () => {
    const deps = Array.from({ length: 32 }, (_, i) => ({ id: `task-${i}`, type: 'hard' as const }))
    expect(() => TaskWriteFieldsSchema.parse(taskWith('depends_on', deps))).not.toThrow()
  })

  it('rejects 33 dependencies', () => {
    const deps = Array.from({ length: 33 }, (_, i) => ({ id: `task-${i}`, type: 'hard' as const }))
    expect(() => TaskWriteFieldsSchema.parse(taskWith('depends_on', deps))).toThrow()
  })

  it('rejects dependency with empty id', () => {
    expect(() =>
      TaskWriteFieldsSchema.parse(taskWith('depends_on', [{ id: '', type: 'hard' }]))
    ).toThrow()
  })

  it('rejects dependency with unknown type', () => {
    expect(() =>
      TaskWriteFieldsSchema.parse(taskWith('depends_on', [{ id: 'a', type: 'medium' }]))
    ).toThrow()
  })
})

describe('TaskWriteFieldsSchema — max_runtime_ms', () => {
  it('accepts 60_000 (1 minute, min)', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('max_runtime_ms', 60_000))).not.toThrow()
  })

  it('accepts 86_400_000 (24 hours, max)', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('max_runtime_ms', 86_400_000))).not.toThrow()
  })

  it('rejects 59_999 (one ms below min)', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('max_runtime_ms', 59_999))).toThrow()
  })

  it('rejects 86_400_001 (one ms over max)', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('max_runtime_ms', 86_400_001))).toThrow()
  })

  it('rejects non-integer', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('max_runtime_ms', 60_000.5))).toThrow()
  })
})

describe('TaskWriteFieldsSchema — group_id nullability', () => {
  it('accepts null group_id (explicit detach)', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('group_id', null))).not.toThrow()
  })

  it('accepts non-empty group_id string', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('group_id', 'epic-1'))).not.toThrow()
  })

  it('rejects empty group_id string', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('group_id', ''))).toThrow()
  })
})

describe('TaskWriteFieldsSchema — spec_type enum', () => {
  const acceptable = ['feature', 'bug-fix', 'refactor', 'test-coverage', 'freeform', 'prompt']
  for (const value of acceptable) {
    it(`accepts spec_type="${value}"`, () => {
      expect(() => TaskWriteFieldsSchema.parse(taskWith('spec_type', value))).not.toThrow()
    })
  }

  it('rejects spec_type="unknown"', () => {
    expect(() => TaskWriteFieldsSchema.parse(taskWith('spec_type', 'unknown'))).toThrow()
  })
})

describe('TaskListSchema — limit/offset bounds', () => {
  it('accepts limit=1', () => {
    expect(() => TaskListSchema.parse({ limit: 1 })).not.toThrow()
  })

  it('accepts limit=500', () => {
    expect(() => TaskListSchema.parse({ limit: 500 })).not.toThrow()
  })

  it('rejects limit=0', () => {
    expect(() => TaskListSchema.parse({ limit: 0 })).toThrow()
  })

  it('rejects limit=501', () => {
    expect(() => TaskListSchema.parse({ limit: 501 })).toThrow()
  })

  it('accepts offset=0', () => {
    expect(() => TaskListSchema.parse({ offset: 0 })).not.toThrow()
  })

  it('rejects offset=-1', () => {
    expect(() => TaskListSchema.parse({ offset: -1 })).toThrow()
  })
})

describe('TaskHistorySchema — limit/offset bounds', () => {
  it('accepts limit=1 and limit=500 with required id', () => {
    expect(() => TaskHistorySchema.parse({ id: 't1', limit: 1 })).not.toThrow()
    expect(() => TaskHistorySchema.parse({ id: 't1', limit: 500 })).not.toThrow()
  })

  it('rejects limit=0 and limit=501', () => {
    expect(() => TaskHistorySchema.parse({ id: 't1', limit: 0 })).toThrow()
    expect(() => TaskHistorySchema.parse({ id: 't1', limit: 501 })).toThrow()
  })

  it('accepts offset=0, rejects offset=-1', () => {
    expect(() => TaskHistorySchema.parse({ id: 't1', offset: 0 })).not.toThrow()
    expect(() => TaskHistorySchema.parse({ id: 't1', offset: -1 })).toThrow()
  })

  it('rejects missing id', () => {
    expect(() => TaskHistorySchema.parse({ limit: 10 })).toThrow()
  })
})

describe('EpicWriteFieldsSchema — name length', () => {
  it('accepts 1-char name', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'x' })).not.toThrow()
  })

  it('accepts 200-char name', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'x'.repeat(200) })).not.toThrow()
  })

  it('rejects empty name', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: '' })).toThrow()
  })

  it('rejects 201-char name', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'x'.repeat(201) })).toThrow()
  })
})

describe('EpicWriteFieldsSchema — icon length', () => {
  it('accepts 4-char icon (max)', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e', icon: 'x'.repeat(4) })).not.toThrow()
  })

  it('rejects 5-char icon (one over cap)', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e', icon: 'x'.repeat(5) })).toThrow()
  })
})

describe('EpicWriteFieldsSchema — accent_color hex regex', () => {
  it('accepts 6-digit lowercase hex', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e', accent_color: '#aabbcc' })).not.toThrow()
  })

  it('accepts 6-digit uppercase hex (case-insensitive)', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e', accent_color: '#AABBCC' })).not.toThrow()
  })

  it('rejects 3-digit shorthand #fff', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e', accent_color: '#fff' })).toThrow()
  })

  it('rejects non-hex characters #GGGGGG', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e', accent_color: '#GGGGGG' })).toThrow()
  })

  it('rejects missing leading #', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e', accent_color: 'aabbcc' })).toThrow()
  })
})

describe('EpicWriteFieldsSchema — goal length and nullability', () => {
  it('accepts 2000-char goal', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e', goal: 'x'.repeat(2000) })).not.toThrow()
  })

  it('rejects 2001-char goal', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e', goal: 'x'.repeat(2001) })).toThrow()
  })

  it('accepts goal: null (clear-goal semantics)', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e', goal: null })).not.toThrow()
  })

  it('accepts goal: undefined (leave-unchanged semantics)', () => {
    expect(() => EpicWriteFieldsSchema.parse({ name: 'e' })).not.toThrow()
  })
})

describe('.describe() contract text', () => {
  it('pins title describe string', () => {
    expect(TaskWriteFieldsSchema.shape.title.description).toContain('1-500 chars')
  })

  it('pins repo describe string', () => {
    expect(TaskWriteFieldsSchema.shape.repo.description).toContain('1-200 chars')
  })

  it('pins priority describe string', () => {
    expect(TaskWriteFieldsSchema.shape.priority.description).toContain('0-10')
  })

  it('pins max_runtime_ms describe string', () => {
    expect(TaskWriteFieldsSchema.shape.max_runtime_ms.description).toContain('60000')
    expect(TaskWriteFieldsSchema.shape.max_runtime_ms.description).toContain('86400000')
  })

  it('pins tags describe string', () => {
    expect(TaskWriteFieldsSchema.shape.tags.description).toContain('32 tags')
    expect(TaskWriteFieldsSchema.shape.tags.description).toContain('1-64 chars')
  })

  it('pins TaskListSchema.limit describe string', () => {
    expect(TaskListSchema.shape.limit.description).toContain('1-500')
  })

  it('pins EpicWriteFieldsSchema.name describe string', () => {
    expect(EpicWriteFieldsSchema.shape.name.description).toContain('1-200 chars')
  })

  it('pins EpicWriteFieldsSchema.accent_color describe string', () => {
    expect(EpicWriteFieldsSchema.shape.accent_color.description).toContain('hex')
  })
})
