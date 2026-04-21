import { SpecQualityService } from './spec-quality-service'
import { SpecParser } from './spec-parser'
import {
  RequiredSectionsValidator,
  FilePathsValidator,
  NumberedStepsValidator,
  BannedPhrasesValidator,
  SizeWarningsValidator
} from './validators/sync-validators'
import { PrescriptivenessValidator } from './validators/prescriptiveness-validator'

/** Composition root — only place concrete class names appear outside tests */
export function createSpecQualityService(): SpecQualityService {
  return new SpecQualityService(
    new SpecParser(),
    [
      new RequiredSectionsValidator(),
      new FilePathsValidator(),
      new NumberedStepsValidator(),
      new BannedPhrasesValidator(),
      new SizeWarningsValidator()
    ],
    [new PrescriptivenessValidator()]
  )
}
