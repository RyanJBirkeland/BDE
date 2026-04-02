import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseDiff, parseDiffChunked, countDiffLines } from '../diff-parser'

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

  it('handles a deleted file (path shows (deleted))', () => {
    const diff = `diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-line1
-line2
-line3
`
    const files = parseDiff(diff)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('(deleted)')
    expect(files[0].deletions).toBe(3)
    expect(files[0].additions).toBe(0)
  })

  it('skips parts with no +++ line (e.g. binary files)', () => {
    const diff = `diff --git a/image.png b/image.png
index abc..def 100644
Binary files a/image.png and b/image.png differ
diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,2 +1,2 @@
-old
+new
`
    const files = parseDiff(diff)
    // Only the second file (with +++ line) should appear
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('src/main.ts')
  })

  it('handles no-newline-at-EOF markers', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,2 @@
-old line
\\ No newline at end of file
+new line
\\ No newline at end of file
`
    const files = parseDiff(diff)
    expect(files).toHaveLength(1)
    // The \\ lines are ignored (not +, -, or space)
    expect(files[0].additions).toBe(1)
    expect(files[0].deletions).toBe(1)
  })

  it('handles rename-only diffs (no hunks)', () => {
    const diff = `diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
--- a/old-name.ts
+++ b/new-name.ts
`
    const files = parseDiff(diff)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('new-name.ts')
    expect(files[0].hunks).toHaveLength(0)
    expect(files[0].additions).toBe(0)
    expect(files[0].deletions).toBe(0)
  })

  it('handles multiple hunks in a single file', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 ctx1
-old1
+new1
 ctx2
@@ -20,3 +20,3 @@
 ctx3
-old2
+new2
 ctx4
`
    const files = parseDiff(diff)
    expect(files).toHaveLength(1)
    expect(files[0].hunks).toHaveLength(2)
    expect(files[0].additions).toBe(2)
    expect(files[0].deletions).toBe(2)
    // Second hunk starts at line 20
    expect(files[0].hunks[1].lines[0].lineNo).toEqual({ old: 20, new: 20 })
  })

  it('handles @@ header with optional trailing function name', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -5,3 +5,3 @@ function myFunc() {
 ctx
-old
+new
`
    const files = parseDiff(diff)
    expect(files[0].hunks[0].header).toContain('function myFunc()')
  })
})

describe('countDiffLines', () => {
  it('returns 0 for empty files array', () => {
    expect(countDiffLines([])).toBe(0)
  })

  it('returns 0 for files with no hunks', () => {
    const files = parseDiff(`diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
`)
    expect(countDiffLines(files)).toBe(0)
  })

  it('counts all lines across all files and hunks', () => {
    const files = parseDiff(SAMPLE_DIFF)
    // main.ts hunk: 2 ctx + 1 del + 2 add + 2 ctx = 7 lines
    // utils.ts hunk: 1 ctx + 1 del + 1 ctx + 1 ctx = 4 lines  (let's just count)
    const total = countDiffLines(files)
    expect(total).toBeGreaterThan(0)
    // Manually verify: sum of all hunk line counts
    const expected = files.reduce(
      (sum, f) => sum + f.hunks.reduce((s, h) => s + h.lines.length, 0),
      0
    )
    expect(total).toBe(expected)
  })

  it('counts lines from multiple files', () => {
    const files = parseDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,3 +1,3 @@
 ctx
-old
+new
`)
    expect(countDiffLines(files)).toBe(5) // 2 + 3
  })
})

describe('parseDiffChunked', () => {
  beforeEach(() => {
    // jsdom doesn't implement requestAnimationFrame by default; provide a simple impl
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves with empty array and calls onProgress([]) for empty input', async () => {
    const onProgress = vi.fn()
    const result = await parseDiffChunked('', onProgress)
    expect(result).toEqual([])
    expect(onProgress).toHaveBeenCalledWith([])
  })

  it('resolves with empty array for whitespace-only input', async () => {
    const onProgress = vi.fn()
    const result = await parseDiffChunked('   \n  ', onProgress)
    expect(result).toEqual([])
    expect(onProgress).toHaveBeenCalledWith([])
  })

  it('parses a single-file diff and calls onProgress', async () => {
    const onProgress = vi.fn()
    const diff = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,2 +1,2 @@
-old
+new
`
    const result = await parseDiffChunked(diff, onProgress)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('src/main.ts')
    expect(onProgress).toHaveBeenCalled()
    // Last progress call should have the full result
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0]
    expect(lastCall).toHaveLength(1)
  })

  it('parses a multi-file diff correctly', async () => {
    const onProgress = vi.fn()
    const result = await parseDiffChunked(SAMPLE_DIFF, onProgress)
    expect(result).toHaveLength(2)
    expect(result[0].path).toBe('src/main.ts')
    expect(result[1].path).toBe('src/utils.ts')
  })

  it('skips parts with no +++ line (binary files)', async () => {
    const onProgress = vi.fn()
    const diff = `diff --git a/image.png b/image.png
Binary files differ
diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,1 +1,1 @@
-old
+new
`
    const result = await parseDiffChunked(diff, onProgress)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('src/main.ts')
  })

  it('aborts parsing when signal is aborted before processing starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const onProgress = vi.fn()

    await expect(
      parseDiffChunked(SAMPLE_DIFF, onProgress, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('aborts parsing mid-way when signal is aborted after first batch', async () => {
    // Build a diff with more than 10 files to trigger batching
    const buildDiff = (n: number) => {
      let diff = ''
      for (let i = 0; i < n; i++) {
        diff += `diff --git a/file${i}.ts b/file${i}.ts
--- a/file${i}.ts
+++ b/file${i}.ts
@@ -1,1 +1,1 @@
-old
+new
`
      }
      return diff
    }

    const controller = new AbortController()
    const onProgress = vi.fn()

    // Abort after first progress callback
    onProgress.mockImplementationOnce(() => {
      controller.abort()
    })

    const diff = buildDiff(25)
    await expect(parseDiffChunked(diff, onProgress, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    // onProgress was called once before abort
    expect(onProgress).toHaveBeenCalledTimes(1)
  })

  it('processes large diffs (>10 files) in batches and calls onProgress multiple times', async () => {
    const buildDiff = (n: number) => {
      let diff = ''
      for (let i = 0; i < n; i++) {
        diff += `diff --git a/file${i}.ts b/file${i}.ts
--- a/file${i}.ts
+++ b/file${i}.ts
@@ -1,1 +1,1 @@
-old
+new
`
      }
      return diff
    }

    const onProgress = vi.fn()
    const result = await parseDiffChunked(buildDiff(25), onProgress)
    expect(result).toHaveLength(25)
    // Should have been called multiple times (3 batches: 10 + 10 + 5)
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2)
    // Each progress call should have a snapshot (array) not a reference issue
    const firstCallCount = onProgress.mock.calls[0][0].length
    expect(firstCallCount).toBe(10)
  })

  it('resolves with deleted file paths', async () => {
    const onProgress = vi.fn()
    const diff = `diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-line
`
    const result = await parseDiffChunked(diff, onProgress)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('(deleted)')
  })
})
