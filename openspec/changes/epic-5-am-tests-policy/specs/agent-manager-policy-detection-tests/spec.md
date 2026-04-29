## ADDED Requirements

### Requirement: getDiffFileStats tolerates a line with no tab delimiter (T-13)
When `git numstat` emits a line containing no tab characters, `getDiffFileStats` SHALL construct a file-stat entry without throwing. The `additions` and `deletions` values may be `NaN` and the path may be empty; the caller (`evaluateAutoMergePolicy`) SHALL still pass the entry to `evaluateAutoReviewRules`.

#### Scenario: no-tab line does not throw and is forwarded to rule evaluation
- **GIVEN** the numstat output contains a single line with no tab delimiter
- **WHEN** `evaluateAutoMergePolicy` is called with one rule
- **THEN** `evaluateAutoReviewRules` is called once
- **THEN** no exception is thrown

### Requirement: getDiffFileStats tolerates non-numeric addition/deletion counts (T-13)
When `git numstat` emits a line whose addition or deletion field is a non-numeric string (e.g. `"abc"`), `getDiffFileStats` SHALL construct a file-stat entry with `NaN` for the affected field without throwing. The entry SHALL still be forwarded to `evaluateAutoReviewRules`.

#### Scenario: non-numeric additions field produces NaN without throwing
- **GIVEN** the numstat output is `"abc\t2\tsrc/foo.ts\n"`
- **WHEN** `evaluateAutoMergePolicy` is called with one rule
- **THEN** `evaluateAutoReviewRules` is called with one entry whose `additions` is `NaN` and `path` is `"src/foo.ts"`
- **THEN** no exception is thrown

### Requirement: getDiffFileStats preserves file paths containing spaces (T-13)
When a file path contains space characters (but no tabs), `getDiffFileStats` SHALL preserve the full path including spaces in the `path` field.

#### Scenario: path with spaces is preserved correctly
- **GIVEN** the numstat output is `"3\t1\tsrc/my component.ts\n"`
- **WHEN** `evaluateAutoMergePolicy` is called with one rule
- **THEN** `evaluateAutoReviewRules` is called with one entry whose `path` is `"src/my component.ts"`

### Requirement: isCssOnlyChange accepts uppercase .CSS and .SCSS extensions (T-14)
`isCssOnlyChange` SHALL return `true` when all paths end in `.CSS` or `.SCSS` (case-insensitive), because `STYLE_FILE_PATTERN` uses the `i` flag.

#### Scenario: uppercase .CSS returns true
- **WHEN** `isCssOnlyChange` is called with `["src/theme.CSS"]`
- **THEN** it returns `true`

#### Scenario: uppercase .SCSS returns true
- **WHEN** `isCssOnlyChange` is called with `["src/vars.SCSS"]`
- **THEN** it returns `true`

#### Scenario: mixed case .Css returns true
- **WHEN** `isCssOnlyChange` is called with `["src/theme.Css"]`
- **THEN** it returns `true`

### Requirement: isCssOnlyChange accepts double-extension .min.css paths (T-14)
`isCssOnlyChange` SHALL return `true` for paths ending in `.min.css` because the regex anchors at `$` and the final extension is `.css`.

#### Scenario: .min.css double extension returns true
- **WHEN** `isCssOnlyChange` is called with `["dist/bundle.min.css"]`
- **THEN** it returns `true`

### Requirement: isCssOnlyChange rejects TypeScript files whose stem contains "css" (T-14)
`isCssOnlyChange` SHALL return `false` for paths like `somecss.ts` — the regex requires a `.` immediately before `css` or `scss`, so a TypeScript stem containing "css" does not match.

#### Scenario: somecss.ts is not a stylesheet
- **WHEN** `isCssOnlyChange` is called with `["src/somecss.ts"]`
- **THEN** it returns `false`

