# Marketing — Team Bravo — BDE Audit 2026-04-07

## Summary

BDE has a strong core positioning ("a steering system for Claude Code at scale") and some genuinely cinematic moments — the Dev Playground, Ship It, /checkpoint, multi-turn agent steering — but the story is leaking badly. The README is materially out of date (wrong clone URL, wrong module counts, still sells "cost charts" after the app moved to tokens, omits a whole view). Terminology drifts across front door / README / in-app labels ("Sprint" vs "Task Pipeline", "cost" vs "tokens", "9 vs 10" settings tabs). Several marquee features are completely unmentioned in the README (Ship It, Promote to Code Review, slash-command steering, freshness/rebase detection, multi-turn adhoc sessions with resume). Only 3 screenshots exist for a 9-view app. Repo root has stray dev artifacts. Fix these before launch and the story tightens dramatically.

## Findings

### [CRITICAL] README clone URL is wrong — first-run install will 404

- **Category:** Copy
- **Location:** `README.md:297` vs `src/renderer/src/components/settings/AboutSection.tsx:9`
- **Observation:** README says `git clone https://github.com/rbtechbot/bde.git` but AboutSection links to `https://github.com/RyanJBirkeland/BDE`. Anyone following the README install steps will fail at step 1.
- **Why it matters:** First impression killer. The most common action a visitor takes (copy/paste the clone command) is broken.
- **Recommendation:** Pick the canonical GitHub org/repo now and search-replace everywhere (README, About, docs, CLAUDE.md). Capitalization matters on some hosts.

### [CRITICAL] README sells "cost charts" but Dashboard now shows tokens

- **Category:** Copy
- **Location:** `README.md:15,32,43,55,56,190-191,194` vs `src/renderer/src/components/dashboard/ActivitySection.tsx:93-102`
- **Observation:** README has "cost tracking", "Cost charts show spend trends", a whole "Cost Tracking — Know What Your Agents Cost" feature section, and "cost-per-run trends" under Dashboard. Actual Dashboard cards are "Tokens / Run" and "Tokens 24h" (see recent commit `feat: switch usage metrics from cost (USD) to tokens (#641)`). The screenshot alt-text still says "cost tracking".
- **Why it matters:** Anyone landing on the repo expects a cost dashboard and gets tokens. Worse, the AgentConsole header _still_ shows `$0.0001` USD (`ConsoleHeader.tsx:154`), so we now advertise cost, deliver tokens, and still flash USD in the agent view. Units chaos.
- **Recommendation:** Rewrite the cost section around tokens (the honest story: "real-time token usage, with per-run and 24h rollups"). Regenerate dashboard-dark.png screenshot so the Tokens cards are visible. Pick one unit for the agent header (tokens to match Dashboard, not USD).

### [CRITICAL] README module/IPC counts and view count are wrong

- **Category:** Copy
- **Location:** `README.md:215,221,403`
- **Observation:** README claims "86 typed channels", "17 IPC handler modules", "8 Views". Actuals per `CLAUDE.md`: ~138 typed channels, 23 handler modules (24 dir entries minus `__tests__`), 9 views. The Task Planner view is missing from the README's "Views at a Glance" table entirely (`README.md:324-336`).
- **Why it matters:** These are bragging numbers — getting them wrong under-sells the product _and_ makes the README look unmaintained. Missing a whole view from the table is a direct trust hit.
- **Recommendation:** Pull counts from code, not memory. Either delete the numbers or add a tiny script to refresh them. Add Task Planner (⌘8) to the views table. Task Workbench shortcut is ⌘0 — the table has "—".

### [CRITICAL] Ship It is a marquee feature and it's nowhere in the README

