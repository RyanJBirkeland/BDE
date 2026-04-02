// Maps ticket title keywords to template types for auto-detection
// Used by: renderer (tab auto-suggest), main process (background spec generation)

const HEURISTIC_RULES: ReadonlyArray<{ keywords: readonly string[]; template: string }> = [
  { keywords: ['fix', 'bug', 'broken', 'crash', 'error', 'revert'], template: 'bugfix' },
  {
    keywords: ['add', 'new', 'create', 'implement', 'build', 'wire', 'integrate'],
    template: 'feature'
  },
  {
    keywords: ['refactor', 'extract', 'move', 'rename', 'clean', 'decompose', 'split'],
    template: 'refactor'
  },
  { keywords: ['test', 'coverage', 'spec', 'vitest', 'playwright', 'e2e'], template: 'test' },
  {
    keywords: ['perf', 'slow', 'optimize', 'cache', 'latency', 'debounce', 'memo'],
    template: 'performance'
  },
  {
    keywords: ['style', 'css', 'ui', 'ux', 'polish', 'design', 'layout', 'modal', 'animation'],
    template: 'ux'
  },
  { keywords: ['audit', 'review', 'check', 'eval', 'investigate'], template: 'audit' },
  {
    keywords: ['infra', 'deploy', 'ci', 'config', 'script', 'workflow', 'launchd'],
    template: 'infra'
  }
]

export function detectTemplate(title: string): string {
  const lower = title.toLowerCase()
  for (const rule of HEURISTIC_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.template
  }
  return 'feature'
}
