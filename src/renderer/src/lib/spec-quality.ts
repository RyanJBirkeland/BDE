export interface SpecQuality {
  hasFilesToChange: boolean
  hasHowToTest: boolean
  hasAcceptanceCriteria: boolean
}

export function analyzeSpecQuality(spec: string): SpecQuality {
  return {
    hasFilesToChange: /##\s+files to change/i.test(spec),
    hasHowToTest: /##\s+how to test/i.test(spec),
    hasAcceptanceCriteria: /##\s+acceptance criteria/i.test(spec)
  }
}
