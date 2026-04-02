# BDE Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a marketing landing page for BDE at `~/projects/bde-site`, forked from the feast-site codebase, targeting open-source developers with a waitlist-gated early access flow.

**Architecture:** Next.js 16 + React 19 + Tailwind CSS v4 single-page marketing site. Forked from `feast-site` — reuse design tokens, glass morphism, and Vercel deploy infrastructure. Replace all feast-specific content with BDE developer-tool content. Swap `PhoneMockup` for a new `WindowFrame` component.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, @heroicons/react, Supabase (waitlist)

**Spec:** `docs/superpowers/specs/2026-03-24-bde-landing-page-design.md`

---

### Task 1: Fork and Scaffold the Project

**Files:**
- Create: `~/projects/bde-site/` (full project directory)
- Modify: `~/projects/bde-site/package.json`
- Modify: `~/projects/bde-site/src/app/layout.tsx`
- Delete: `~/projects/bde-site/public/feast-logo.svg`
- Delete: `~/projects/bde-site/public/instacart-logo.svg`

- [ ] **Step 1: Copy feast-site to bde-site**

```bash
cp -r ~/projects/feast-site ~/projects/bde-site
cd ~/projects/bde-site
rm -rf .git .next node_modules .vercel
git init
git branch -M main
```

- [ ] **Step 2: Update package.json**

Change `name` from `"feast-site"` to `"bde-site"`. No dependency changes needed.

```json
{
  "name": "bde-site",
  "version": "0.1.0",
  "private": true
}
```

- [ ] **Step 3: Update layout.tsx metadata**

In `src/app/layout.tsx`, replace all Feast metadata with BDE metadata:

```tsx
export const metadata: Metadata = {
  title: "BDE - The IDE for Agent-Driven Development",
  description:
    "Software development is changing. BDE is a desktop environment built from scratch for agent-driven development — manage tasks, orchestrate agents, review code, and ship.",
  openGraph: {
    title: "BDE - The IDE for Agent-Driven Development",
    description:
      "A desktop IDE purpose-built for the era of AI agents. Define tasks, manage dependencies, review pull requests, and ship.",
    type: "website",
  },
};
```

- [ ] **Step 4: Delete feast-specific assets (keep components until replaced)**

```bash
rm ~/projects/bde-site/public/feast-logo.svg
rm ~/projects/bde-site/public/instacart-logo.svg
rm -rf ~/projects/bde-site/public/screenshots/*
```

Note: Do NOT delete `Personas.tsx` or `PhoneMockup.tsx` yet — `page.tsx` still imports them. They get removed in Task 11 when `page.tsx` is rewritten with the new component set.

- [ ] **Step 5: Add placeholder screenshots**

Create placeholder screenshot files (solid dark rectangles) for the 4 required screenshots. These will be replaced with real BDE captures later.

```bash
mkdir -p ~/projects/bde-site/public/screenshots
```

For now, create a simple placeholder SVG that each screenshot path can reference:

Create `~/projects/bde-site/public/screenshots/placeholder.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
  <rect width="800" height="500" fill="#111113"/>
  <text x="400" y="250" text-anchor="middle" fill="#5C5C63" font-family="Inter, sans-serif" font-size="16">Screenshot coming soon</text>
</svg>
```

- [ ] **Step 6: Install dependencies and verify build**

```bash
cd ~/projects/bde-site
npm install
npm run build
```

Expected: Build succeeds. Personas and PhoneMockup are still present so all imports resolve.

- [ ] **Step 7: Add .superpowers/ to .gitignore**

Append `.superpowers/` to `~/projects/bde-site/.gitignore` if not already present.

- [ ] **Step 8: Initial commit**

```bash
cd ~/projects/bde-site
git add -A
git commit -m "chore: scaffold bde-site from feast-site fork"
```

---

### Task 2: WindowFrame Component

**Files:**
- Create: `~/projects/bde-site/src/components/WindowFrame.tsx`

This replaces `PhoneMockup.tsx` — a desktop app window frame with traffic light dots, title bar, and configurable sizes.

- [ ] **Step 1: Create WindowFrame component**

Create `~/projects/bde-site/src/components/WindowFrame.tsx`:

