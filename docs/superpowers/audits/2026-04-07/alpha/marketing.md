# Marketing — Team Alpha — BDE Audit 2026-04-07

## Summary

The core task flow has a strong narrative — "spec → queue → agents work in worktrees → human ships it" is genuinely compelling, and the Code Review Station "Ship It" button is the single best demo moment in the product. But the story gets blurry at the seams: the app is self-inconsistent about whether users are using a "Sprint Pipeline" or a "Task Pipeline," the Task Workbench and Task Planner blur into each other for first-time users, and a handful of screenshot-worthy features (Dev Playground, Research Codebase, Cross-Repo Contract, Freshness/Rebase) are buried behind toggles or live in the UI with zero first-run hints. The README still leans on the old "Sprint Pipeline" wording while the in-app header reads "Task Pipeline," and the onboarding DoneStep promises "Sprint Pipeline (Cmd+4)" while every other surface now says "Task Pipeline." These are cheap to fix and would pay off immediately on camera.

## Findings

### [CRITICAL] The app can't decide whether it's a "Sprint Pipeline" or a "Task Pipeline"

- **Category:** Naming
- **Location:** `src/renderer/src/lib/view-registry.ts:50` (label: 'Task Pipeline'), `src/renderer/src/components/sprint/PipelineHeader.tsx:66` (`<h1>Task Pipeline</h1>`), `src/renderer/src/components/onboarding/steps/DoneStep.tsx:54` (`<strong>Sprint Pipeline</strong>`), `README.md:43,156` ("Sprint Pipeline"), `docs/BDE_FEATURES.md:10,29,50,85,116,165` (all "Sprint Pipeline"), `src/renderer/src/assets/sprint-pipeline-neon.css:2`, internal store/folder naming (`SprintPipeline.tsx`, `useSprintUI`, `sprint-pipeline-neon.css`, `sprint:` IPC namespace).
- **Observation:** The view is labeled "Task Pipeline" in the sidebar, the header, and the view registry. Yet the onboarding "You're Ready!" card promotes it as "Sprint Pipeline," the README's hero "Why BDE?" section and the features list both say "Sprint Pipeline," and `docs/BDE_FEATURES.md` — which is auto-loaded into every agent's context — refers to "Sprint Pipeline" nine times. There is no sprint system in this product. There are no sprints, no sprint durations, no sprint reviews. The word is a legacy artifact from a prior design.
- **Why it matters:** This is the most visible feature of the product. A new user reads the README ("Sprint Pipeline — Watch Work Flow") then opens the app and sees "Task Pipeline" at the top — and they quietly wonder what changed, what they're missing, whether this is the same thing. On a 2-minute demo video this becomes a stumble: the narrator says one name and the screen says another. Worse, because agents load `BDE_FEATURES.md` into their context, every autonomous agent is being told the feature is called "Sprint Pipeline" — so when agents write PRs, tests, or comments, they reinforce the wrong name.
- **Recommendation:** Pick one name and sweep. "Task Pipeline" is already winning in the live UI and is the more honest description (there are no sprints). Update README.md, `docs/BDE_FEATURES.md`, `DoneStep.tsx`, and the `sprint-pipeline-neon.css` header comment. Internal store/file names (`sprintUI`, `sprint-pipeline-neon.css`, `SprintPipeline.tsx`) can stay for refactor cost reasons — that's invisible to users — but every user-facing string should say "Task Pipeline."

### [CRITICAL] The "PR Station" ghost still lives in agent memory and docs

- **Category:** Naming
- **Location:** `src/main/agent-system/skills/pr-review.ts:6,35-36` ("description: 'Review PRs, check CI, resolve conflicts using gh CLI and PR Station'", "## BDE PR Station", "PR Station view (Cmd+5) provides inline code review..."), plus `docs/superpowers/specs/2026-03-27-codebase-audit-sprint-plan.md`, `docs/superpowers/specs/tech-debt-ui-polish.md`.
- **Observation:** The Code Review Station replaced PR Station, but a live skill file still tells agents to use "PR Station." It describes a UI that no longer exists: "PR Station view (Cmd+5) provides inline code review with CI badges, diff comments, batch review submission, and merge controls." ⌘5 now opens Code Review.
- **Why it matters:** This is shipped product — skills load into the agent system at runtime when `useNativeSystem` is on. Agents will point users to a nonexistent "PR Station." On a demo, if someone asks an assistant agent "how do I review code?" the agent will confidently name the wrong view.
- **Recommendation:** Rename the skill and its body to reference Code Review Station. Delete or rewrite stale spec docs under `docs/superpowers/specs/` that still reference PR Station as a current feature (the 2026-03-27 audit sprint plan in particular).

