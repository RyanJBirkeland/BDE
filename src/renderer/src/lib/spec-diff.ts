/**
 * Builds a synthetic unified diff string suitable for `parseDiff()`.
 * Used by SpecDiffViewer and EditDiffCard to display before/after text comparisons.
 */
export function buildSyntheticDiff(filePath: string, oldStr: string, newStr: string): string {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  let diff = `diff --git a/${filePath} b/${filePath}\n`
  diff += `--- a/${filePath}\n`
  diff += `+++ b/${filePath}\n`
  diff += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`

  for (const line of oldLines) diff += `-${line}\n`
  for (const line of newLines) diff += `+${line}\n`

  return diff
}
