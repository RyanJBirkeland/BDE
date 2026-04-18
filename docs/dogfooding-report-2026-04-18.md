# Dogfood Report — 2026-04-18 — M8 live integration with rbt-coding-agent

First end-to-end dogfood of BDE's per-agent-type backend routing with the
new `rbt-coding-agent` local backend (Qwen 3.6 35B-A3B via LM Studio).

## Outcome

**3 of 3** Pipeline tasks completed through BDE → local Qwen with
correct semantic output. All artefacts below.

| Task | Wall-clock | Prompt size | Qwen commit | Outcome |
| --- | --- | --- | --- | --- |
| **01 add-docstring** | 49.5 s | 2 231 chars | `docs: add docstring to greet function` | `greet.py` now carries `"""Return a friendly greeting."""` on the line inside `def greet(name):` — exact match to spec |
| **02 fix-typo** | 31.1 s | 2 225 chars | `fix: correct add function to return a + b` | `calculator.py` returns `a + b`; `test_calculator.py` byte-identical to seed; both tests pass |
| **03 fix-subtle-bug** | 54.4 s | 2 369 chars | `fix: off-by-one error in paginate slice` | `paginate` slice corrected to `items[start:end]`; all four `test_pagination.py` tests pass; tests untouched |

Runs happened at 2026-04-18T00:11Z, 00:16Z, 00:17Z respectively. No
Claude fallback fired. No manual intervention between tasks.

## Environment

| | |
| --- | --- |
| BDE | `70370118` + `9719a487` + `f39018c1` (M8 dogfood fixes + ide boot fix) on top of `f7060a1a` |
| rbt-coding-agent | `ef8b180` (v0.2.0 — F1 model metadata) |
| Model | `openai/qwen/qwen3.6-35b-a3b` via LM Studio at `http://localhost:1234/v1` |
| Aider | 0.86.2 (Homebrew) |
| Host | Apple Silicon Mac mini, macOS 26, LM Studio |
| Settings | `agents.backendConfig.pipeline = { backend: 'local', model: 'openai/qwen/qwen3.6-35b-a3b' }`; every other agent type on `claude`. `repos.dogfood.promptProfile = 'minimal'`. |

## What was broken at first run — and how it got fixed

The first attempt (task 01, pre-fix) routed through the local backend
correctly but produced no source-file edits and still transitioned to
`review`. Four issues surfaced. All four shipped fixes in
`70370118 feat(agent-manager): M8 dogfood fixes`.

### F1 · LiteLLM didn't know Qwen's context window (rbt-coding-agent)

**Symptom:** Aider aborted with `Model openai/qwen/qwen3.6-35b-a3b has
hit a token limit! Input tokens: ~2,891 of 0 — possibly exhausted
context window!`