### [MAJOR] "Ship It" button is the single best demo moment and nobody knows it exists

- **Category:** Hidden Feature
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:259-270`
- **Observation:** The Code Review Station has a rocket-icon button labeled "Ship It" that merges locally + pushes to origin + marks the task done in one click. It's prominently positioned as the primary action — but it's not mentioned in the README feature list, not in `docs/BDE_FEATURES.md`, not in the onboarding DoneStep, and not in the release-merge Mermaid diagram. The README's Code Review section says: "merge locally, create a PR, request a revision, or discard" — four options. It omits the actual fifth (and best) option: "Ship It."
- **Why it matters:** This is the product's climax moment. "You wrote a spec 20 minutes ago, Claude built it in an isolated worktree, now click this rocket and it's in origin/main." That's the entire marketing story in one gesture. Leaving it out of the README and onboarding is the single biggest missed narrative beat in the app. Also the word "Ship It" is memorable branding — it should be on the landing page.
- **Recommendation:** Add "Ship It" to the README feature list and the onboarding DoneStep. Consider a screenshot or GIF specifically of a user clicking it. Add it to the Mermaid flowchart in the README ("Ship It" as a distinct path from "Merge Locally" and "Create PR"). This is free marketing.

### [MAJOR] Task Workbench vs. Task Planner is confusing on first encounter

- **Category:** Demo Story
- **Location:** `src/renderer/src/lib/view-registry.ts:77-90` (Task Workbench ⌘0, Task Planner ⌘8), `src/renderer/src/views/PlannerView.tsx`, `src/renderer/src/components/task-workbench/TaskWorkbench.tsx`
- **Observation:** The sidebar has "Task Workbench" (⌘0) and "Task Planner" (⌘8). Their descriptions are "Draft task specs with AI copilot assistance" vs. "Plan and structure multi-task workflows." A new user cannot tell the difference from those two sentences. In practice, Workbench = single-task spec editor, Planner = epic/group container that contains multiple tasks. But the word "Planner" sounds like the place where planning happens, not where it's grouped. And the Planner view internally uses "Epic" as the noun (`EpicList`, `EpicDetail`, "New Epic" button, "Send to Pipeline") while the sidebar says "Task Planner" and the header is "Task Planner" — so the user enters "Task Planner" and is greeted with "Epics." That's a rug pull.
- **Why it matters:** In a demo, the presenter has to stop and explain: "OK so this is the Planner which uses Epics which contain Tasks which you also create in the Workbench which..." It's three nouns for two concepts. The first-time user guesses wrong about which view to open and bounces.
- **Recommendation:** Either rename the sidebar entry to "Epics" (matching the content the user sees) with description "Group related tasks into epics," or rename "Epic" inside the Planner to "Plan"/"Workflow" to match the sidebar. Also add a one-line hint under the Task Workbench description like "For single tasks" and under Task Planner "For multi-task epics" so the choice is obvious. Consider demoting one of them — do both need top-level sidebar slots?

### [MAJOR] Dev Playground is hidden behind an "Advanced" disclosure with no explanation

- **Category:** Hidden Feature
- **Location:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx:418-489` — "Advanced (priority, dependencies, cost, model, playground)" collapsed by default; checkbox labeled "Dev Playground" with a `title` tooltip only.
- **Observation:** Dev Playground is one of the coolest features in the product — inline HTML rendering so agents can build visual prototypes that appear in-app. The README gives it a dedicated feature section. But in the actual Task Workbench, it's buried inside a collapsed "Advanced" fold. The label is "Dev Playground" with no subcopy. A user creating their first task will never discover it. Hover tooltip ("Enable native HTML preview rendering for frontend work") only appears on mouseover and doesn't convey what "playground" means.
- **Why it matters:** This is a "wow" feature — the kind of thing that generates a screenshot in a tweet. Burying it behind "Advanced" means it never shows up in a first-run demo. And on a demo, the presenter has to click "Advanced" mid-flow to expose it, breaking the narrative.
- **Recommendation:** Promote Dev Playground out of Advanced. Make it a visible toggle next to the Spec editor with a one-line subcopy ("Render HTML output inline — great for UI work, mockups, and data viz") and a small preview icon. Alternatively, auto-detect from spec content: if the spec mentions "HTML", "visualization", "mockup", "playground", auto-suggest enabling it.

