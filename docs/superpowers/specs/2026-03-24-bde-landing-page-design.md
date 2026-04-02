# BDE Landing Page — Design Spec

**Date:** 2026-03-24
**Owner:** Ryan
**Goal:** Create a marketing landing page for BDE targeting open-source developers interested in agent-driven development. Waitlist-gated early access with "coming soon" positioning.

---

## Approach

Fork the `feast-site` repo into a new `bde-site` project. Reuse the Next.js 16 + Tailwind v4 infrastructure, design tokens, glass morphism system, waitlist API, and Vercel deploy pipeline. Replace all content and swap phone mockups for desktop app window screenshots.

## Project Setup

| Setting | Value |
|---------|-------|
| Repo | `bde-site` at `~/projects/bde-site` |
| Forked from | `feast-site` |
| Framework | Next.js 16 + React 19 + TypeScript |
| Styling | Tailwind CSS v4 with `@theme` tokens |
| Deployment | Vercel (auto-deploy from `main`) |
| Domain | TBD (`bde.dev`, `birkeland.dev`, or subdomain) |
| Feature flag | `NEXT_PUBLIC_SITE_LIVE` — toggles full site vs coming-soon screen (must be wired into `page.tsx` — feast-site has `ComingSoon.tsx` but the conditional rendering isn't currently active) |
| Waitlist | Supabase `waitlist` table with `source: 'bde'` to distinguish from feast signups |

## Audience

Open-source developers who would download and use BDE for their own agent workflows. Tone is technical, confident, and forward-looking — positioning BDE as a paradigm shift in how development environments work.

## Design System

Identical to feast-site. Brand consistency across products.

| Token | Value |
|-------|-------|
| Background | `#050505` |
| Surface | `#111113` |
| Card | `#1A1A1D` |
| Border | `#2A2A2E` |
| Brand green | `#00D37F` |
| Green dark | `#00A863` |
| Text primary | `#F5F5F7` |
| Text secondary | `#98989F` |
| Text tertiary | `#5C5C63` |
| Glass morphism | `rgba(26,26,29,0.8)` bg + `rgba(255,255,255,0.06)` border + `backdrop-filter: blur(20px)` |
| Font | Inter (via `next/font/google` — already configured in feast-site `layout.tsx`) |
| Button glow | `boxShadow: 0 4px 16px rgba(0,211,127,0.3)` |
| Radial glow | `radial-gradient(circle, rgba(0,211,127,0.08), transparent 60%)` |

All CSS tokens use the `v2-` prefix convention from feast-site (e.g., `--color-v2-background`, `--color-v2-primary`). Keep this convention in the fork.

## Page Sections

### 1. Header — Fixed Glassmorphic Nav

- **Left:** "BDE" wordmark (Inter Bold, 0.3em tracking, uppercase, green)
- **Right (desktop):** "Features", "How It Works", "Tech Stack" nav links + "Join Waitlist" green gradient CTA button
- **Mobile:** Hamburger toggle with slide-down nav
- **Style:** Fixed top, z-50, `rgba(5,5,5,0.85)` + `backdrop-filter: blur(20px)`, subtle bottom border

### 2. Hero — Split Layout

- **Background:** `#050505` with radial green glow behind the screenshot
- **Left content:**
  - **Headline:** "Software development is changing. **Your IDE should too.**" — second sentence in green
  - **Subheadline:** "BDE is a desktop environment built from scratch for agent-driven development — where you define the work and AI agents execute it. Manage tasks, review code, and ship features without writing every line yourself."
  - **Primary CTA:** "Join the Waitlist" — green gradient button with glow shadow
  - **Secondary CTA:** "See How It Works" — outline/border button
- **Right visual:** Large screenshot of BDE (Sprint board or Agents view) in a desktop window frame component with traffic light dots. Not a phone mockup.
- **Layout:** Split on desktop (text left, screenshot right), stacked on mobile

### 3. Features — 5-Card Grid

- **Background:** `#111113`
- **Layout:** 3 cards top row + 2 centered bottom row (or 3+2 asymmetric)
- **Card style:** Glass morphism cards with icon, title, description. Hover state with border color transition.

| # | Title | Icon | Description |
|---|-------|------|-------------|
| 1 | Agent Orchestration | Cpu / Bot | Spawn, monitor, and manage multiple AI agents working your codebase in parallel. Each agent runs in an isolated git worktree. |
| 2 | Task Dependencies | GitBranch / Network | Hard and soft dependencies with cycle detection and auto-blocking. Agents work in the right order, automatically. |
| 3 | Sprint Management | Kanban / ListTodo | Task queue with real-time Supabase sync, status transitions, and an automated drain loop that keeps agents busy. |
| 4 | Code Review | GitPullRequest / MessageSquare | Built-in PR station with inline comments, CI status badges, diff viewer, and merge controls. No context switching. |
| 5 | Cost Tracking | DollarSign / BarChart | Token analytics and daily spend charts so you always know what your agents cost. |

Icons from `@heroicons/react` (already installed in feast-site fork). Feast-site uses Heroicons throughout — keep consistent.

### 4. How It Works — 4-Step Vertical Timeline

- **Background:** `#050505`
- **Layout:** Numbered steps with green gradient connectors between them. Each step has text on one side and a mini app screenshot on the other (alternating sides on desktop).
- **Step badge:** Green gradient circle with step number

| Step | Title | Description | Screenshot |
|------|-------|-------------|------------|
| 1 | Define tasks and dependencies | Break your feature into tasks on the sprint board. Set dependencies so agents tackle prerequisites first. | Kanban / Sprint view |
| 2 | BDE spawns agents in isolation | Each task gets its own agent in an isolated git worktree. Agents work in parallel without stepping on each other. | Agents view |
| 3 | Agents push branches and open PRs | When an agent finishes, BDE auto-commits, pushes the branch, and opens a pull request. You stay informed, not involved. | PR list or notification |
| 4 | Review, merge, and ship | Review diffs, leave inline comments, check CI status, and merge — all from PR Station. No context switching. | PR Station diff view |

### 5. App Preview — Multi-Window Showcase

- **Background:** `#111113`
- **Layout:** 3 overlapping desktop window frames (replacing feast's 3-phone fan):
  - **Left:** Sprint board (Kanban) — rotated -3deg
  - **Center:** Agents view or IDE — elevated, green glow, 0deg
  - **Right:** PR Station — rotated +3deg
- **Mobile:** Single centered screenshot, swipeable or stacked
- **Window frame component:** Replaces `PhoneMockup` — rounded rect with traffic light dots, title bar, dark chrome

### 6. Architecture / Tech Stack

- **Background:** `#050505`
- **Layout:** Clean grid of 6 items, each with icon + title + one-line description. Or a minimal architecture diagram.

| Item | Description |
|------|-------------|
| Electron + React | Native desktop app with web UI flexibility |
| TypeScript | Strict mode, end-to-end type safety |
| SQLite | Local-first data — your data stays on your machine |
| Claude Agent SDK | Direct integration with Anthropic's agent SDK |
| Git Worktrees | Each agent works in isolation — no branch conflicts |
| Supabase Sync | Optional cloud sync for team sprint management |

Tone: emphasize local-first, privacy, clean architecture. Developers care about what's under the hood.

### 7. Comparison — "BDE vs. the Terminal"

- **Background:** `#111113`
- **Layout:** Two-column comparison (or before/after)

| Without BDE | With BDE |
|-------------|----------|
| Juggle terminal tabs for each agent | Unified workspace — all agents in one view |
| Manually track agent output and errors | Real-time monitoring with watchdog + status |
| No dependency management between tasks | Hard/soft deps, cycle detection, auto-blocking |
| Copy-paste PRs into GitHub for review | Built-in PR station with inline comments |
| No visibility into token spend | Cost dashboard with daily analytics |
| Hope agents don't conflict on branches | Automatic git worktree isolation |

### 8. Waitlist — Email Signup CTA

- **Background:** `#050505`
- **Headline:** "Be the first to try BDE"
- **Subheadline:** "BDE is in early development. Join the waitlist for early access — we'll send you an invite when it's ready."
- **Form:** Email input + "Join Waitlist" green gradient button
- **Helper text:** "No spam, ever. Just an invite when it's your turn."
- **Success state:** Green checkmark + "You're in." + "We'll reach out when your spot opens up."
- **Error fallback:** mailto: link if API fails
- **API:** POST to `/api/waitlist` → Supabase insert with `source: 'bde'` (feast-site currently uses `source: 'landing-page'` — update to `'bde'` in fork)

### 9. Footer — Minimal

- **Background:** `#050505`
- **Left:** "BDE" wordmark + "The development environment for the age of agents."
- **Right:** GitHub repo link, Privacy, Terms
- **Bottom:** "2026 R.B Technologies"

## Components to Build (New)

| Component | Replaces | Purpose |
|-----------|----------|---------|
| `WindowFrame.tsx` | `PhoneMockup.tsx` | Desktop app window frame with traffic light dots, title bar. Accepts `size` prop and screenshot content. |
| `TechStack.tsx` | `Personas.tsx` | 6-item grid of tech stack cards |
| `Comparison.tsx` | — (new) | Two-column BDE vs terminal comparison |

## Components to Reuse (from feast-site)

| Component | Changes Needed |
|-----------|---------------|
| `Header.tsx` | Swap "FEAST" → "BDE", update nav links |
| `Hero.tsx` | Replace phone mockup with WindowFrame, update copy |
| `Features.tsx` | Update to 5 cards (was 4), new icons + copy |
| `HowItWorks.tsx` | Update 4 steps with BDE workflow, use WindowFrame instead of PhoneMockup |
| `AppPreview.tsx` | 3 WindowFrames instead of 3 phones |
| `Waitlist.tsx` | Add `source: 'bde'` to API call |
| `ComingSoon.tsx` | Update copy for BDE |
| `Footer.tsx` | Swap wordmark + tagline, add GitHub link |

## Components to Delete

| Component | Reason |
|-----------|--------|
| `Personas.tsx` | Feast-specific (AI team members) — replaced by TechStack |
| `PhoneMockup.tsx` | Mobile app frame — replaced by WindowFrame |

## Screenshots Needed

These will be captured from the running BDE app and placed in `public/screenshots/`:

| Screenshot | Used In | View |
|------------|---------|------|
| `sprint-kanban.png` | Hero (right), HowItWorks step 1, AppPreview left | Sprint view — Kanban board with tasks |
| `agents-view.png` | HowItWorks step 2, AppPreview center | Agents view — active agents with status |
| `pr-list.png` | HowItWorks step 3 | PR Station — list with CI badges |
| `pr-diff.png` | HowItWorks step 4, AppPreview right | PR Station — diff viewer with inline comment |
| `cost-dashboard.png` | (optional, features section) | Cost view — token analytics chart |
| `ide-view.png` | (optional, AppPreview alternative) | IDE — Monaco + file explorer + terminal |

Placeholder screenshots will be used initially (similar to feast-site approach), replaced with real captures before launch.

## Deployment

1. Create `bde-site` repo on GitHub
2. Connect to Vercel
3. Set env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_LIVE`
4. Deploy to chosen domain
5. Initially launch with `NEXT_PUBLIC_SITE_LIVE=false` (coming soon screen)
6. Flip to `true` when content + screenshots are ready

## Success Criteria

- All 9 sections render correctly on desktop (1440px+) and mobile (375px+)
- Glass morphism, green accents, and typography match feast-site exactly
- Waitlist form successfully writes to Supabase with `source: 'bde'`
- Lighthouse score > 90 (performance, accessibility)
- Coming soon screen works when feature flag is off
- WindowFrame component renders screenshots at 3 sizes (sm/md/lg) with proper chrome
