# TQ-S1: Fix Vitest Configuration & Coverage Reporting

**Epic:** Testing & QA
**Priority:** P0 (prerequisite for all other stories)
**Estimate:** Small
**Type:** Infrastructure

---

## Problem

### 1. Worktree Bleed

Vitest's default test discovery walks the entire project tree. BDE has 20+ `.worktrees/` directories (and `.claude/worktrees/`), each containing their own `node_modules/`. Some dependencies ship `.spec.ts` files (e.g., `exponential-backoff/src/backoff.spec.ts`) that use Jest globals. When Vitest encounters these, it fails with `jest is not defined`.

**Current exclusion in `vitest.config.ts:8`:**
```ts
exclude: ['src/main/**/*.test.ts', 'node_modules'],
```

This excludes the root `node_modules/` but NOT:
- `.worktrees/*/node_modules/`
- `.worktrees/*/**/*.spec.ts`
- `.claude/worktrees/*/node_modules/`

### 2. Coverage Thresholds Too Low

Current thresholds (`vitest.config.ts:14-19`):
```ts
thresholds: {
  statements: 40,
  branches: 30,
  functions: 35,
  lines: 40,
}
```

These are placeholder values that don't enforce meaningful coverage. With 32 test files already passing, real coverage is likely above these thresholds, making them non-functional gates.

### 3. Node Config Missing Coverage

`vitest.node.config.ts` has no coverage configuration at all — main process tests don't contribute to coverage reporting.

### 4. No Unified Test Script

`npm test` runs `vitest run` which uses `vitest.config.ts` (renderer only). Main process tests require `npm run test:main` separately. There's no single command that runs both.

---

## Solution

### 1. Fix Exclusions

**File: `vitest.config.ts`**

```ts
exclude: [
  'src/main/**/*.test.ts',
  'node_modules/**',
  '.worktrees/**',
  '.claude/**',
  'out/**',
  'dist/**',
],
```

**File: `vitest.node.config.ts`**

```ts
exclude: [
  'node_modules/**',
  '.worktrees/**',
  '.claude/**',
],
```

### 2. Raise Coverage Thresholds

**File: `vitest.config.ts`**

```ts
thresholds: {
  statements: 60,
  branches: 45,
  functions: 55,
  lines: 60,
},
```

### 3. Add Coverage to Node Config

**File: `vitest.node.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      '.worktrees/**',
      '.claude/**',
    ],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/main/**/*.ts'],
      exclude: ['**/__tests__/**', '**/*.d.ts'],
    },
  },
})
```

### 4. Add Unified Test Script

**File: `package.json` — add to `scripts`:**

```json
"test:all": "vitest run && vitest run --config vitest.node.config.ts",
"test:coverage:all": "vitest run --coverage && vitest run --config vitest.node.config.ts --coverage"
```

---

## Files to Modify

| File | Change |
|------|--------|
| `vitest.config.ts` | Add `.worktrees/**`, `.claude/**` to exclude; raise thresholds |
| `vitest.node.config.ts` | Add exclude list, add coverage config |
| `package.json` | Add `test:all` and `test:coverage:all` scripts |

## Files to Create

None.

---

## Verification

```bash
# 1. Worktree bleed is gone
npm test  # Should pass without "jest is not defined" errors

# 2. Coverage reports correctly
npm run test:coverage  # Should show renderer coverage with enforced thresholds
npm run test:main      # Should pass main process tests

# 3. Unified command works
npm run test:all  # Both suites pass in sequence
```

## Acceptance Criteria

- [ ] `npm test` completes without worktree/Jest bleed errors
- [ ] `.worktrees/` and `.claude/` directories excluded from both vitest configs
- [ ] Coverage thresholds set to statements: 60%, branches: 45%, functions: 55%, lines: 60%
- [ ] `vitest.node.config.ts` includes coverage reporting
- [ ] `npm run test:all` runs both renderer and main process test suites
