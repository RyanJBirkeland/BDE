import { useTaskWorkbenchValidation } from '../stores/taskWorkbenchValidation'
import { useDebouncedAsync } from './useDebouncedAsync'
import type { SpecType } from '../../../shared/spec-validation'

interface SpecQualityChecksProps {
  spec: string
  title: string
  repo: string
  specType: SpecType | null
}

const MIN_SPEC_LENGTH_FOR_CHECK = 50

/**
 * Runs debounced semantic quality checks (Tier 2) against the spec content.
 * Updates the store's semanticChecks and semanticLoading fields as a side effect.
 * Debounce delay: 2 seconds after spec/title/repo/specType stops changing.
 */
export function useSpecQualityChecks({
  spec,
  title,
  repo,
  specType
}: SpecQualityChecksProps): void {
  const setSemanticChecks = useTaskWorkbenchValidation((s) => s.setSemanticChecks)

  useDebouncedAsync(
    async () => {
      if (!spec.trim() || spec.length < MIN_SPEC_LENGTH_FOR_CHECK) {
        setSemanticChecks([])
        return
      }

      try {
        const result = await window.api.workbench.checkSpec({ title, repo, spec, specType })
        setSemanticChecks([
          {
            id: 'clarity',
            label: 'Clarity',
            tier: 2,
            status: result.clarity.status,
            message: result.clarity.message,
            fieldId: 'wb-form-spec'
          },
          {
            id: 'scope',
            label: 'Scope',
            tier: 2,
            status: result.scope.status,
            message: result.scope.message,
            fieldId: 'wb-form-spec'
          },
          {
            id: 'files-exist',
            label: 'Files',
            tier: 2,
            status: result.filesExist.status,
            message: result.filesExist.message,
            fieldId: 'wb-form-spec'
          }
        ])
      } catch {
        setSemanticChecks([
          {
            id: 'clarity',
            label: 'Clarity',
            tier: 2,
            status: 'warn',
            message: 'Unable to check',
            fieldId: 'wb-form-spec'
          },
          {
            id: 'scope',
            label: 'Scope',
            tier: 2,
            status: 'warn',
            message: 'Unable to check',
            fieldId: 'wb-form-spec'
          },
          {
            id: 'files-exist',
            label: 'Files',
            tier: 2,
            status: 'warn',
            message: 'Unable to check',
            fieldId: 'wb-form-spec'
          }
        ])
      }
    },
    [spec, title, repo, specType],
    {
      delayMs: 2000,
      onStart: () => {
        if (spec.trim() && spec.length >= MIN_SPEC_LENGTH_FOR_CHECK) {
          useTaskWorkbenchValidation.setState({ semanticLoading: true })
        }
      }
    }
  )
}
