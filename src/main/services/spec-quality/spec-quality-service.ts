import type {
  ISpecParser,
  ISpecValidator,
  IAsyncSpecValidator
} from '../../../shared/spec-quality/interfaces'
import type { SpecIssue, SpecQualityResult } from '../../../shared/spec-quality/types'

export class SpecQualityService {
  constructor(
    private readonly parser: ISpecParser,
    private readonly syncValidators: ISpecValidator[],
    private readonly asyncValidators: IAsyncSpecValidator[]
  ) {}

  /** Sync-only validation — fast, no I/O. Used in real-time UI feedback. */
  validateStructural(raw: string): SpecQualityResult {
    const spec = this.parser.parse(raw)
    const issues = this.syncValidators.flatMap((v) => v.validate(spec))
    return buildResult(issues, false)
  }

  /** Full validation including async AI prescriptiveness check.
   *  Only runs async validators if structural validation passes (no errors). */
  async validateFull(raw: string): Promise<SpecQualityResult> {
    const structural = this.validateStructural(raw)
    if (!structural.valid) return structural

    const spec = this.parser.parse(raw)
    const asyncIssues = (
      await Promise.all(this.asyncValidators.map((v) => v.validate(spec)))
    ).flat()

    const allIssues = [...structural.issues, ...asyncIssues]
    return buildResult(allIssues, true)
  }
}

function buildResult(issues: SpecIssue[], prescriptivenessChecked: boolean): SpecQualityResult {
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  return { valid: errors.length === 0, issues, errors, warnings, prescriptivenessChecked }
}