```tsx
const SIZES = {
  sm: { width: "w-[240px]", padding: "p-[4px]", outerRadius: "rounded-[12px]", innerRadius: "rounded-[8px]", titleBar: "h-7 text-[10px]" },
  md: { width: "w-[320px]", padding: "p-[5px]", outerRadius: "rounded-[14px]", innerRadius: "rounded-[10px]", titleBar: "h-8 text-[11px]" },
  lg: { width: "w-[480px]", padding: "p-[6px]", outerRadius: "rounded-[16px]", innerRadius: "rounded-[12px]", titleBar: "h-9 text-xs" },
};

export function WindowFrame({
  size = "lg",
  glow = false,
  title = "",
  className = "",
  children,
}: {
  size?: "sm" | "md" | "lg";
  glow?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const s = SIZES[size];

  return (
    <div className={`${s.width} shrink-0 ${className}`}>
      <div
        className={`bg-v2-card ${s.outerRadius} border border-v2-border ${s.padding}`}
        style={{
          boxShadow: glow
            ? "0 8px 32px rgba(0,0,0,0.5), 0 4px 16px rgba(0,211,127,0.08)"
            : "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {/* Title bar */}
        <div className={`flex items-center gap-2 px-3 ${s.titleBar}`}>
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-[#ef4444]/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#eab308]/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#22c55e]/80" />
          </div>
          {title && (
            <span className="ml-2 text-v2-text-tertiary">{title}</span>
          )}
        </div>
        {/* Content */}
        <div className={`bg-v2-background ${s.innerRadius} overflow-hidden`}>
          {children}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify component compiles**

```bash
cd ~/projects/bde-site && npx tsc --noEmit
```

Expected: No errors from WindowFrame.tsx (other files may error — those are fixed in later tasks).

- [ ] **Step 3: Commit**

```bash
git add src/components/WindowFrame.tsx
git commit -m "feat: add WindowFrame component replacing PhoneMockup"
```

---

### Task 3: Header Component

**Files:**
- Modify: `~/projects/bde-site/src/components/Header.tsx`

- [ ] **Step 1: Update Header with BDE content**

Replace the full contents of `src/components/Header.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Tech Stack", href: "#tech-stack" },
];

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header
      className="fixed top-0 z-50 w-full border-b border-white/[0.06]"
      style={{ background: "rgba(5, 5, 5, 0.85)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a
          href="#"
          className="text-lg font-bold tracking-[0.3em] uppercase text-v2-primary"
        >
          BDE
        </a>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-v2-text-secondary transition-colors duration-200 hover:text-v2-text-primary"
            >
              {link.label}
            </a>
          ))}
          <a
            href="#waitlist"
            className="rounded-[20px] px-5 py-2 text-sm font-semibold text-v2-background transition-all duration-200 active:scale-[0.97]"
            style={{ background: "linear-gradient(135deg, #00D37F, #00A863)" }}
          >
            Join Waitlist
          </a>
        </nav>

        {/* Mobile toggle */}
        <button
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? (
            <XMarkIcon className="h-6 w-6 text-v2-text-primary" />
          ) : (
            <Bars3Icon className="h-6 w-6 text-v2-text-primary" />
          )}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <nav className="border-t border-white/[0.06] bg-v2-background px-6 py-4 md:hidden">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block py-2 text-sm font-medium text-v2-text-secondary transition-colors duration-200 hover:text-v2-text-primary"
            >
              {link.label}
            </a>
          ))}
          <a
            href="#waitlist"
            onClick={() => setMobileOpen(false)}
            className="mt-2 block rounded-[20px] px-5 py-2.5 text-center text-sm font-semibold text-v2-background"
            style={{ background: "linear-gradient(135deg, #00D37F, #00A863)" }}
          >
            Join Waitlist
          </a>
        </nav>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Header.tsx
