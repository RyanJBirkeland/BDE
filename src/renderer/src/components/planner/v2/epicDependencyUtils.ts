import type { EpicDependency } from '../../../../../shared/types'

export const CONDITION_LABEL: Record<EpicDependency['condition'], string> = {
  on_success: 'on success',
  always: 'always',
  manual: 'manual'
}

export function nextDependencyCondition(
  current: EpicDependency['condition']
): EpicDependency['condition'] {
  if (current === 'on_success') return 'always'
  if (current === 'always') return 'manual'
  return 'on_success'
}