### [MAJOR] "Research Codebase" button has zero onboarding and looks like a second "Generate" button

- **Category:** Hidden Feature
- **Location:** `src/renderer/src/components/task-workbench/SpecEditor.tsx:109-115`
- **Observation:** Next to "Generate Spec" there's a button labeled "Research Codebase." It sends a message to the AI Copilot ("Research the {repo} codebase for: {title}"), which has read-only Read/Grep/Glob access. This is a killer demo feature — "the AI actually reads your code before drafting a spec" — but the button just says "Research Codebase" with no copy explaining what happens. A new user doesn't know if this will burn tokens, open a modal, search GitHub, or do something else. And visually it sits adjacent to Feature/Bug Fix/Refactor/Test template buttons, making it look like a fifth template type.
- **Why it matters:** This is the thing that separates BDE's copilot from a generic chatbot — it's grounded in the actual repo. That's the bullet point of the section. But nobody will click a button labeled "Research Codebase" on day one.
- **Recommendation:** Rename to "Ask Copilot to Research" or "Scan Repo for Context" and add a subtitle like "reads Read/Grep/Glob against {repo}". Better: put it inline in the Copilot panel as a suggested action ("Research this repo for [title]") instead of in the spec toolbar. Also call it out in the README's Task Workbench section.

### [MAJOR] Cross-Repo Contract is a screenshot-worthy feature, invisibly nested

- **Category:** Hidden Feature
- **Location:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx:490-522` — nested inside Advanced fold, inside another collapsible `Cross-Repo Contract` toggle.
- **Observation:** There's a textarea for documenting API contracts / shared types that gets injected into the agent's prompt. This is a legitimately novel feature — the README doesn't even mention it. Users working across multiple repos (life-os + bde-site + BDE) would love this. But it's a collapsible inside a collapsible, with no hint that it exists, no placeholder in the Workbench form tour, and no mention in any docs.
- **Why it matters:** This is a differentiator from every other agent orchestrator. Bury it and nobody knows.
- **Recommendation:** Add it to the README features. Promote it out of the double-nested fold. On a demo of cross-repo work, this is the slide title.

### [MAJOR] The "New Task" empty state is missing the hook

- **Category:** Empty State
- **Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:532-543`
- **Observation:** When there are no tasks, the pipeline shows: `NeonCard title="No tasks yet"` and body "Create your first task to start the pipeline." with a "New Task" button. This is the single most important marketing moment in the app — the first time a user sees the pipeline. The copy is generic and flat. Compare to Dashboard's hero numbers or Code Review Station's Ship It moment.
- **Why it matters:** First impression. A user who just installed BDE lands here, sees a weak empty state, and gets zero sense of what's about to happen. "Create your first task to start the pipeline" tells them nothing about parallel agents, worktree isolation, or Ship It.
- **Recommendation:** Rewrite to lead with the value prop: "Queue a task → Claude Code picks it up → agents work in isolated worktrees → you review and ship it." Consider a 3-step illustrated walkthrough inside the empty state card, or a link to "Try the sample task" (reuse `SAMPLE_FIRST_TASK`).

### [MAJOR] Task Pipeline header still carries a "5" hardcoded active limit in the label