git commit -m "feat: update Header for BDE — nav links, wordmark"
```

---

### Task 4: Hero Component

**Files:**
- Modify: `~/projects/bde-site/src/components/Hero.tsx`

- [ ] **Step 1: Rewrite Hero with BDE content and WindowFrame**

Replace the full contents of `src/components/Hero.tsx`:

```tsx
import Image from "next/image";
import { WindowFrame } from "@/components/WindowFrame";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-v2-background px-6 pt-32 pb-16 md:pb-24">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-12 md:flex-row md:gap-16">
        {/* Left: Copy */}
        <div className="flex-1 text-center md:text-left">
          <p className="text-[11px] font-semibold uppercase tracking-[2px] text-v2-primary">
            A New Kind of IDE
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-[1.12] tracking-[-0.5px] text-v2-text-primary sm:text-5xl md:text-[56px]">
            Software development is changing.
            <br />
            <span className="text-v2-primary">Your IDE should too.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-full md:max-w-[480px] text-[17px] leading-[1.7] text-v2-text-secondary md:mx-0">
            BDE is a desktop environment built from scratch for{" "}
            <span className="font-semibold text-v2-text-primary">
              agent-driven development
            </span>
            — where you define the work and AI agents execute it. Manage tasks,
            review code, and ship features without writing every line yourself.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row md:justify-start">
            <a
              href="#waitlist"
              className="w-full sm:w-auto text-center rounded-[20px] px-8 py-3.5 text-[15px] font-bold text-v2-background transition-all duration-200 active:scale-[0.97]"
              style={{
                background: "linear-gradient(135deg, #00D37F, #00A863)",
                boxShadow: "0 4px 16px rgba(0,211,127,0.3)",
              }}
            >
              Join the Waitlist
            </a>
            <a
              href="#how-it-works"
              className="w-full sm:w-auto text-center rounded-[20px] border border-v2-border px-7 py-3.5 text-[15px] font-semibold text-v2-text-primary transition-all duration-200 hover:border-v2-border-light"
            >
              See How It Works
            </a>
          </div>
        </div>

        {/* Right: App Window */}
        <div className="relative">
          <div
            className="pointer-events-none absolute top-1/2 left-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2"
            style={{
              background:
                "radial-gradient(circle, rgba(0,211,127,0.08) 0%, transparent 70%)",
            }}
          />
          <WindowFrame size="lg" glow title="BDE — Sprint Board" className="!w-[300px] md:!w-[480px]">
            <Image
              src="/screenshots/placeholder.svg"
              alt="BDE — Sprint board with task queue"
              width={480}
              height={300}
              className="w-full h-auto"
            />
          </WindowFrame>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Hero.tsx