- **Category:** Hidden Feature
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:53-81`
- **Observation:** "Ship It" is a one-click merge+push+done button in Code Review. It even has a rocket icon. The README's Code Review section only mentions "merge locally, create a PR, request a revision, or discard".
- **Why it matters:** "Ship It" is the single most demo-able verb in the entire app. It's the payoff shot — you go from spec to shipped in one click at the end of the story. Burying it is a crime.
- **Recommendation:** Promote Ship It to its own subsection in the README Features. Screenshot the rocket button. Use "Ship It" as the CTA in the demo video.

### [MAJOR] Terminology drift: Sprint Pipeline vs Task Pipeline

- **Category:** Naming
- **Location:** `src/renderer/src/lib/view-registry.ts:50` vs `README.md` (every mention) vs `src/renderer/src/components/onboarding/steps/WelcomeStep.tsx:32` vs `docs/BDE_FEATURES.md`
- **Observation:** In-app nav label is **"Task Pipeline"**. README says **"Sprint Pipeline"** throughout. Onboarding welcome step says **"Sprint Pipeline"**. BDE_FEATURES.md uses **"Sprint Pipeline"** as the header. Internal types still use `sprint_tasks`, `SprintView`, `SprintPipeline.tsx`. A new user is promised "Sprint Pipeline" in the docs and onboarding, then goes looking for it in the menu and finds "Task Pipeline".
- **Why it matters:** Small word but high-traffic — it's in the top-level nav. Visitors will wonder if they're looking at the wrong app. Also "Sprint" implies 2-week cadence / Agile ceremony, which isn't actually what BDE is — "Task Pipeline" is the better name.
- **Recommendation:** Pick "Task Pipeline" and propagate outward: README, onboarding, BDE_FEATURES.md. Keep internal filenames if a rename is expensive but align all user-facing copy. (The `sprint:` IPC channel namespace can stay internal.)

### [MAJOR] BDE name is never expanded in the README

- **Category:** Story Hole
- **Location:** `README.md:3`
- **Observation:** Title is just "# BDE". First sentence: "A steering system for Claude Code at scale." The phrase "Birkeland Development Environment" does not appear anywhere in the README. It only shows up in `WelcomeStep.tsx`, `ConnectionsSection.tsx`, and `prompt-composer.ts`.
- **Why it matters:** Visitors arrive and don't know what the acronym means. "Birkeland" also happens to be a proper noun (the author's surname), which is an origin story worth telling — and also a naming risk worth surfacing, because "BDE" is an unfortunately popular acronym online.
- **Recommendation:** Add a one-liner under the title: _"BDE — Birkeland Development Environment"_. Optionally add a tiny "Why the name?" paragraph.

### [MAJOR] Dashboard Status Counters story is confused — two "awaiting review" tiles

- **Category:** Copy
- **Location:** `src/renderer/src/components/dashboard/StatusCounters.tsx:67-80`
- **Observation:** There's a **Review** counter (blue, Eye icon, clicks → `awaiting-review`) and a **PRs** counter (blue, GitPullRequest icon, clicks → `awaiting-review`). Same color, same destination, near-identical meaning. Plus there's also a separate **Failed** and then **Done today** split from **Done**. Total of 8 tiles in one column, several visually identical.
- **Why it matters:** The Dashboard is the README hero shot. On a screenshot it looks like there are two identical blue cards — viewers will assume it's broken or redundant. README hero copy says "Active/Queued/Blocked/PRs/Done" (5) but the UI has 8. Visitors comparing the screenshot to the copy will be confused.
- **Recommendation:** Either (a) merge Review+PRs into one tile ("Awaiting Review") with a split count, or (b) route them to different filters (e.g., Review = `review`-status tasks, PRs = tasks with `pr_status=open`). Update README to match the final set. Reconsider whether "Done today" deserves a full tile vs. a small footer on Done.

### [MAJOR] Hidden feature — /checkpoint, /scope, /focus, /test, /stop, /retry, /status steering commands

- **Category:** Hidden Feature
- **Location:** `src/renderer/src/components/agents/commands.ts:10-22`, `src/renderer/src/views/AgentsView.tsx:167-255`
- **Observation:** Seven slash commands for steering a running agent exist, including `/checkpoint` (commit worktree state mid-run without stopping) and `/scope` (narrow the agent to specific files). None are mentioned in README or BDE_FEATURES.md.
- **Why it matters:** "Mid-run steering" is a huge differentiator over just running Claude Code in a terminal. `/checkpoint` in particular is a narrative-worthy feature ("save progress without stopping the agent"). This is worth a whole section.
- **Recommendation:** Add a "Steer Running Agents" feature subsection with the command table. Demo `/checkpoint` in the launch video — it's visually satisfying (a commit appears in the chat stream while the agent keeps coding).

### [MAJOR] Hidden feature — Promote to Code Review (scratchpad → pipeline bridge)

- **Category:** Hidden Feature
- **Location:** `src/renderer/src/components/agents/ConsoleHeader.tsx:90-114`, `src/renderer/src/views/AgentsView.tsx:328-346`
- **Observation:** Adhoc agents have a "Promote to Code Review" button that takes scratchpad work and flows it into the formal review queue. This is the bridge between exploratory "just try something" mode and tracked work. Not in README.
- **Why it matters:** Answers the obvious objection "what if I don't know exactly what I want before I queue?". The story: _start in scratchpad, promote the good ones, track the rest_. Closes a huge UX gap vs. raw Claude Code.
- **Recommendation:** Add a "Scratchpad → Pipeline" paragraph under Agent Manager or Code Review. Mention it in the onboarding Welcome step.

### [MAJOR] Hidden feature — branch freshness / rebase in Code Review

- **Category:** Hidden Feature
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:29-41,182-199`
- **Observation:** Code Review checks if an agent's branch is stale vs main (`fresh | stale | conflict | unknown`), exposes a **Rebase** button, and tracks `rebased_at`. README says nothing about this.
- **Why it matters:** The top-of-funnel worry with autonomous agents is "what if main moved while the agent was coding?". BDE answers it. Silence here = visitors assume the problem isn't solved.
- **Recommendation:** Add "Staleness detection + one-click rebase" bullet under Code Review Station. Add a screenshot of the freshness badge.