- **Category:** Copy
- **Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:583` — `count={${filteredPartition.inProgress.length}/5}`
- **Observation:** The "Active" column displays as `3/5` — but the `5` is hardcoded. `MAX_ACTIVE_TASKS` is configurable in Settings → Agent Manager. A user who raises their concurrency limit to 8 will still see `/5`.
- **Why it matters:** On a power-user demo ("look, I'm running 10 agents at once"), the `/5` makes the product look broken or dishonest. Trust issue.
- **Recommendation:** Read `MAX_ACTIVE_TASKS` from settings and use it in the count. Or drop the denominator entirely — just show the current count.

### [MAJOR] "Rebase / Fresh / Stale / Conflict" freshness indicator is great but cryptic

- **Category:** Copy
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:222-256` — freshness chip shows bare words: `Fresh`, `Stale (2 behind)`, `Conflict`, `Unknown`, `...`
- **Observation:** This is a sophisticated feature — BDE detects if the agent's branch is behind main and offers a one-click rebase. But the words "Fresh" / "Stale" / "Conflict" / "Unknown" with no context assume the user has already built the mental model. First-time users won't know what "Fresh" means relative to what.
- **Why it matters:** This is another differentiator (pre-merge rebase with conflict detection) that's visually underplayed. "Unknown" in particular looks like an error the user has to resolve.
- **Recommendation:** Label as "Up to date with main" / "2 commits behind main" / "Conflicts with main" / "Checking…" Drop "Unknown" in favor of a retry or omit the chip when state is truly unknown. Consider a subtle icon (check / warning / x) in front.

### [MAJOR] Review Queue empty state copy is passable but doesn't sell the feature

- **Category:** Empty State
- **Location:** `src/renderer/src/components/code-review/ReviewQueue.tsx:107`
- **Observation:** "No tasks awaiting review. Complete agent runs will appear here for inspection." Flat, descriptive, no excitement.
- **Why it matters:** A user who opens Code Review with an empty queue gets a bored sentence. This is the view that owns the product's best moment — Ship It. The empty state should tease it.
- **Recommendation:** "Nothing to ship yet. Queue a task in the Task Workbench and it'll land here when the agent's done. Then you can merge, PR, or Ship It in one click."

### [MINOR] "Queue Now" label loses against "Save to Backlog" visually

- **Category:** Visual Polish
- **Location:** `src/renderer/src/components/task-workbench/WorkbenchActions.tsx:52-72`
- **Observation:** The primary action button says "Queue Now" — but "Now" is a filler word and steals space from the actual verb. Competing label "Save to Backlog" is longer and draws the eye first.
- **Recommendation:** "Queue Task" or just "Queue" (primary button). Make it visually heavier than "Save to Backlog" via size or accent.

### [MINOR] Pipeline stats use lowercase labels while the rest of the app is Title Case

- **Category:** Copy
- **Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:464-476` — `{ label: 'active', ... }, { label: 'queued', ... }` etc., rendered as lowercase stat chips.
- **Observation:** The header badges read "3 active" / "12 queued" / "2 blocked" in all lowercase. Elsewhere in the app, stage names are Title Case ("Queued", "Blocked", "Active", "Review", "Done"). This visual inconsistency makes the header stats look like debug output.
- **Recommendation:** Capitalize the labels ("3 Active") or the counts will look more at home. At minimum, be consistent with the stage column headers below.

### [MINOR] "Zombie task" is alarming jargon

- **Category:** Copy
- **Location:** `src/renderer/src/components/sprint/TaskPill.tsx:75,139-143`
- **Observation:** A task pill can render with a `AlertTriangle` icon labeled "Zombie task" (tooltip "Agent finished but task not marked done"). "Zombie" is dev jargon for process-level concept, and it's scary in a screenshot.
- **Why it matters:** A user whose screenshot gets shared online doesn't want "zombie task" next to their name. It looks like the product is broken.
- **Recommendation:** "Agent finished — task status lagging" or "Pending status sync" with a refresh icon. Zombie is cute for engineers, bad for marketing.

### [MINOR] The `Edit: Untitled` header in Workbench looks like a bug when editing a title-less task

- **Category:** Copy
- **Location:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx:373-375`
- **Observation:** `{mode === 'edit' ? 'Edit: ${title || 'Untitled'}' : 'New Task'}` — if a user clears the title field while editing, the header becomes "Edit: Untitled" until they type again.
- **Recommendation:** Show "Edit Task" during editing with the title as a subtitle below, not in the H1.

