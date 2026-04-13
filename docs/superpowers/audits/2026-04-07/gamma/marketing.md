# Marketing — Team Gamma (Full Pass) — BDE Audit 2026-04-07

## Summary

BDE has a strong README story ("steering system for Claude Code at scale") and a beautiful neon Dashboard, but the shipped product is fragmented by inconsistent naming. The Task Planner view ships under three different names ("Task Planner" / "Epics" / "Task Groups") and the Agents view ships under four ("Agents" / "Fleet" / "Scratchpad" / "Launchpad"). The README's screenshot story is also incomplete: only the Dashboard and Agents view have hero shots — the two most "story-rich" surfaces (Code Review Station and Task Pipeline) have nothing to show. Several factual mismatches between docs and code (Settings tab count, view shortcut table) will undermine trust in 30 seconds of demo. The single biggest demo killer is the "Create First Task" sample spec that ships with a literal `REPLACE_WITH_ENTRY_FILE` placeholder the user must edit before the agent will run — turning the marquee onboarding moment into a friction wall.

## Findings

### [CRITICAL] "Create First Task" onboarding sample is unrunnable as-shipped

- **Category:** Demo Story
- **Location:** `src/renderer/src/components/onboarding/steps/sample-first-task.ts:35-38`
- **Observation:** The DoneStep "Create your first task" button uses a sample spec whose `## Files to Change` section is literally `REPLACE_WITH_ENTRY_FILE — e.g. src/main/index.ts...`. The user is supposed to edit it before queuing.
- **Why it matters:** This is THE 30-second demo moment for a brand-new user — onboarding flows them straight into "Create First Task." If the agent immediately fails or thrashes because the file path is a placeholder string, the user concludes "BDE doesn't actually work" in the first 60 seconds. The whole "feed it specs and walk away" narrative dies on the demo floor.
- **Recommendation:** Ship a sample task that runs end-to-end without edits — e.g. "Add a `// BDE was here` comment to README.md" with the literal repo-relative path baked in. The first run must succeed for the story to land.

### [CRITICAL] Task Planner ships under three different names in the same view

- **Category:** Cross-cutting Naming
- **Location:** `src/renderer/src/views/PlannerView.tsx:149,154-155,193`, `src/renderer/src/lib/view-registry.ts:84-90`, `src/renderer/src/components/planner/EpicList.tsx`, `src/renderer/src/components/planner/CreateEpicModal.tsx`, `src/renderer/src/stores/taskGroups.ts`
- **Observation:** The view's left-nav label is "Task Planner." Its `<h1>` is "Task Planner." But its body says "Search epics...", its empty state says "Select an epic to view details," its components are `EpicList` / `EpicDetail` / `CreateEpicModal` / `AssignEpicPopover`, and its store is `useTaskGroups`. README and `BDE_FEATURES.md` never use the word "epic" once.
- **Why it matters:** A user clicks "Task Planner," sees "Search epics," opens the import button, and now is unsure: are these epics? Plans? Groups? Workflows? The whole "declarative coordination" pitch from the README requires the user to learn one term — instead they hit three.
- **Recommendation:** Pick ONE term — "Epic" is the most vivid and matches industry vocabulary. Rename `taskGroups` store, the registry label, and the README "Task Planner" entry to "Epics." Or, if "Task Planner" is the keeper, do a project-wide rename of `Epic*` components and `taskGroups` to match. Don't ship all three.

### [CRITICAL] Settings tab "About" is unreachable — sidebar list omits it

- **Category:** Visual Polish (broken)
- **Location:** `src/renderer/src/views/SettingsView.tsx:35-46` vs `:48-60`
- **Observation:** `SECTIONS` array (which renders the sidebar) has 10 entries and does NOT include `about`. `SECTION_MAP` and `SECTION_META` both have 11 entries including `about`. There is no way for a user to navigate to the About tab via the UI.
- **Why it matters:** README and `BDE_FEATURES.md` both promise an About section ("Version info, log file locations, GitHub link"). The README explicitly says Settings has "9 config tabs" — actually there are 10 visible and 1 dead. Users looking for the version or log file path (the first thing anyone hits when filing a bug report) hit a dead end. Looks unfinished.
- **Recommendation:** Add `{ id: 'about', label: 'About', icon: Info, category: 'App' }` to the `SECTIONS` array. While there: the README/CLAUDE.md/BDE_FEATURES.md "9 tabs" claim is wrong — actual count is 10 (or 11 with About). Update copy.