### Requirement: isCssOnlyChange returns false for mixed uppercase CSS and TypeScript (T-14)
`isCssOnlyChange` SHALL return `false` when the list contains both an uppercase `.CSS` file and a `.ts` file.

#### Scenario: mixed .CSS and .ts returns false
- **WHEN** `isCssOnlyChange` is called with `["src/theme.CSS", "src/index.ts"]`
- **THEN** it returns `false`

### Requirement: listChangedFiles returns empty array for empty git diff output (T-16)
`listChangedFiles` SHALL return `[]` when `git diff --name-only` produces empty stdout.

#### Scenario: empty stdout returns empty array
- **GIVEN** the injected `execFile` resolves with `{ stdout: "", stderr: "" }`
- **WHEN** `listChangedFiles` is called
- **THEN** it returns `[]`

### Requirement: listChangedFiles returns trimmed file paths from normal output (T-16)
`listChangedFiles` SHALL split stdout on newlines, trim each line, filter empty lines, and return the resulting array.

#### Scenario: three-file diff output returns three entries
- **GIVEN** the injected `execFile` resolves with stdout `"src/a.ts\nsrc/b.ts\nsrc/c.ts\n"`
- **WHEN** `listChangedFiles` is called
- **THEN** it returns `["src/a.ts", "src/b.ts", "src/c.ts"]`

### Requirement: listChangedFiles filters blank lines from git diff output (T-16)
`listChangedFiles` SHALL discard blank and whitespace-only lines that may appear in stdout.

#### Scenario: blank lines are filtered out
- **GIVEN** stdout is `"src/a.ts\n\n  \nsrc/b.ts\n"`
- **WHEN** `listChangedFiles` is called
- **THEN** it returns `["src/a.ts", "src/b.ts"]`

### Requirement: listChangedFiles returns empty array and logs a warning when git fails (T-16)
`listChangedFiles` SHALL catch errors thrown by `execFile`, log a warning via the injected logger, and return `[]`.

#### Scenario: execFile throws returns empty array with warning logged
- **GIVEN** the injected `execFile` rejects with an `Error`
- **WHEN** `listChangedFiles` is called with an injected logger
- **THEN** it returns `[]`
- **THEN** `logger.warn` is called once

### Requirement: detectUntouchedTests returns empty array for empty changed-files list (T-16)
`detectUntouchedTests` SHALL return `[]` immediately when `changedFiles` is an empty array.

#### Scenario: empty input returns empty output
- **WHEN** `detectUntouchedTests` is called with `changedFiles: []`
- **THEN** it returns `[]`

### Requirement: detectUntouchedTests does not flag a source file when no sibling test exists on disk (T-16)
`detectUntouchedTests` SHALL not include a source file in its output when neither the sibling `.test.ts` nor `__tests__/` path exists on disk.

#### Scenario: source file with no test on disk is not flagged
- **GIVEN** `fileExists` always returns `false`
- **WHEN** `detectUntouchedTests` is called with `["src/foo.ts"]`
- **THEN** it returns `[]`

### Requirement: detectUntouchedTests does not flag a source file when its sibling test was also changed (T-16)
`detectUntouchedTests` SHALL not include a source file in its output when the sibling test file appears in `changedFiles`.

#### Scenario: source file + sibling test both changed — not flagged
- **GIVEN** `fileExists` returns `true` for `"src/foo.test.ts"`
- **WHEN** `detectUntouchedTests` is called with `["src/foo.ts", "src/foo.test.ts"]`
- **THEN** it returns `[]`

### Requirement: detectUntouchedTests flags a source file when its sibling test exists but was not changed (T-16)
`detectUntouchedTests` SHALL include a source file in its output when the sibling `.test.ts` exists on disk but does not appear in `changedFiles`.

#### Scenario: source file changed but sibling test not changed — flagged
- **GIVEN** `fileExists` returns `true` for `"src/foo.test.ts"`
- **WHEN** `detectUntouchedTests` is called with `["src/foo.ts"]` (test file absent from list)
- **THEN** it returns `["src/foo.ts"]`