git commit -m "feat: rewrite Hero for BDE — headline, WindowFrame, copy"
```

---

### Task 5: Features Component

**Files:**
- Modify: `~/projects/bde-site/src/components/Features.tsx`

- [ ] **Step 1: Rewrite Features with 5 BDE feature cards**

Replace the full contents of `src/components/Features.tsx`:

```tsx
import {
  CpuChipIcon,
  ArrowsPointingOutIcon,
  QueueListIcon,
  CodeBracketSquareIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";

const FEATURES = [
  {
    icon: CpuChipIcon,
    title: "Agent Orchestration",
    description:
      "Spawn, monitor, and manage multiple AI agents working your codebase in parallel. Each agent runs in an isolated git worktree.",
  },
  {
    icon: ArrowsPointingOutIcon,
    title: "Task Dependencies",
    description:
      "Hard and soft dependencies with cycle detection and auto-blocking. Agents work in the right order, automatically.",
  },
  {
    icon: QueueListIcon,
    title: "Sprint Management",
    description:
      "Task queue with real-time sync, status transitions, and an automated drain loop that keeps agents busy.",
  },
  {
    icon: CodeBracketSquareIcon,
    title: "Code Review",
    description:
      "Built-in PR station with inline comments, CI status badges, diff viewer, and merge controls. No context switching.",
  },
  {
    icon: ChartBarIcon,
    title: "Cost Tracking",
    description:
      "Token analytics and daily spend charts so you always know what your agents cost.",
  },
];

export function Features() {
  return (
    <section id="features" className="bg-v2-surface px-6 py-16 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[2px] text-v2-primary">
            Features
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.4px] text-v2-text-primary sm:text-4xl">
            Everything you need to orchestrate agents
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-v2-text-secondary">
            BDE replaces the patchwork of terminals, browser tabs, and scripts
            with a single workspace designed for agent-driven development.
          </p>
        </div>

        <div className="mt-16 grid gap-4 md:grid-cols-3">
          {FEATURES.slice(0, 3).map((feature) => (
            <div
              key={feature.title}
              className="rounded-[20px] border border-white/[0.06] p-5 md:p-7 transition-colors duration-200 hover:border-white/[0.12]"
              style={{ background: "rgba(26, 26, 29, 0.8)" }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-v2-primary/12">
                <feature.icon className="h-6 w-6 text-v2-primary" />
              </div>
              <h3 className="mt-4 text-[17px] font-semibold text-v2-text-primary">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-v2-text-secondary">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 md:mx-auto md:max-w-4xl">
          {FEATURES.slice(3).map((feature) => (
            <div
              key={feature.title}
              className="rounded-[20px] border border-white/[0.06] p-5 md:p-7 transition-colors duration-200 hover:border-white/[0.12]"
              style={{ background: "rgba(26, 26, 29, 0.8)" }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-v2-primary/12">
                <feature.icon className="h-6 w-6 text-v2-primary" />
              </div>
              <h3 className="mt-4 text-[17px] font-semibold text-v2-text-primary">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-v2-text-secondary">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify Heroicons exports exist**

```bash
cd ~/projects/bde-site && grep -r "CpuChipIcon\|ArrowsPointingOutIcon\|QueueListIcon\|CodeBracketSquareIcon\|ChartBarIcon" node_modules/@heroicons/react/24/outline/index.js | head -5
```

If any icon doesn't exist, substitute with a close alternative from `@heroicons/react/24/outline`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Features.tsx
git commit -m "feat: rewrite Features for BDE — 5 capability cards"
```

---

### Task 6: HowItWorks Component

**Files:**
- Modify: `~/projects/bde-site/src/components/HowItWorks.tsx`

- [ ] **Step 1: Rewrite HowItWorks with BDE 4-step workflow**

Replace the full contents of `src/components/HowItWorks.tsx`:

```tsx
import Image from "next/image";
import { WindowFrame } from "@/components/WindowFrame";

const STEPS = [
  {
    number: "01",
    title: "Define tasks and dependencies",
    description:
      "Break your feature into tasks on the sprint board. Set hard or soft dependencies so agents tackle prerequisites first.",
  },
  {
    number: "02",
    title: "BDE spawns agents in isolation",
    description:
      "Each task gets its own agent in an isolated git worktree. Agents work in parallel without stepping on each other.",
  },
  {
    number: "03",
    title: "Agents push branches and open PRs",
    description:
      "When an agent finishes, BDE auto-commits, pushes the branch, and opens a pull request. You stay informed, not involved.",
  },
  {
    number: "04",
    title: "Review, merge, and ship",
    description:
      "Review diffs, leave inline comments, check CI status, and merge — all from PR Station. No context switching.",
  },
];

const STEP_SCREENSHOTS = [
  { src: "/screenshots/placeholder.svg", alt: "BDE — Sprint board with task dependencies" },
  { src: "/screenshots/placeholder.svg", alt: "BDE — Agents view with parallel workers" },
  { src: "/screenshots/placeholder.svg", alt: "BDE — PR list with CI badges" },
  { src: "/screenshots/placeholder.svg", alt: "BDE — PR Station diff viewer" },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-v2-background px-6 py-16 md:py-24">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[2px] text-v2-primary">
            How It Works
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.4px] text-v2-text-primary sm:text-4xl">
            From task to shipped code in four steps
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-v2-text-secondary">
            Define the work. Let agents handle the rest.
          </p>
        </div>

        <div className="mt-16">
          {STEPS.map((step, i) => (
            <div key={step.number}>
              <div className={`flex flex-col items-center gap-8 md:gap-12 ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"}`}>
                {/* Text */}
                <div className="flex-1">
                  <div className="flex items-center gap-3.5">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold text-v2-background"
                      style={{
                        background:
                          "linear-gradient(135deg, #00D37F, #00A863)",
                        boxShadow: "0 4px 12px rgba(0,211,127,0.25)",
                      }}
                    >
                      {step.number}
                    </div>
                    <h3 className="text-xl font-bold text-v2-text-primary">
                      {step.title}
                    </h3>
                  </div>
                  <p className="mt-3 pl-[54px] text-[15px] leading-[1.7] text-v2-text-secondary">
                    {step.description}
                  </p>
                </div>

                {/* Mini window */}
                <WindowFrame size="sm" title={STEP_SCREENSHOTS[i].alt.replace("BDE — ", "")}>
                  <Image
                    src={STEP_SCREENSHOTS[i].src}
                    alt={STEP_SCREENSHOTS[i].alt}
                    width={240}
                    height={150}
                    className="w-full h-auto"
                  />
                </WindowFrame>
              </div>

              {/* Connector */}
              {i < STEPS.length - 1 && (
                <div
                  className="mx-auto my-8 h-16 w-0.5 rounded-full"
                  style={{
                    background:
                      "linear-gradient(to bottom, #00D37F, #2A2A2E)",
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/HowItWorks.tsx
git commit -m "feat: rewrite HowItWorks for BDE — 4-step agent workflow"
```

---

### Task 7: AppPreview Component

**Files:**
- Modify: `~/projects/bde-site/src/components/AppPreview.tsx`

- [ ] **Step 1: Rewrite AppPreview with 3 WindowFrames**

Replace the full contents of `src/components/AppPreview.tsx`:

```tsx
import Image from "next/image";
import { WindowFrame } from "@/components/WindowFrame";

export function AppPreview() {
  return (
    <section id="preview" className="relative overflow-hidden bg-v2-surface px-6 py-16 md:py-24">
      {/* Background glow */}
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2"
        style={{
          background:
            "radial-gradient(ellipse, rgba(0,211,127,0.06) 0%, transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[2px] text-v2-primary">
            See It In Action
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.4px] text-v2-text-primary sm:text-4xl">
            One workspace for your entire agent workflow
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base md:text-lg text-v2-text-secondary">
            Sprint board, agent monitoring, code review — no tab switching required.
          </p>
        </div>

        {/* Window fan — desktop */}
        <div className="mt-16 hidden items-end justify-center gap-6 md:flex">
          {/* Left: Sprint */}
          <div className="-rotate-3">
            <WindowFrame size="md" title="Sprint Board">
              <Image
                src="/screenshots/placeholder.svg"
                alt="BDE — Sprint board"
                width={320}
                height={200}
                className="w-full h-auto"
              />
            </WindowFrame>
            <p className="mt-2.5 text-center text-[11px] text-v2-text-tertiary">
              Sprint Board
            </p>
          </div>

          {/* Center: Agents (elevated) */}
          <div className="-translate-y-2.5">
            <WindowFrame size="md" glow title="Agents" className="!w-[360px]">
              <Image
                src="/screenshots/placeholder.svg"
                alt="BDE — Agents view"
                width={360}
                height={225}
                className="w-full h-auto"
              />
            </WindowFrame>
            <p className="mt-2.5 text-center text-[11px] text-v2-text-tertiary">
              Agents
            </p>
          </div>

          {/* Right: PR Station */}
          <div className="rotate-3">
            <WindowFrame size="md" title="PR Station">
              <Image
                src="/screenshots/placeholder.svg"
                alt="BDE — PR Station"
                width={320}
                height={200}
                className="w-full h-auto"
              />
            </WindowFrame>
            <p className="mt-2.5 text-center text-[11px] text-v2-text-tertiary">
              PR Station
            </p>
          </div>
        </div>

        {/* Mobile: single centered window */}
        <div className="mt-16 flex justify-center md:hidden">
          <WindowFrame size="md" glow title="Agents" className="!w-[300px] sm:!w-[340px]">
            <Image
              src="/screenshots/placeholder.svg"
              alt="BDE — Agents view"
              width={340}
              height={212}
              className="w-full h-auto"
            />
          </WindowFrame>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AppPreview.tsx
git commit -m "feat: rewrite AppPreview — 3 WindowFrames in fan layout"
```

---

### Task 8: TechStack Component (New)

**Files:**
- Create: `~/projects/bde-site/src/components/TechStack.tsx`

- [ ] **Step 1: Create TechStack component**

Create `~/projects/bde-site/src/components/TechStack.tsx`:

```tsx
import {
  ComputerDesktopIcon,
  CodeBracketIcon,
  CircleStackIcon,
  SparklesIcon,
  DocumentDuplicateIcon,
  CloudIcon,
} from "@heroicons/react/24/outline";

const STACK = [
  {
    icon: ComputerDesktopIcon,
    title: "Electron + React",
    description: "Native desktop app with web UI flexibility.",
  },
  {
    icon: CodeBracketIcon,
    title: "TypeScript",
    description: "Strict mode, end-to-end type safety.",
  },
  {
    icon: CircleStackIcon,
    title: "SQLite",
    description: "Local-first data — your data stays on your machine.",
  },
  {
    icon: SparklesIcon,
    title: "Claude Agent SDK",
    description: "Direct integration with Anthropic's agent SDK.",
  },
  {
    icon: DocumentDuplicateIcon,
    title: "Git Worktrees",
    description: "Each agent works in isolation — no branch conflicts.",
  },
  {
    icon: CloudIcon,
    title: "Supabase Sync",
    description: "Optional cloud sync for team sprint management.",
  },
];

export function TechStack() {
  return (
    <section id="tech-stack" className="bg-v2-background px-6 py-16 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[2px] text-v2-primary">
            Under the Hood
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.4px] text-v2-text-primary sm:text-4xl">
            Built on tools you trust
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-v2-text-secondary">
            Local-first, open architecture, clean code. No black boxes.
          </p>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {STACK.map((item) => (
            <div
              key={item.title}
              className="rounded-[20px] border border-white/[0.06] p-5 md:p-7 transition-colors duration-200 hover:border-white/[0.12]"
              style={{ background: "rgba(26, 26, 29, 0.8)" }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-v2-primary/12">
                <item.icon className="h-6 w-6 text-v2-primary" />
              </div>
              <h3 className="mt-4 text-[17px] font-semibold text-v2-text-primary">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-v2-text-secondary">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TechStack.tsx
git commit -m "feat: add TechStack section — 6 technology cards"
```

---

### Task 9: Comparison Component (New)

**Files:**
- Create: `~/projects/bde-site/src/components/Comparison.tsx`

- [ ] **Step 1: Create Comparison component**

Create `~/projects/bde-site/src/components/Comparison.tsx`:

```tsx
import { XMarkIcon, CheckIcon } from "@heroicons/react/24/solid";

const ROWS = [
  {
    without: "Juggle terminal tabs for each agent",
    with: "Unified workspace — all agents in one view",
  },
  {
    without: "Manually track agent output and errors",
    with: "Real-time monitoring with watchdog + status",
  },
  {
    without: "No dependency management between tasks",
    with: "Hard/soft deps, cycle detection, auto-blocking",
  },
  {
    without: "Copy-paste PRs into GitHub for review",
    with: "Built-in PR station with inline comments",
  },
  {
    without: "No visibility into token spend",
    with: "Cost dashboard with daily analytics",
  },
  {
    without: "Hope agents don't conflict on branches",
    with: "Automatic git worktree isolation",
  },
];

export function Comparison() {
  return (
    <section id="comparison" className="bg-v2-surface px-6 py-16 md:py-24">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[2px] text-v2-primary">
            Why BDE
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.4px] text-v2-text-primary sm:text-4xl">
            BDE vs. the terminal
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-v2-text-secondary">
            You can manage agents from a terminal. But should you?
          </p>
        </div>

        <div className="mt-16 overflow-hidden rounded-[20px] border border-white/[0.06]" style={{ background: "rgba(26, 26, 29, 0.8)" }}>
          {/* Column headers */}
          <div className="grid grid-cols-2 border-b border-white/[0.06] px-5 py-4 md:px-7">
            <p className="text-sm font-semibold text-v2-text-tertiary">Without BDE</p>
            <p className="text-sm font-semibold text-v2-primary">With BDE</p>
          </div>

          {/* Rows */}
          {ROWS.map((row, i) => (
            <div
              key={i}
              className={`grid grid-cols-2 px-5 py-4 md:px-7 ${i < ROWS.length - 1 ? "border-b border-white/[0.04]" : ""}`}
            >
              <div className="flex items-start gap-2.5 pr-4">
                <XMarkIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400/70" />
                <p className="text-sm leading-relaxed text-v2-text-secondary">{row.without}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-v2-primary" />
                <p className="text-sm leading-relaxed text-v2-text-primary">{row.with}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Comparison.tsx
git commit -m "feat: add Comparison section — BDE vs terminal table"
```

---

### Task 10: Waitlist, ComingSoon, and Footer Components

**Files:**
- Modify: `~/projects/bde-site/src/components/Waitlist.tsx`
- Modify: `~/projects/bde-site/src/components/ComingSoon.tsx`
- Modify: `~/projects/bde-site/src/components/Footer.tsx`
- Modify: `~/projects/bde-site/src/app/api/waitlist/route.ts`

- [ ] **Step 1: Update Waitlist copy**

In `src/components/Waitlist.tsx`, make these changes:

1. Change both `bg-v2-surface` classes (main section and success state) to `bg-v2-background` per spec (section 8 background is `#050505`).
2. In the success state, change "your future team is already looking forward to meeting you" to "We'll let you know when it's ready."
3. In the heading, change "Be the first to try Feast" to "Be the first to try BDE"
4. In the subtext, change "Feast is currently in private beta. Join our waitlist for early access — we'll send you an invite when your spot opens up." to "BDE is in early development. Join the waitlist for early access — we'll send you an invite when it's ready."
5. Update the mailto fallback to use subject `BDE%20Waitlist` instead of `Feast%20Waitlist`.

- [ ] **Step 2: Update waitlist API source**

In `src/app/api/waitlist/route.ts`, change `source: "landing-page"` to `source: "bde"`.

- [ ] **Step 3: Update ComingSoon**

In `src/components/ComingSoon.tsx`:
1. Change `FEAST` to `BDE`
2. Change "Something delicious is cooking." to "Something powerful is building." with second line in green: `<span className="text-v2-primary">is building.</span>`
3. Change description to "We're putting the finishing touches on BDE — a desktop IDE for agent-driven development. Check back soon."

- [ ] **Step 4: Update Footer**

In `src/components/Footer.tsx`:
1. Change `FEAST` wordmark to `BDE`
2. Change tagline to "The development environment for the age of agents."
3. Remove the `Contact` mailto link (not in spec). Keep Privacy and Terms.
4. Add a GitHub link alongside remaining links:
5. Ensure copyright says "R.B Technologies" (no LLC) to match spec.

```tsx
<a
  href="https://github.com/RyanJBirkeland/BDE"
  className="transition-colors duration-200 hover:text-v2-primary"
  target="_blank"
  rel="noopener noreferrer"
>
  GitHub
</a>
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Waitlist.tsx src/components/ComingSoon.tsx src/components/Footer.tsx src/app/api/waitlist/route.ts
git commit -m "feat: update Waitlist, ComingSoon, Footer for BDE"
```

---

### Task 11: Page Assembly and Feature Flag

**Files:**
- Modify: `~/projects/bde-site/src/app/page.tsx`
- Delete: `~/projects/bde-site/src/components/Personas.tsx`
- Delete: `~/projects/bde-site/src/components/PhoneMockup.tsx`

- [ ] **Step 1: Rewrite page.tsx with all sections and feature flag**

Replace the full contents of `src/app/page.tsx`:

```tsx
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { AppPreview } from "@/components/AppPreview";
import { TechStack } from "@/components/TechStack";
import { Comparison } from "@/components/Comparison";
import { Waitlist } from "@/components/Waitlist";
import { Footer } from "@/components/Footer";
import { ComingSoon } from "@/components/ComingSoon";

const IS_LIVE = process.env.NEXT_PUBLIC_SITE_LIVE === "true";

export default function Home() {
  if (!IS_LIVE) {
    return <ComingSoon />;
  }

  return (
    <>
      <Header />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <AppPreview />
        <TechStack />
        <Comparison />
        <Waitlist />
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Delete old feast-only components**

```bash
rm ~/projects/bde-site/src/components/Personas.tsx
rm ~/projects/bde-site/src/components/PhoneMockup.tsx
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: assemble all BDE sections + feature flag gate + remove feast components"
```

---

### Task 12: Build Verification and Cleanup

**Files:**
- Possibly modify any file with build errors

- [ ] **Step 1: Run typecheck**

```bash
cd ~/projects/bde-site && npx tsc --noEmit
```

Expected: No TypeScript errors. If there are errors, fix them.

- [ ] **Step 2: Run build**

```bash
cd ~/projects/bde-site && npm run build
```

Expected: Build completes successfully.

- [ ] **Step 3: Run dev server and visually verify**

```bash
cd ~/projects/bde-site && npm run dev
```

Open `http://localhost:3000` and verify:
- Coming soon screen appears (no `NEXT_PUBLIC_SITE_LIVE` env var)
- With `NEXT_PUBLIC_SITE_LIVE=true npm run dev`, all 9 sections render
- Mobile responsive (375px viewport)
- Glass morphism and green accents render correctly
- Waitlist form submits (or shows error if no Supabase env vars)

- [ ] **Step 4: Delete any remaining feast-specific files**

Check for leftover feast references:

```bash
grep -r "Feast\|feast\|FEAST" ~/projects/bde-site/src/ --include="*.tsx" --include="*.ts" -l
```

Fix any remaining references.

- [ ] **Step 5: Remove feast-site privacy/terms pages if not needed yet**

```bash
ls ~/projects/bde-site/src/app/privacy/ ~/projects/bde-site/src/app/terms/
```

If these exist and contain feast-specific legal text, either delete them or stub them out with BDE-appropriate content. For now, delete them:

```bash
rm -rf ~/projects/bde-site/src/app/privacy ~/projects/bde-site/src/app/terms
```

- [ ] **Step 6: Final commit**

```bash
cd ~/projects/bde-site
git add -A
git commit -m "chore: build verification and feast cleanup"
```

---

### Task 13: GitHub Repo and CLAUDE.md

**Files:**
- Create: `~/projects/bde-site/CLAUDE.md`

- [ ] **Step 1: Create GitHub repo**

```bash
cd ~/projects/bde-site
gh repo create RyanJBirkeland/bde-site --private --source=. --push
```

- [ ] **Step 2: Create CLAUDE.md**

Create `~/projects/bde-site/CLAUDE.md`:

```markdown
# CLAUDE.md — BDE Site

@../../ARCHITECTURE.md

Marketing landing page for BDE — the desktop IDE for agent-driven development.

## Project Context

- **Domain:** TBD
- **Hosting:** Vercel (auto-deploys from `main`)
- **Company:** R.B Technologies LLC
- **BDE app repo:** `~/projects/BDE` (Electron desktop app)

## Design System

Dark theme matching feast-site and BDE app. No light mode.

- **Background:** `#050505` / Surface: `#111113` / Card: `#1A1A1D`
- **Brand green:** `#00D37F` (primary), `#00A863` (gradient end)
- **Text:** `#F5F5F7` (primary), `#98989F` (secondary), `#5C5C63` (tertiary)
- **Font:** Inter (via next/font/google)
- **Icons:** Heroicons (outline) — no emojis
- **CSS tokens:** `v2-` prefix (e.g., `--color-v2-background`)

## Commands

```bash
npm run dev      # Dev server on :3000
npm run build    # Production build
npm run lint     # ESLint
```

## Feature Flags

- `NEXT_PUBLIC_SITE_LIVE` — `"true"` shows full site, anything else shows coming soon screen
- `NEXT_PUBLIC_SHOW_INFO_LINKS` — `"true"` shows Privacy/Terms in footer

## Waitlist

- **Supabase project:** iorjhnpjpqimklrpwimf
- **Table:** `waitlist` (email, source, created_at)
- **Source value:** `"bde"` — distinguishes from feast waitlist entries
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Screenshots

Placeholder SVG at `public/screenshots/placeholder.svg`. Replace with real BDE captures before launch:

| File | View |
|------|------|
| `sprint-kanban.png` | Sprint board — Kanban with tasks |
| `agents-view.png` | Agents — active agents with status |
| `pr-list.png` | PR Station — list with CI badges |
| `pr-diff.png` | PR Station — diff viewer |

## Component Gotchas

- **WindowFrame width overrides:** Like PhoneMockup, uses size lookup. Override with `!important` (e.g., `className="!w-[300px]"`).
- **Hero `pt-32`:** Asymmetric padding for fixed header clearance. Don't replace with `py-*`.
```

- [ ] **Step 3: Commit and push**

```bash
cd ~/projects/bde-site
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md for bde-site"
git push origin main
```