### [MAJOR] Agents view has 4 names for itself in 1 screen

- **Category:** Cross-cutting Naming
- **Location:** `src/renderer/src/views/AgentsView.tsx:302,341,365`, `src/renderer/src/components/agents/AgentLaunchpad.tsx`, `src/renderer/src/lib/view-registry.ts:36`
- **Observation:** Top-nav label: "Agents." Sidebar header: "Fleet." A note immediately below says "Scratchpad. Agents here run in isolated worktrees..." The empty/spawn surface is `AgentLaunchpad` / `LaunchpadGrid`. Four different concept-names visible at once on the same screen.
- **Why it matters:** A new user can't form a mental model. Are these "agents"? A "fleet"? A "scratchpad"? Are they being "launched"? The README's clean dichotomy ("Pipeline runs your sprint queue. Adhoc lives in Agents view.") is invisible because the view's own copy contradicts it.
- **Recommendation:** Pick a story. If the framing is "this is your scratchpad / playground for one-off agent tasks," lean into it: rename the view "Scratchpad," call the sidebar "Sessions," and call the spawn surface "New Session." Drop "Fleet" and "Launchpad." If it's truly "Agents," kill "Scratchpad" — promote the note text into a proper EmptyState on the launchpad screen.

### [MAJOR] Dashboard branded "BDE Command Center" — name appears nowhere else

- **Category:** Inconsistent Voice
- **Location:** `src/renderer/src/views/DashboardView.tsx:171`, `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts:2` ("Sprint Center"), `src/renderer/src/assets/sprint-pipeline-neon.css:473` ("Pipeline Center")
- **Observation:** The Dashboard's StatusBar title is "BDE Command Center." Internal code comments call the Sprint Pipeline "Sprint Center" and "Pipeline Center." None of these names appear in README, BDE_FEATURES.md, or the view registry. The view-registry calls them simply "Dashboard" and "Task Pipeline."
- **Why it matters:** "BDE Command Center" is actually a great hero phrase — it's evocative, it's on-brand, it screams "demo me." But it's used in exactly one place, with no echo in marketing copy or screenshots. Meanwhile users who saw the README expecting "Dashboard" see "BDE Command Center" and wonder if they're in the right place.
- **Recommendation:** Either commit to "Command Center" as the brand (use it in README, screenshot captions, and the panel tab label) or revert to plain "Dashboard." Right now it's an internal joke the user accidentally overhears.

### [MAJOR] README's "Views at a Glance" table is wrong / out of date

