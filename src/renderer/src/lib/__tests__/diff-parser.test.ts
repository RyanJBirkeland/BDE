import { describe, it, expect } from 'vitest'
import { parseDiff } from '../diff-parser'

const SAMPLE_DIFF = `diff --git a/src/main.ts b/src/main.ts
index abc1234..def5678 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -10,7 +10,8 @@ import { app } from 'electron'
 const config = loadConfig()
 const server = createServer()

-server.listen(3000)
+const PORT = process.env.PORT || 3000
+server.listen(PORT)

 app.on('ready', () => {
   console.log('Ready')
diff --git a/src/utils.ts b/src/utils.ts
index 1111111..2222222 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,5 +1,4 @@
 export function greet(name: string) {
-  console.log('debug:', name)
   return \`Hello, \${name}\`
 }
 `

describe('parseDiff', () => {
  it('returns empty array for empty input', () => {
    expect(parseDiff('')).toEqual([])
    expect(parseDiff('   ')).toEqual([])
  })

  it('parses file paths correctly', () => {
    const files = parseDiff(SAMPLE_DIFF)
    expect(files).toHaveLength(2)
    expect(files[0].path).toBe('src/main.ts')
    expect(files[1].path).toBe('src/utils.ts')
  })

  it('counts additions and deletions', () => {
    const files = parseDiff(SAMPLE_DIFF)

    // main.ts: removed 1 line, added 2 lines
    expect(files[0].additions).toBe(2)
    expect(files[0].deletions).toBe(1)

    // utils.ts: removed 1 line, added 0 lines
    expect(files[1].additions).toBe(0)
    expect(files[1].deletions).toBe(1)
  })

  it('parses hunks with correct headers', () => {
    const files = parseDiff(SAMPLE_DIFF)
    expect(files[0].hunks).toHaveLength(1)
    expect(files[0].hunks[0].header).toContain('@@ -10,7 +10,8 @@')
  })

  it('categorizes lines correctly', () => {
    const files = parseDiff(SAMPLE_DIFF)
    const lines = files[0].hunks[0].lines

    const addLines = lines.filter((l) => l.type === 'add')
    const delLines = lines.filter((l) => l.type === 'del')
    const ctxLines = lines.filter((l) => l.type === 'ctx')

    expect(addLines).toHaveLength(2)
    expect(delLines).toHaveLength(1)
    expect(ctxLines.length).toBeGreaterThan(0)
  })

  it('assigns line numbers correctly', () => {
    const files = parseDiff(SAMPLE_DIFF)
    const lines = files[0].hunks[0].lines

    // First context line starts at old:10, new:10
    expect(lines[0].type).toBe('ctx')
    expect(lines[0].lineNo).toEqual({ old: 10, new: 10 })

    // Deleted line should have old line number
    const deleted = lines.find((l) => l.type === 'del')!
    expect(deleted.lineNo.old).toBeDefined()
    expect(deleted.lineNo.new).toBeUndefined()

    // Added line should have new line number
    const added = lines.find((l) => l.type === 'add')!
    expect(added.lineNo.new).toBeDefined()
    expect(added.lineNo.old).toBeUndefined()
  })

  it('strips leading +/- from content', () => {
    const files = parseDiff(SAMPLE_DIFF)
    const lines = files[0].hunks[0].lines

    const added = lines.find((l) => l.type === 'add')!
    expect(added.content).not.toMatch(/^\+/)

    const deleted = lines.find((l) => l.type === 'del')!
    expect(deleted.content).not.toMatch(/^-/)
  })
})