### Requirement: detectUntouchedTests flags a source file when the __tests__ sibling exists but was not changed (T-16)
`detectUntouchedTests` SHALL consider the `__tests__/foo.test.ts` path as well as the sibling path. If either exists on disk and is absent from `changedFiles`, the source file is flagged.

#### Scenario: __tests__ sibling present and not changed — flagged
- **GIVEN** `fileExists` returns `true` for `"src/__tests__/foo.test.ts"` and `false` for `"src/foo.test.ts"`
- **WHEN** `detectUntouchedTests` is called with `["src/foo.ts"]`
- **THEN** it returns `["src/foo.ts"]`

### Requirement: detectUntouchedTests does not flag test files as untouched sources (T-16)
`detectUntouchedTests` SHALL skip any `changedFiles` entry whose path contains `.test.` or `.spec.`, as these are test files, not source files.

#### Scenario: test file in changedFiles is not treated as source
- **GIVEN** `fileExists` always returns `true`
- **WHEN** `detectUntouchedTests` is called with `["src/foo.test.ts"]`
- **THEN** it returns `[]`

### Requirement: detectUntouchedTests does not flag non-source-extension files (T-16)
`detectUntouchedTests` SHALL skip files whose extension is not in `SOURCE_EXTENSIONS` (`.ts`, `.tsx`, `.js`, `.jsx`).

#### Scenario: .css file is not flagged as a source
- **GIVEN** `fileExists` always returns `true`
- **WHEN** `detectUntouchedTests` is called with `["src/theme.css"]`
- **THEN** it returns `[]`

### Requirement: classifyFailureReason returns 'environmental' when message matches both environmental and auth keywords (T-34)
`classifyFailureReason` uses `Array.find()` — first pattern wins. `environmental` is registered before `auth`, so a message containing both `'credential unavailable'` and `'invalid token'` SHALL return `'environmental'`.

#### Scenario: environmental beats auth on shared-keyword message
- **WHEN** `classifyFailureReason` is called with `"credential unavailable: invalid token"`
- **THEN** it returns `'environmental'`

### Requirement: classifyFailureReason returns 'environmental' when message matches both environmental and timeout keywords (T-34)
`environmental` is registered before `timeout`. A message containing both `'refusing to proceed'` and `'timeout'` SHALL return `'environmental'`.

#### Scenario: environmental beats timeout on shared-keyword message
- **WHEN** `classifyFailureReason` is called with `"refusing to proceed due to timeout"`
- **THEN** it returns `'environmental'`

### Requirement: classifyFailureReason matches 'incomplete_files' pattern keywords (T-34)
The `incomplete_files` pattern with keywords `['missing:', 'incomplete files', 'files to change checklist']` SHALL be matched for messages containing those keywords.

#### Scenario: 'files to change checklist' matches incomplete_files
- **WHEN** `classifyFailureReason` is called with `"files to change checklist not satisfied"`
- **THEN** it returns `'incomplete_files'`

#### Scenario: 'missing:' matches incomplete_files
- **WHEN** `classifyFailureReason` is called with `"missing: src/foo.ts"`
- **THEN** it returns `'incomplete_files'`

### Requirement: custom patterns registered after builtins lose to builtins on shared keywords (T-34)
Because `registerFailurePattern` appends to the registry and `classifyFailureReason` uses `Array.find()`, a custom pattern that shares a keyword with a built-in SHALL be shadowed by the built-in when the built-in appears earlier in the registry.

#### Scenario: custom pattern with 'timeout' keyword loses to built-in timeout pattern
- **GIVEN** a custom pattern `{ type: 'custom_timeout', keywords: ['timeout'] }` is registered after all builtins
- **WHEN** `classifyFailureReason` is called with `"timeout occurred"`
- **THEN** it returns `'timeout'` (not `'custom_timeout'`)