- **Category:** Copy
- **Location:** `README.md:324-336` vs `src/renderer/src/lib/view-registry.ts:27-91`
- **Observation:** The README table lists 8 views. It omits Task Planner (⌘8) entirely. It says Task Workbench has no shortcut (it's actually ⌘0). Task Workbench description says "Spec drafting with AI copilot + readiness checks" but architecture diagram in the same README says "8 Views" — actual is 9. The README also says architecture has "86 typed channels" while CLAUDE.md says "~138 typed channels."
- **Why it matters:** Anyone evaluating BDE will read the README, count 8 views, then open the app and find 9 view buttons. Trust eroded before they've used the product. The shortcut table is the first thing a power user memorizes — getting it wrong is amateur.
- **Recommendation:** Auto-derive the README table from the view-registry, or put a comment in the registry pointing to the README so it stays in sync. Update channel count to current. Update view count.

### [MAJOR] Code Review Station has no screenshot in README — the marquee feature is invisible

- **Category:** Demo Story
- **Location:** `docs/screenshots/` (only 3 files: dashboard-dark, dashboard-light, agents-view), `README.md:171-173`
- **Observation:** README spends real estate on Code Review Station ("Human in the Loop" — one of the strongest differentiators) but ships zero screenshots of it. Same for Sprint/Task Pipeline, the Mermaid diagrams have to do all the visual work.
- **Why it matters:** The product's strongest "wow" surfaces (visible diff review, queue of completed agent work, one-click merge) are described in prose only. The Dashboard gets two screenshots (dark + light) — Code Review gets zero. A scanner who only looks at the images sees "metrics dashboard" and concludes BDE is yet another agent monitoring tool.
- **Recommendation:** Add at least 3 hero screenshots: (1) Code Review Station with a real diff and the action buttons visible, (2) Task Pipeline with tasks in multiple stages, (3) Task Workbench with the copilot mid-conversation. Caption them with the verb the user does: "Inspect every line before it touches main."

### [MAJOR] Hidden killer feature: Dev Playground gets one paragraph, deserves the marquee

- **Category:** Hidden Feature
- **Location:** `README.md:181-183`, `src/renderer/src/components/agents/PlaygroundCard.tsx`, `PlaygroundModal.tsx`
- **Observation:** Dev Playground — "agents write HTML, BDE renders it inline, sandboxed" — gets two sentences in the README under Features. This is BDE's most visually impressive, most "show your friends" capability. The fact that an agent can write `dashboard-ux-playground.html` and you click and SEE IT in the same app is genuinely novel.
- **Why it matters:** The 30-second demo question is "what would you click first?" The answer should be "spawn an adhoc agent, ask it to build a CSS theme explorer, watch it render live in BDE." That's the moment that sells the product. Today it's buried.
- **Recommendation:** Promote Dev Playground above Agent Manager in the README Features section. Add a screenshot showing source + preview side-by-side. Consider making it a top-level talking point in the README hero ("BDE renders your agents' HTML output inline — no browser, no copy-paste, no tab juggling.").

### [MAJOR] "Sprint" vs "Task" naming is inconsistent across the product

- **Category:** Cross-cutting Naming
- **Location:** view-registry uses `sprint` as the view key but labels it `Task Pipeline`; the store is `useSprintTasks`; the CSS file is `sprint-pipeline-neon.css`; the hook is `useSprintKeyboardShortcuts`; README says "Sprint Pipeline" in some places ("Sprint Pipeline" in Why BDE) and "Task Pipeline" in others (Views table).
- **Observation:** Same concept under two names. Users will see "Sprint Pipeline" in the README, then look for it in the app and find "Task Pipeline."
- **Why it matters:** Each renaming layer signals indecision. New users searching docs won't know which term to grep for. SEO/discoverability suffers.
- **Recommendation:** Pick "Task Pipeline" (the actual UI label) as canonical. Rename README references, rename internal `sprint*` modules over time. Or commit to "Sprint" (it's punchier and matches the JIRA mental model the audience already has).

### [MAJOR] "Morning Briefing" is a delightful hidden feature with no discovery

- **Category:** Hidden Feature
- **Location:** `src/renderer/src/components/dashboard/MorningBriefing.tsx`, `src/renderer/src/views/DashboardView.tsx:38-69`
- **Observation:** When you reopen BDE and tasks completed since you closed the app, you get a "Morning Briefing" card showing what got done overnight. This is a phenomenal storytelling beat — it's literally "your AI worked while you slept."
- **Why it matters:** This is the #1 demoable cool thing in BDE that nobody knows about. It is mentioned in zero places in the README, BDE_FEATURES.md, or marketing copy. The mechanism (`bde:last-window-close` localStorage gating) means a fresh-install demo will NEVER trigger it.
- **Recommendation:** Mention "Morning Briefing" in the README under Dashboard. Add a screenshot. Consider a `?demo=briefing` URL param that forces it for screencasts. This is the "look what happened while you slept" moment — sell it.

### [MAJOR] "Promote to Code Review" is the cool new feature, buried in a sidebar note

- **Category:** Hidden Feature / Empty State
- **Location:** `src/renderer/src/views/AgentsView.tsx:328-346`
- **Observation:** The fact that you can spawn an adhoc agent, watch it work, and then "Promote to Code Review" to flow it into the tracked review queue is a genuinely powerful workflow. The discovery of this feature is a 4-line text note under the "Fleet" header that uses the word "Scratchpad" (which appears nowhere else).
- **Why it matters:** This is the "agent went well, let me ship it" moment. Users will never find the Promote button unless they read the note carefully. The recent commit log even highlights this as a feature: `3b2f8763 feat(agents): adhoc worktrees + Promote to Code Review`. It just shipped — and it's invisible.
- **Recommendation:** Add a one-line callout in README features: "Promote any adhoc session into the Code Review queue with one click." When an agent finishes successfully in the console, auto-toast: "Done — promote to Code Review?" Make it a discoverable verb, not a hidden button.

### [MINOR] "Spawn failed" / "Session started" — error voice is mixed

- **Category:** Inconsistent Voice
- **Location:** `src/renderer/src/components/agents/AgentLaunchpad.tsx:43-47`
- **Observation:** Success: "Session started." Failure: "Spawn failed: <error>." Two different nouns (session vs spawn) for the same action.
- **Why it matters:** Tiny copy thing but it betrays that the engineering vocabulary leaked into user-facing strings. "Spawn" is engineer-speak; users think "session" or "agent."
- **Recommendation:** Standardize: "Session started" / "Couldn't start session: <error>". Audit all `toast.error` calls for consistency.

### [MINOR] "BDE" abbreviation never expanded in the product

- **Category:** Copy
- **Location:** `README.md:3`, every UI surface
- **Observation:** README uses "BDE" in title but doesn't expand "Birkeland Development Environment" until you read CLAUDE.md or `BDE_FEATURES.md`. The app shell shows "BDE Command Center" with no tooltip or About link (and About is broken — see CRITICAL above).
- **Why it matters:** First-time users have to Google or grep to know what BDE stands for. For a personal-brand-leaning name, this is a missed opportunity to tell the founder story upfront.
- **Recommendation:** Expand the name in README hero ("BDE — Birkeland Development Environment"). Put it in the broken About section once that's fixed.

### [MINOR] Multiple `.html` playground files in repo root suggest build artifacts shipped

- **Category:** Visual Polish
- **Location:** repo root: `dashboard-ux-playground.html`, `sprint-planning-playground.html`, `task-groups-playground.html`, `task-planner-playground.html`
- **Observation:** Four playground HTML files sitting in the repo root. These look like agent scratch output that got committed. They're not in `docs/` or `playgrounds/` — they're in the top-level next to `package.json`.
- **Why it matters:** First impression of the GitHub repo file listing. A potential user browsing the repo sees four random HTML files at the top level and concludes the project is messy. Plus "task-groups-playground.html" and "task-planner-playground.html" both exist — see the naming finding above; even the playgrounds can't agree on what the feature is called.
- **Recommendation:** Move to `docs/playgrounds/` or `.gitignore` them. If they're meant to be public showcases of the playground feature, add a README pointing to them.

### [MINOR] CTA button "Create First Task" doesn't match the view it opens

- **Category:** Copy
- **Location:** `src/renderer/src/views/DashboardView.tsx:215-220`
- **Observation:** Empty Dashboard CTA reads "Create First Task" with a Plus icon. Clicking it opens "Task Workbench" — a multi-pane spec editor with copilot, readiness checks, etc. There is no "Create" button in Workbench — the button is "Save" or "Queue."
- **Why it matters:** Verb mismatch causes a 1-second cognitive bump. User expects a creation flow, gets a drafting flow. Workbench is bigger than the user braced for.
- **Recommendation:** Either rename the CTA to "Draft First Task" (matches Workbench's "Plan Before You Build" tagline) or "Open Task Workbench." Set the right expectation.

### [MINOR] Settings shows "Cost & Usage" but README says just "Cost"

- **Category:** Copy
- **Location:** `src/renderer/src/views/SettingsView.tsx:41`, `README.md:191` ("Cost Tracking")
- **Observation:** Settings tab is "Cost & Usage." README features it as "Cost Tracking." BDE_FEATURES.md just calls it "Cost." Internal table is `cost_events`.
- **Why it matters:** Same drumbeat — three names for the same thing scattered across docs/code/UI undermines the "we ship a polished product" message.
- **Recommendation:** Pick "Cost & Usage" (most descriptive) and use it everywhere — README, features doc, BDE_FEATURES.md.

### [MINOR] "9 Views" architecture diagram in README contradicts "8 Views" in same diagram

- **Category:** Copy
- **Location:** `README.md:221`
- **Observation:** Mermaid diagram label: "8 Views — Dashboard · Agents · IDE · Pipeline · Code Review · Source Control · Settings · Task Workbench". Lists 8 but BDE actually ships 9 (Task Planner missing from list).
- **Why it matters:** Same factual issue as the Views table finding. Anyone reading the architecture diagram will undercount the product.
- **Recommendation:** Add Task Planner to the diagram, change label to "9 Views."

### [MINOR] "Tear-off windows" feature mentioned but not visible in any screenshot

- **Category:** Hidden Feature
- **Location:** `README.md:337`, `src/renderer/src/stores/panelLayout.ts`
- **Observation:** "The panel system supports split panes, drag-and-drop docking, and tear-off windows for multi-monitor setups." That's a big claim — multi-monitor pro users will perk up. Zero screenshots of it. Zero gifs.
- **Why it matters:** "Tear-off into a separate window" is a power-user love-bomb. It's the kind of detail that sells BDE to people who already use VS Code with two monitors. Hidden.
- **Recommendation:** Add a screenshot or gif showing a Code Review pane torn off onto a second monitor. Or at minimum a one-line caption in the panel system section.