### [MAJOR] Dev Playground marquee is under-sold in README

- **Category:** Demo Story
- **Location:** `README.md:181-182` vs `docs/BDE_FEATURES.md` Dev Playground section
- **Observation:** README gives Dev Playground three lines and no screenshot. BDE_FEATURES.md has a whole loving treatment with security details, view modes, use cases. The README version doesn't mention the split/preview/source view toggle, the "Open in Browser" fallback, the 5MB limit, or — crucially — the fact that agents will render charts, theme builders, architecture diagrams, and UI mockups live in the app.
- **Why it matters:** This is _the_ most visually demo-able feature. "Agent writes HTML → it renders inline, sandboxed, with JS" is a jaw-drop moment. Giving it 2 sentences and no image is malpractice.
- **Recommendation:** Expand to a full section with a screenshot (or better, an animated GIF) of an agent writing a theme builder playground and watching it appear. Steal copy from BDE_FEATURES.md.

### [MAJOR] Only 3 screenshots for a 9-view app

- **Category:** Visual Polish
- **Location:** `docs/screenshots/` (dashboard-dark.png, dashboard-light.png, agents-view.png)
- **Observation:** README references 3 images. Code Review Station, Task Pipeline, Task Workbench, IDE, Source Control, Dev Playground, Settings, Task Planner — no screenshots.
- **Why it matters:** On GitHub, visitors scroll for images. A text-wall README with one image at the top and charts in the middle does not convey a finished product. Compare to any well-marketed dev tool — each major feature gets a shot.
- **Recommendation:** Minimum six more: Task Pipeline in flight, Code Review diff view, Dev Playground rendering something fun, Task Workbench with copilot, IDE with Monaco + terminal, Agents fleet with concurrent sessions. Consider one animated GIF for the playground.

### [MAJOR] Onboarding tagline is generic — doesn't match README's sharp positioning

- **Category:** Copy
- **Location:** `src/renderer/src/components/onboarding/steps/WelcomeStep.tsx:21-24`
- **Observation:** In-app first-run says _"The Birkeland Development Environment is your autonomous AI-powered development assistant. Let's get you set up in just a few steps."_ The README says _"A steering system for Claude Code at scale."_ The README line is specific, honest, and memorable. The onboarding line is 2024 AI-tool boilerplate.
- **Why it matters:** First-run is the highest-attention moment in a user's life with the product. Wasting it on generic copy kills the narrative before it starts.
- **Recommendation:** Port the README hero copy into the Welcome step. Same sentence, same promise.

### [MINOR] Settings says "9 tabs" everywhere but there are 10 (plus About)

- **Category:** Copy
- **Location:** `src/renderer/src/views/SettingsView.tsx:35-46` vs `CLAUDE.md`, `docs/BDE_FEATURES.md`, `README.md:334`
- **Observation:** SECTIONS array has 10 entries: Connections, Permissions, Repositories, Templates, Agent Manager, Cost & Usage, Appearance, Notifications, Keybindings, Memory. Plus About is in SECTION_MAP but not SECTIONS (accessible via some other path). README says "9 config tabs", BDE_FEATURES.md says "9 tabs", CLAUDE.md says "9 configuration tabs".
- **Why it matters:** Small, but exactly the kind of detail a skeptical reader notices and uses to judge maintenance quality.
- **Recommendation:** Update copy to "10 tabs" (or simply "configuration across Account, Projects, Pipeline, and App"). Decide whether About belongs in the sidebar.

### [MINOR] Naming inconsistency: `dashboard-completion-cost`, `dashboard-cost-value` CSS classes render tokens

- **Category:** Naming
- **Location:** `src/renderer/src/components/dashboard/ActivitySection.tsx:78,101`
- **Observation:** CSS classes are `.dashboard-completion-cost` and `.dashboard-cost-value` but the values rendered via `formatTokens(...)` are token counts, not dollars. This is leftover from the cost→tokens rename.
- **Why it matters:** Any contributor grepping for "cost" will be misled. Minor but shows recency of the migration — a reviewer thinking about adopting BDE will infer it.
- **Recommendation:** Rename to `.dashboard-completion-tokens` / `.dashboard-tokens-value` as cleanup. Low risk.

### [MINOR] AgentConsole estimated cost formula is fake and visible