**Root cause:** LiteLLM (Aider's LLM adapter) has no metadata for
custom `openai/*` IDs and defaults `max_input_tokens` to `0`. Aider's
pre-spawn budget check tripped before the model ever saw the prompt.

**Fix:** `rbt-coding-agent` v0.2.0 now ships a
`DEFAULT_MODEL_METADATA` map and, on each spawn, writes a temp JSON
file and passes it to Aider via `--model-metadata-file`. Covers
Qwen 3.6/3.5 35B-A3B (262k), Qwen2.5-Coder family (32k),
DeepSeek-Coder-V2-Lite (128k), Codestral (32k), Gemma 4 (8k). Callers
can override via `SpawnOptions.modelMetadata`.

### B1 · Pipeline prompt assumed BDE's monorepo (BDE)

**Symptom:** First-run prompt was 9 231 chars — `npm run typecheck`,
`npx vitest run`, `docs/modules/` update rules, pre-push hook
guidance. All irrelevant to a Python scratch dir.

**Root cause:** `buildPipelinePrompt` injected the full BDE-specific
preamble unconditionally.

**Fix:** `RepoConfig.promptProfile?: 'bde' | 'minimal'` (default
`'bde'` — backward compatible). `buildPipelinePrompt` switches
preambles. Minimal profile is ~650 chars: style, scope, exact-names,
conventional commit. Successful runs used ~2.2 k prompts — 76 %
smaller than the BDE default.

### B2 · No-op runs were transitioning to `review` (BDE)

**Symptom:** Aider exited 0 after doing nothing. BDE
auto-committed the `.gitignore` it creates for its own scratch
files, saw commits on the branch, and moved the task to `review`.
A reviewer would see an empty-work PR.

**Root cause:** The success path only checked "are there commits
ahead of main?", not "did the agent actually change anything
semantically?"

**Fix:** New `noop-detection.ts` — if every changed file is either
`.aider*` or a `.gitignore` whose only entries are Aider patterns,
route through `resolveFailure` with notes
`"produced only scratch files"` and reason `no_commits` instead.
Empty diffs defer to `hasCommitsAheadOfMain` so the existing path
stays authoritative.

### B3 · `meta.json` lied about which backend ran (BDE)

**Symptom:** First run's `meta.json` claimed `bin: "claude"` and
`model: "claude-sonnet-4-5"` even though Aider was the actual
subprocess. Operator couldn't tell from the UI whether a Pipeline
run went through Claude or local.

**Root cause:** `agent-initialization.ts:65` hard-coded
`bin: 'claude'`; `model` was whatever the caller passed.

**Fix:** `AgentHandle` now carries `backend?` and `resolvedModel?`.
`spawnAgent` stamps them post-spawn. `initializeAgentTracking`
reads them into `agent_runs.bin` + `.model`. After the fix, the
successful run's `meta.json` correctly reads
`"bin": "rbt-coding-agent"`, `"model": "openai/qwen/qwen3.6-35b-a3b"`.

### Drive-by · Boot-time IPC spam (BDE)

Log had `[ipc] [fs:stat] unhandled error: Error: No IDE root path
set — call fs:watchDir first` on every boot.
`useIDEStateRestoration` was calling `fs.stat` to check that the
saved IDE root still existed *before* calling `fs.watchDir` — but
every `fs.stat` handler refuses until `fs.watchDir` has been called.

**Fix:** `fix(ide): order watchDir before fs.stat` (`f39018c1`).
`fs.watchDir` already validates the path exists + is a directory
and is inside `$HOME`; on failure, clear the stale state. Removes
the pre-stat entirely.

## Observations worth remembering

- **Qwen 3.6 35B-A3B handles structured-but-compact specs
  competently.** The subtle `paginate` off-by-one caught first try
  (fixed the slice to `items[start:end]`, didn't touch the loop
  indices). Commit messages were conventional-commit style without
  being prompted to do so in the minimal preamble.
- **Prompt size matters more than we assumed.** Cutting BDE's
  preamble from ~9 k → ~2.2 k had first-order effects on whether
  the model did useful work, even at Qwen's 262 k context — LiteLLM's
  hard gate was triggered by our *reported* context window, not the
  model's actual one.
- **Per-call fallback design held up under stress.** No Claude
  fallback fired during the validated runs — local was fast enough
  and correct. But the fallback path remains the right shape for
  production: one flaky LM Studio restart shouldn't knock Pipeline
  offline.
- **B2's no-op detector didn't misfire on real work.** All three
  verified runs produced legitimate source-file changes; the
  detector correctly let them through to `review`. The one
  pre-fix case it would have caught (the original token-limit
  .gitignore-only commit) exercises the scratch-file pattern.

## Known gaps we chose not to close

- **Observability of which backend ran isn't visible in BDE's UI
  yet.** `meta.json` is correct; the UI still reads `bin` as a
  literal string. A small UI pass to show `bin` + `model` next to
  a Pipeline run's history entry would close the loop.
- **Prompt profiles beyond `bde` / `minimal`.** A `node` profile
  (TypeScript hints, no BDE-specific docs/modules rule) would be
  useful for non-BDE Node repos. Deferred until a concrete
  consumer lands.
- **Token visibility on longer runs.** `session.metrics` still
  drops for ~60 % of runs against LM Studio (surfaced in the
  M7 baseline report). Not an M8 regression; noted for a future
  parser pass.
- **Automatic validation of per-task assertions.** Today the user
  hand-runs `pytest`/equivalent after each task. A lightweight
  "scenario" schema in BDE mapping a task to an assertion script
  would let the drain loop flag broken outputs without human
  review.

## Links

- M8 spec: `docs/specs/rbt-backend-integration-spec.md`
- Module index rows: `docs/modules/agent-manager/index.md`
  (backend-selector, local-adapter, noop-detection)
- rbt-coding-agent baseline (M7): `../rbt-coding-agent/docs/benchmarks/2026-04-17-qwen3.6-baseline.md`
