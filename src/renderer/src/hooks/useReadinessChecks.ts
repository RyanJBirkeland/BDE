import { useEffect } from 'react'
import { useTaskWorkbenchStore, type CheckResult } from '../stores/taskWorkbench'
import {
  MIN_SPEC_LENGTH,
  MIN_HEADING_COUNT,
  getValidationProfile,
  type SpecType
} from '../../../shared/spec-validation'

// Tier 1: Structural checks (pure, synchronous, runs on every form change)

interface FormSnapshot {
  title: string
  repo: string
  spec: string
}

export function computeStructuralChecks(
  form: FormSnapshot,
  specType?: SpecType | null
): CheckResult[] {
  // When specType is explicitly provided (including null), use the validation profile.
  // When specType is undefined (legacy call with no second arg), use legacy permissive behavior.
  const useProfile = specType !== undefined
  const profile = useProfile ? getValidationProfile(specType ?? null) : null
  const checks: CheckResult[] = []

  // Title present
  checks.push({
    id: 'title-present',
    label: 'Title',
    tier: 1,
    status: form.title.trim() ? 'pass' : 'fail',
    message: form.title.trim() ? 'Title provided' : 'Title is required'
  })

  // Repo selected
  checks.push({
    id: 'repo-selected',
    label: 'Repo',
    tier: 1,
    status: form.repo ? 'pass' : 'fail',
    message: form.repo ? `Repo: ${form.repo}` : 'No repo selected'
  })

  // Spec present
  const specLen = form.spec.trim().length
  let specStatus: 'pass' | 'warn' | 'fail'
  let specMsg: string
  if (profile) {
    // Profile-aware: use threshold and behavior from profile
    const specThreshold = profile.specPresent.threshold ?? MIN_SPEC_LENGTH
    const specAdvisory = profile.specPresent.behavior === 'advisory'
    if (specLen === 0) {
      specStatus = specAdvisory ? 'warn' : 'fail'
      specMsg = 'Spec is empty'
    } else if (specLen <= specThreshold) {
      specStatus = specAdvisory ? 'warn' : 'fail'
      specMsg = 'Spec is very short — consider adding more detail'
    } else {
      specStatus = 'pass'
      specMsg = `Spec: ${specLen} characters`
    }
  } else {
    // Legacy behavior (no specType provided): empty=fail, short=warn, adequate=pass
    if (specLen === 0) {
      specStatus = 'fail'
      specMsg = 'Spec is empty'
    } else if (specLen <= MIN_SPEC_LENGTH) {
      specStatus = 'warn'
      specMsg = 'Spec is very short — consider adding more detail'
    } else {
      specStatus = 'pass'
      specMsg = `Spec: ${specLen} characters`
    }
  }
  checks.push({ id: 'spec-present', label: 'Spec', tier: 1, status: specStatus, message: specMsg })

  // Spec has structure (markdown headings)
  const skipStructure = profile && profile.specStructure.behavior === 'skip'
  if (!skipStructure) {
    const headingThreshold = profile
      ? (profile.specStructure.threshold ?? MIN_HEADING_COUNT)
      : MIN_HEADING_COUNT
    const structureAdvisory = profile ? profile.specStructure.behavior === 'advisory' : false
    const headingCount = (form.spec.match(/^## /gm) ?? []).length
    let structureStatus: 'pass' | 'warn' | 'fail'
    let structureMsg: string
    if (headingCount >= headingThreshold) {
      structureStatus = 'pass'
      structureMsg = `${headingCount} sections`
    } else if (headingCount === 1) {
      structureStatus = 'warn'
      structureMsg = 'Only 1 section — consider adding Problem/Solution/Files structure'
    } else {
      structureStatus = structureAdvisory ? 'warn' : 'fail'
      structureMsg = 'No sections — use ## headings to structure the spec'
    }
    checks.push({
      id: 'spec-structure',
      label: 'Structure',
      tier: 1,
      status: structureStatus,
      message: structureMsg
    })
  }

  // H2: File path extraction (structural display — no fs.stat, just surface paths)
  const filePaths = extractFilePaths(form.spec)
  if (filePaths.length > 0) {
    checks.push({
      id: 'file-paths',
      label: 'File Paths',
      tier: 1,
      status: 'pass',
      message: `${filePaths.length} path${filePaths.length === 1 ? '' : 's'} referenced — verify these exist`
    })
  }

  // H3: Anti-pattern linting
  const antiPatternResult = checkAntiPatterns(form.spec)
  checks.push(antiPatternResult)

  // H4: Test section detection
  const testSectionResult = checkTestSection(form.spec)
  checks.push(testSectionResult)

  // H5: Handler count awareness
  const handlerCountResult = checkHandlerCountAwareness(form.spec)
  if (handlerCountResult !== null) {
    checks.push(handlerCountResult)
  }

  // H6: Preload declaration sync
  const preloadSyncResult = checkPreloadSync(form.spec)
  if (preloadSyncResult !== null) {
    checks.push(preloadSyncResult)
  }

  // H7: Complexity estimation
  const complexityResult = checkComplexity(form.spec)
  checks.push(complexityResult)

  return checks
}

// ---------------------------------------------------------------------------
// Helper functions for new checks
// ---------------------------------------------------------------------------

const FILE_PATH_REGEX = /\bsrc\/[^\s"'`),]+\.(?:ts|tsx|css|js|jsx)\b/g

export function extractFilePaths(spec: string): string[] {
  const matches = spec.match(FILE_PATH_REGEX) ?? []
  return [...new Set(matches)]
}

const ANTI_PATTERNS = [
  /explore the codebase/i,
  /investigate\b/i,
  /find any issues/i,
  /improve where (?:needed|appropriate)/i,
  /fix as needed/i,
  /clean up\b/i,
  /refactor where appropriate/i
]

export function checkAntiPatterns(spec: string): CheckResult {
  const matched = ANTI_PATTERNS.some((pattern) => pattern.test(spec))
  return {
    id: 'anti-pattern',
    label: 'Anti-patterns',
    tier: 1,
    status: matched ? 'warn' : 'pass',
    message: matched
      ? 'Pipeline agents need explicit execution instructions, not exploration directives.'
      : 'No exploration language detected'
  }
}

const TEST_HEADING_REGEX =
  /^## .*(test|testing|verification|how to test|how to verify)/im

export function checkTestSection(spec: string): CheckResult {
  const hasTestSection = TEST_HEADING_REGEX.test(spec)
  return {
    id: 'test-section',
    label: 'Testing',
    tier: 1,
    status: hasTestSection ? 'pass' : 'warn',
    message: hasTestSection
      ? 'Testing section found'
      : 'No testing section found. Agent may skip tests or write incompatible ones.'
  }
}

const HANDLER_MENTION_REGEX = /\b(?:safeHandle|IPC handler|registerHandler|handler)\b/i
const HANDLER_TEST_MENTION_REGEX = /\b(?:handler count|test|assertion)\b/i

export function checkHandlerCountAwareness(spec: string): CheckResult | null {
  if (!HANDLER_MENTION_REGEX.test(spec)) return null
  const mentionsTest = HANDLER_TEST_MENTION_REGEX.test(spec)
  return {
    id: 'handler-count',
    label: 'Handler Tests',
    tier: 1,
    status: mentionsTest ? 'pass' : 'warn',
    message: mentionsTest
      ? 'Handler count test update mentioned'
      : 'Spec mentions adding handlers but doesn\'t mention updating handler count tests.'
  }
}

const PRELOAD_MENTION_REGEX = /\bpreload(?:\/index\.ts)?\b/i
const DTS_MENTION_REGEX = /\bindex\.d\.ts\b|\.d\.ts\b/i

export function checkPreloadSync(spec: string): CheckResult | null {
  if (!PRELOAD_MENTION_REGEX.test(spec)) return null
  const mentionsDts = DTS_MENTION_REGEX.test(spec)
  return {
    id: 'preload-sync',
    label: 'Preload Sync',
    tier: 1,
    status: mentionsDts ? 'pass' : 'warn',
    message: mentionsDts
      ? 'Type declaration update mentioned'
      : "Spec modifies preload but doesn't mention updating type declarations (index.d.ts)."
  }
}

const COMPLEXITY_HIGH_THRESHOLD = 16
const COMPLEXITY_MED_THRESHOLD = 9

export function checkComplexity(spec: string): CheckResult {
  const paths = extractFilePaths(spec)
  const n = paths.length
  if (n >= COMPLEXITY_HIGH_THRESHOLD) {
    return {
      id: 'complexity',
      label: 'Complexity',
      tier: 1,
      status: 'fail',
      message: `Very broad scope (${n} files). Likely too large for one agent session.`
    }
  }
  if (n >= COMPLEXITY_MED_THRESHOLD) {
    return {
      id: 'complexity',
      label: 'Complexity',
      tier: 1,
      status: 'warn',
      message: `Broad scope (${n} files). Consider splitting into smaller tasks.`
    }
  }
  return {
    id: 'complexity',
    label: 'Complexity',
    tier: 1,
    status: 'pass',
    message: n === 0 ? 'Reasonable scope' : `Reasonable scope (${n} files)`
  }
}

// React hook — wires structural checks to store on every form change

export function useReadinessChecks(): void {
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const specType = useTaskWorkbenchStore((s) => s.specType)
  const setStructuralChecks = useTaskWorkbenchStore((s) => s.setStructuralChecks)

  useEffect(() => {
    const checks = computeStructuralChecks({ title, repo, spec }, specType)
    setStructuralChecks(checks)
  }, [title, repo, spec, specType, setStructuralChecks])
}