### [MINOR] "No details" is a weak failure-card message

- **Category:** Empty State
- **Location:** `src/renderer/src/components/sprint/PipelineBacklog.tsx:126-128`
- **Observation:** Failed tasks in the sidebar show "No details" when `task.notes` is empty. On a demo, showing a failed task with "No details" makes the product look like it ate the error.
- **Recommendation:** "No diagnostic notes — open the task to see agent logs." Link directly to the Agents view for that task.

### [MINOR] Planner "Send to Pipeline" vs. Workbench "Queue Now" — same action, two names

- **Category:** Naming
- **Location:** `src/renderer/src/components/planner/EpicDetail.tsx:667` ("Send to Pipeline") vs `src/renderer/src/components/task-workbench/WorkbenchActions.tsx:68` ("Queue Now")
- **Observation:** Both buttons queue tasks. One says "Send to Pipeline," the other "Queue Now." A user alternating between the two views has to keep a little mental map of which verb means the same thing.
- **Recommendation:** Use "Queue" (or "Queue All" in the Planner batch case) consistently.

### [MINOR] "Stats" header chip says "review" but it means "awaiting review"

- **Category:** Copy
- **Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:469-472`
- **Observation:** Header badge says `{n} review`. The stage column below is labeled "Review" with subtitle "PRs awaiting merge" (`PipelineStage.tsx:83`). "Review" alone is ambiguous — is that tasks under review, or tasks I need to review?
- **Recommendation:** "To review" or "Awaiting review" in the header badge. Be explicit that this is a user action bucket.

### [MINOR] Dependency Picker "hard" vs "soft" toggle is unexplained on first click

- **Category:** Copy
- **Location:** `src/renderer/src/components/task-workbench/DependencyPicker.tsx:115-123`
- **Observation:** After adding a dependency, the user sees a small pill showing "hard" or "soft" and can click to toggle. The `title` attribute has a decent explanation, but on hover only. On a demo or screenshot the meaning is opaque.
- **Recommendation:** Show short inline subcopy the first time a dep is added: "Hard: blocks if upstream fails. Soft: unblocks regardless." Or use labels "Blocks on failure" / "Always unblocks" directly instead of hard/soft jargon. Or at least add a "?" help icon next to the dependencies label.

### [MINOR] The README mermaid diagram omits the Ship It path

- **Category:** Demo Story
- **Location:** `README.md:74-112`
- **Observation:** The task lifecycle mermaid diagram shows Review branching to `Merge locally` → Done, `Create PR` → PR Open, `Request revision` → Queued, `Discard` → Cancelled. But it does not show the Ship It path (merge + push atomically). This is the single button that best sells the product.
- **Recommendation:** Add a "Ship It" branch from Review that goes directly to Done with a note "merge + push in one click."

### [MINOR] Code Review tabs lack a "Changes" count badge

- **Category:** Visual Polish
- **Location:** `src/renderer/src/components/code-review/ReviewDetail.tsx:9-14,42-53`
- **Observation:** The tabs are labeled "Changes / Commits / Tests / Conversation" with no counts. Compare to GitHub PRs, which show file counts, commit counts, and comment counts as badges on the tabs. On a demo, a user cannot see at a glance how much work is in a review.
- **Recommendation:** Add counts to each tab: `Changes (14)`, `Commits (6)`, `Conversation (42)`. Low effort, big visual credibility boost.

### [MINOR] "Epic" icon is the first character of `group.icon` — an emoji mangler

- **Category:** Visual Polish
- **Location:** `src/renderer/src/components/planner/EpicDetail.tsx:334`, `src/renderer/src/components/planner/EpicList.tsx:125`
- **Observation:** `{group.icon.charAt(0).toUpperCase()}` — uses the first character of the icon field uppercased. If `group.icon` is meant to hold an emoji, `charAt(0)` will grab half a surrogate pair; if it's a word, the result is a single capital letter sitting in a colored square that looks like a placeholder. In screenshots, every epic looks like "B" or "F" in a colored square.
- **Recommendation:** Use a real icon (lucide-react) picked by category, or a full emoji (handle surrogate pairs), not the first char.