- **Category:** Copy
- **Location:** `src/renderer/src/components/agents/ConsoleHeader.tsx:28-31,155-162`
- **Observation:** `estimateCost(events, model)` returns `events.length * 0.003` for Opus or `0.001` for everything else. This is shown in the console header in orange italics with "~$" prefix. It has no relationship to actual token usage.
- **Why it matters:** Anyone who runs a long agent will see a number that's wildly off from their actual bill. In a demo that's embarrassing. Also undermines the "real cost tracking" story.
- **Recommendation:** Either delete the estimated-cost display and show "— pending" until the real `costUsd` arrives, or at minimum rename it to "estimated" and use a token-based heuristic that's not per-event-count. Better: stream real usage from the SDK.

### [MINOR] IDE empty state is bare — big missed moment

- **Category:** Empty State
- **Location:** `src/renderer/src/components/ide/IDEEmptyState.tsx:27-53`
- **Observation:** Empty state shows a code icon, "BDE IDE", "Open a folder to start editing", one button, and recent folders. No mention of what BDE's IDE is _for_ (it's explicitly a companion, not a VS Code replacement — per README). No link to open the project you're currently working on in Task Pipeline. No keyboard shortcut hint.
- **Why it matters:** First time a user clicks ⌘3 they land on this blank screen and think "oh, just an editor". Missed opportunity to frame it as "inspect what agents just built".
- **Recommendation:** Add a one-line positioning subtitle ("Inspect agent output or make quick edits — not a full VS Code replacement"). Add a "Recent agent worktrees" section. Show the ⌘O and ⌘P shortcuts as hints.

### [MINOR] Agents view "Scratchpad" notice is critical context buried in small text

- **Category:** Copy
- **Location:** `src/renderer/src/views/AgentsView.tsx:328-346`
- **Observation:** A 10px grey note explains that agents spawned in this view aren't tracked in the pipeline and must be promoted. This is actually really important info — it's the mental model split between "experiments" and "tracked work" — but it's styled like a footnote.
- **Why it matters:** New users will spawn an agent in the Agents view expecting it to show up in Task Pipeline, be confused, and conclude the app is broken.
- **Recommendation:** Elevate to a callout. Use the same visual treatment as `EmptyState`. The existing copy is good — it just needs air.

### [MINOR] Repo root is cluttered with stray dev artifacts

- **Category:** Visual Polish
- **Location:** `/Users/ryan/projects/BDE/` (`AGENT_REPORT.md`, `AUDIT_FIXES_SUMMARY.md`, `dashboard-ux-playground.html`, `sprint-planning-playground.html`, `task-groups-playground.html`, `task-planner-playground.html`)
- **Observation:** Six stray files at repo root, including playground HTMLs that were likely generated by agents and never cleaned up.
- **Why it matters:** First impression when cloning. Playground HTMLs at root look like scratch/debug files and hurt the "clean code" pitch in README:207.
- **Recommendation:** Delete or move to `docs/research/` or `scratch/`. Add a root-level `.gitignore` entry for `*-playground.html` to prevent recurrence.

### [MINOR] Agent Launchpad placeholder is low-energy

- **Category:** Copy
- **Location:** `src/renderer/src/components/agents/LaunchpadGrid.tsx:159`
- **Observation:** Prompt textarea placeholder: `"What would you like to work on?"`. Generic AI-chat boilerplate.
- **Why it matters:** This is the first input a user touches in the agent view. A sharper placeholder sets the tone and hints at capabilities.
- **Recommendation:** Try something like `"Describe the change. Be specific about files, tests, and success criteria."` or rotate example prompts like `"e.g. add a keyboard shortcut to toggle the sidebar"`.

### [MINOR] Agent system guide contradicts README on pipeline agent completion

- **Category:** Copy
- **Location:** `docs/agent-system-guide.md:50` vs `README.md:71-72,134-136`
- **Observation:** agent-system-guide.md says pipeline agents "commit changes, push branches, and open PRs". README (correct, current behavior) says agents stop at `review` status with the worktree preserved — no auto-push, no auto-PR.
- **Why it matters:** Two docs disagreeing on the fundamental behavior of the headline feature. A careful reader will notice.
- **Recommendation:** Update agent-system-guide.md to match the human-review-gate story. Search the rest of `docs/` for the same stale claim.

### [MINOR] README "Session Types" table flattens adhoc and assistant

- **Category:** Copy
- **Location:** `README.md:343-351` vs `docs/BDE_FEATURES.md` Agent Types table
- **Observation:** README shows 5 types but the adhoc vs assistant distinction reads as "User-spawned one-off" vs "Conversational help and recommendations" — which is vague. BDE_FEATURES.md is clearer that assistant adds _playground-always-enabled_ and a proactive personality.
- **Why it matters:** Story hole — readers won't know when to use which. Also undermines the "5 distinct types" flex if two of them blur together.
- **Recommendation:** Either collapse adhoc+assistant into one row with a "mode" column, or sharpen the copy to make the split obvious (e.g., assistant = "ask questions, get recommendations"; adhoc = "one-shot tasks, no back-and-forth").
