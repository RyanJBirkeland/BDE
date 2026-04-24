"""
RCA audit — score every recent terminal-state task on a spec quality rubric,
cross-tab against outcome, and classify failure modes from agent_events.

Read-only against ~/.bde/bde.db. Outputs structured findings to stdout.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

DB_PATH = Path.home() / ".bde" / "bde.db"

MULTI_FILE_HEADER = "## Multi-File: true"
EXPLORE_VERBS = re.compile(r"\b(explore|investigate|find\s+(?:issues|bugs|problems)|figure\s+out|look\s+(?:into|at)|audit|survey)\b", re.IGNORECASE)
SECTION_HEADER_RX = re.compile(r"^##\s+", re.MULTILINE)
FILE_PATH_RX = re.compile(r"[\s`(`'\"]([a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|css|md|json|py|sql))\b")
SRC_PATH_RX = re.compile(r"[ /]src/")


@dataclass
class TaskRecord:
    id: str
    short_id: str
    status: str
    title: str
    spec: str
    prompt: str
    spec_type: str | None
    retry_count: int
    fast_fail_count: int
    failure_reason: str | None
    started_at: str | None
    completed_at: str | None
    duration_ms: int | None


@dataclass
class SpecQualityScore:
    word_count: int
    section_count: int
    distinct_file_paths: int
    src_path_density: int
    has_multi_file_header: bool
    has_files_to_change: bool
    has_how_to_test: bool
    has_explore_verb: bool
    spec_type_set: bool
    overall_quality: str  # 'good' | 'mediocre' | 'poor'


@dataclass
class AgentRunSummary:
    run_id: str
    status: str
    exit_code: int | None
    num_turns: int | None
    cost_usd: float | None
    duration_ms: int | None
    tokens_in: int | None
    tokens_out: int | None
    started_at: str | None
    finished_at: str | None
    failure_mode: str  # classified


@dataclass
class TaskFinding:
    task: TaskRecord
    quality: SpecQualityScore
    runs: list[AgentRunSummary]
    final_failure_mode: str
    primary_text: str  # spec or prompt, whichever was used


def _to_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _to_str_optional(value: Any) -> str | None:
    if value is None:
        return None
    return _to_str(value)


def load_terminal_tasks(conn: sqlite3.Connection) -> list[TaskRecord]:
    rows = conn.execute(
        """
        SELECT id, status, title, spec, prompt, spec_type, retry_count,
               fast_fail_count, failure_reason, started_at, completed_at,
               duration_ms
          FROM sprint_tasks
         WHERE status IN ('done','cancelled','failed','error')
         ORDER BY COALESCE(completed_at, started_at, created_at) DESC
        """
    ).fetchall()
    return [
        TaskRecord(
            id=_to_str(r[0]),
            short_id=_to_str(r[0])[:8],
            status=_to_str(r[1]),
            title=_to_str(r[2]),
            spec=_to_str(r[3]),
            prompt=_to_str(r[4]),
            spec_type=_to_str_optional(r[5]),
            retry_count=r[6] or 0,
            fast_fail_count=r[7] or 0,
            failure_reason=_to_str_optional(r[8]),
            started_at=_to_str_optional(r[9]),
            completed_at=_to_str_optional(r[10]),
            duration_ms=r[11],
        )
        for r in rows
    ]


def score_spec(text: str, spec_type: str | None) -> SpecQualityScore:
    word_count = len(text.split())
    section_count = len(SECTION_HEADER_RX.findall(text))
    file_paths = set(FILE_PATH_RX.findall(text))
    src_density = len(SRC_PATH_RX.findall(text))
    has_header = MULTI_FILE_HEADER in text
    has_files = "## Files to Change" in text or "## Files To Change" in text
    has_test = "## How to Test" in text or "## How To Test" in text
    has_explore = bool(EXPLORE_VERBS.search(text))

    score = 0
    if word_count >= 80:
        score += 1
    if section_count >= 2:
        score += 1
    if len(file_paths) >= 1:
        score += 1
    if has_files:
        score += 1
    if has_test:
        score += 1
    if not has_explore:
        score += 1
    if spec_type:
        score += 1

    overall = "good" if score >= 6 else "mediocre" if score >= 3 else "poor"

    return SpecQualityScore(
        word_count=word_count,
        section_count=section_count,
        distinct_file_paths=len(file_paths),
        src_path_density=src_density,
        has_multi_file_header=has_header,
        has_files_to_change=has_files,
        has_how_to_test=has_test,
        has_explore_verb=has_explore,
        spec_type_set=spec_type is not None,
        overall_quality=overall,
    )


def classify_failure_mode(events: list[tuple[str, str]], run_status: str, exit_code: int | None) -> str:
    """Classify a single agent run's failure mode from its events."""
    if run_status == "done" and (exit_code == 0 or exit_code is None):
        return "success"

    error_msgs: list[str] = []
    for event_type, payload_str in events:
        if event_type == "agent:error":
            try:
                payload = json.loads(payload_str)
                msg = payload.get("message", "")
                error_msgs.append(msg)
            except json.JSONDecodeError:
                continue

    joined = " | ".join(error_msgs).lower()

    # Order matters: most-specific first.
    if "executable not found" in joined or "claude code executable" in joined:
        return "env_cli_not_found"
    if "max_turns_exceeded" in joined or "max turns" in joined:
        return "out_of_turns"
    if "stream interrupted" in joined:
        return "stream_interrupted"
    if "stream error" in joined:
        return "stream_error"
    if "watchdog" in joined or "timeout" in joined:
        return "watchdog_timeout"
    if "no_commits" in joined or "no commits" in joined:
        return "no_commits"
    if error_msgs:
        return f"other_error: {error_msgs[0][:60]}"
    if run_status == "failed":
        return "failed_no_event"
    if run_status == "running":
        return "stalled_running"
    return f"unknown ({run_status}, exit={exit_code})"


def load_runs_for_task(conn: sqlite3.Connection, task_id: str) -> list[AgentRunSummary]:
    runs = conn.execute(
        """
        SELECT id, status, exit_code, num_turns, cost_usd, duration_ms,
               tokens_in, tokens_out, started_at, finished_at
          FROM agent_runs
         WHERE sprint_task_id = ?
         ORDER BY started_at ASC
        """,
        (task_id,),
    ).fetchall()

    summaries: list[AgentRunSummary] = []
    for r in runs:
        run_id = r[0]
        events = conn.execute(
            "SELECT event_type, payload FROM agent_events WHERE agent_id = ? ORDER BY timestamp ASC",
            (run_id,),
        ).fetchall()
        mode = classify_failure_mode(events, r[1], r[2])
        summaries.append(
            AgentRunSummary(
                run_id=run_id,
                status=r[1],
                exit_code=r[2],
                num_turns=r[3],
                cost_usd=r[4],
                duration_ms=r[5],
                tokens_in=r[6],
                tokens_out=r[7],
                started_at=r[8],
                finished_at=r[9],
                failure_mode=mode,
            )
        )
    return summaries


def derive_final_mode(task_status: str, runs: list[AgentRunSummary]) -> str:
    if task_status == "done":
        return "success"
    if task_status == "cancelled" and not runs:
        return "user_cancelled_no_run"
    if not runs:
        return f"no_runs ({task_status})"
    return runs[-1].failure_mode


def build_findings(conn: sqlite3.Connection) -> list[TaskFinding]:
    tasks = load_terminal_tasks(conn)
    findings: list[TaskFinding] = []
    for t in tasks:
        primary = t.spec if t.spec else t.prompt
        quality = score_spec(primary, t.spec_type)
        runs = load_runs_for_task(conn, t.id)
        final_mode = derive_final_mode(t.status, runs)
        findings.append(TaskFinding(
            task=t,
            quality=quality,
            runs=runs,
            final_failure_mode=final_mode,
            primary_text=primary,
        ))
    return findings


def cross_tab_quality_outcome(findings: list[TaskFinding]) -> dict[str, dict[str, int]]:
    table: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for f in findings:
        table[f.quality.overall_quality][f.task.status] += 1
    return {q: dict(v) for q, v in table.items()}


def cross_tab_failure_mode_quality(findings: list[TaskFinding]) -> dict[str, dict[str, int]]:
    table: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for f in findings:
        table[f.final_failure_mode][f.quality.overall_quality] += 1
    return {m: dict(v) for m, v in table.items()}


def turn_budget_eligibility(findings: list[TaskFinding]) -> dict[str, Any]:
    """How many tasks would qualify for 75-turn budget by header vs structural cues?"""
    has_header = 0
    would_qualify_via_density = 0
    only_30_turns = 0
    for f in findings:
        text = f.primary_text
        if MULTI_FILE_HEADER in text:
            has_header += 1
            continue
        lower = text.lower()
        density = len(SRC_PATH_RX.findall(text))
        is_mixed_stack = ".tsx" in lower and ".css" in lower
        if is_mixed_stack or density >= 3:
            would_qualify_via_density += 1
        else:
            only_30_turns += 1
    return {
        "explicit_75_turn_header": has_header,
        "auto_50_turn_via_density_or_mixed_stack": would_qualify_via_density,
        "default_30_turn_budget": only_30_turns,
    }


def under_budgeted_failures(findings: list[TaskFinding]) -> list[TaskFinding]:
    """Tasks that ran out of turns AND lacked the 75-turn header."""
    out: list[TaskFinding] = []
    for f in findings:
        if any(r.failure_mode == "out_of_turns" for r in f.runs):
            if MULTI_FILE_HEADER not in f.primary_text:
                out.append(f)
    return out


def turn_distribution_of_successes(findings: list[TaskFinding]) -> dict[str, int]:
    """Bucket num_turns of successful runs to check how close they hit the cap."""
    buckets = {"<=20": 0, "21-30": 0, "31-50": 0, "51-70": 0, "71-76": 0, "unknown": 0}
    for f in findings:
        for r in f.runs:
            if r.failure_mode != "success":
                continue
            n = r.num_turns
            if n is None:
                buckets["unknown"] += 1
            elif n <= 20:
                buckets["<=20"] += 1
            elif n <= 30:
                buckets["21-30"] += 1
            elif n <= 50:
                buckets["31-50"] += 1
            elif n <= 70:
                buckets["51-70"] += 1
            else:
                buckets["71-76"] += 1
    return buckets


def runs_lost_to_env(findings: list[TaskFinding]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for f in findings:
        for r in f.runs:
            if r.failure_mode == "env_cli_not_found":
                counts[f.task.short_id] += 1
    return dict(counts)


def header_gap_analysis(findings: list[TaskFinding]) -> dict[str, Any]:
    """How many tasks would arguably qualify for the 75-turn budget but lack the header?"""
    qualifies_by_density = 0
    has_header = 0
    truly_small = 0
    misclassified_arguable: list[dict[str, Any]] = []
    for f in findings:
        text = f.primary_text
        density = len(SRC_PATH_RX.findall(text))
        files = f.quality.distinct_file_paths
        if MULTI_FILE_HEADER in text:
            has_header += 1
            continue
        likely_multi_file = files >= 3 or density >= 3 or "## Files to Change" in text
        if not likely_multi_file:
            truly_small += 1
            continue
        qualifies_by_density += 1
        misclassified_arguable.append({
            "short_id": f.task.short_id,
            "title": f.task.title[:80],
            "files": files,
            "src_density": density,
            "outcome": f.task.status,
            "max_turns_in_runs": [r.num_turns for r in f.runs if r.num_turns],
            "needed_retries": len(f.runs) > 1,
        })
    return {
        "with_header": has_header,
        "without_header_but_likely_multi_file": qualifies_by_density,
        "without_header_truly_small": truly_small,
        "candidates": misclassified_arguable,
    }


def cost_summary(findings: list[TaskFinding]) -> dict[str, Any]:
    total = 0.0
    by_outcome: dict[str, float] = defaultdict(float)
    by_mode: dict[str, float] = defaultdict(float)
    runs_total = 0
    for f in findings:
        for r in f.runs:
            cost = r.cost_usd or 0.0
            total += cost
            by_outcome[f.task.status] += cost
            by_mode[r.failure_mode] += cost
            runs_total += 1
    return {
        "total_usd": round(total, 2),
        "runs_observed": runs_total,
        "by_task_status": {k: round(v, 2) for k, v in by_outcome.items()},
        "by_failure_mode": {k: round(v, 2) for k, v in by_mode.items()},
    }


def main() -> None:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.text_factory = lambda b: b.decode("utf-8", errors="replace") if isinstance(b, bytes) else b
    findings = build_findings(conn)

    print(f"=== RCA Audit: {len(findings)} terminal-state tasks ===\n")

    print("== Quality × Final Status ==")
    qx = cross_tab_quality_outcome(findings)
    for q in ("good", "mediocre", "poor"):
        if q in qx:
            print(f"  {q:9s}: {qx[q]}")
    print()

    print("== Failure Mode × Spec Quality ==")
    fmx = cross_tab_failure_mode_quality(findings)
    for mode, by_q in sorted(fmx.items(), key=lambda kv: -sum(kv[1].values())):
        total = sum(by_q.values())
        print(f"  {mode:35s} (n={total}): {by_q}")
    print()

    print("== Turn-Budget Eligibility ==")
    elig = turn_budget_eligibility(findings)
    for k, v in elig.items():
        print(f"  {k}: {v}")
    print()

    print("== Out-of-Turns Failures Without Multi-File Header ==")
    underbudget = under_budgeted_failures(findings)
    print(f"  Count: {len(underbudget)}")
    for f in underbudget[:10]:
        nturns = [r.num_turns for r in f.runs if r.num_turns]
        density = len(SRC_PATH_RX.findall(f.primary_text))
        print(f"  - {f.task.short_id} ({f.task.status}, retries={f.task.retry_count}) "
              f"turns={nturns} src/density={density} q={f.quality.overall_quality}")
        print(f"      title: {f.task.title[:90]}")
    print()

    print("== Turn Distribution of Successful Runs ==")
    td = turn_distribution_of_successes(findings)
    for bucket, n in td.items():
        print(f"  {bucket:8s}: {n}")
    print()

    print("== Runs Lost to Env (CLI not found) ==")
    env_lost = runs_lost_to_env(findings)
    print(f"  Total runs killed by env: {sum(env_lost.values())} across {len(env_lost)} tasks")
    for task_id, n in sorted(env_lost.items(), key=lambda kv: -kv[1]):
        print(f"  - {task_id}: {n} runs")
    print()

    print("== Header Gap Analysis ==")
    hga = header_gap_analysis(findings)
    print(f"  Tasks with `## Multi-File: true`:                         {hga['with_header']}")
    print(f"  Tasks WITHOUT header but >=3 files (likely multi-file):  {hga['without_header_but_likely_multi_file']}")
    print(f"  Tasks WITHOUT header AND truly small:                    {hga['without_header_truly_small']}")
    print()
    print("  Candidates that should have had the header:")
    for c in hga["candidates"]:
        print(f"    - {c['short_id']} ({c['outcome']}, retries={c['needed_retries']}) "
              f"files={c['files']} src/={c['src_density']} turns={c['max_turns_in_runs']}: {c['title']}")
    print()

    print("== Cost Summary ==")
    cs = cost_summary(findings)
    print(f"  Total observed spend: ${cs['total_usd']}  ({cs['runs_observed']} runs)")
    print(f"  By task status: {cs['by_task_status']}")
    print(f"  Top failure-mode burns:")
    for mode, cost in sorted(cs["by_failure_mode"].items(), key=lambda kv: -kv[1])[:6]:
        print(f"    {mode:35s}  ${cost:.2f}")
    print()

    print("== Per-Task Detail ==")
    print(f"{'short_id':10s} {'status':10s} {'qual':9s} "
          f"{'words':5s} {'sects':5s} {'paths':5s} "
          f"{'hdr':3s} {'files':5s} {'test':4s} {'expl':4s} "
          f"{'retries':7s} {'mode':30s} title")
    for f in findings:
        q = f.quality
        title = f.task.title[:50]
        print(f"{f.task.short_id:10s} {f.task.status:10s} {q.overall_quality:9s} "
              f"{q.word_count:5d} {q.section_count:5d} {q.distinct_file_paths:5d} "
              f"{('Y' if q.has_multi_file_header else 'n'):3s} "
              f"{('Y' if q.has_files_to_change else 'n'):5s} "
              f"{('Y' if q.has_how_to_test else 'n'):4s} "
              f"{('Y' if q.has_explore_verb else 'n'):4s} "
              f"{f.task.retry_count:7d} {f.final_failure_mode:30s} {title}")

    # JSON dump for downstream consumption
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if out_path:
        payload = {
            "task_count": len(findings),
            "quality_x_status": qx,
            "failure_mode_x_quality": fmx,
            "turn_budget_eligibility": elig,
            "out_of_turns_without_header": [
                {
                    "id": f.task.id,
                    "short_id": f.task.short_id,
                    "status": f.task.status,
                    "title": f.task.title,
                    "retry_count": f.task.retry_count,
                    "spec_quality": asdict(f.quality),
                    "runs": [asdict(r) for r in f.runs],
                }
                for f in underbudget
            ],
            "cost_summary": cs,
            "tasks": [
                {
                    "id": f.task.id,
                    "short_id": f.task.short_id,
                    "status": f.task.status,
                    "title": f.task.title,
                    "failure_mode": f.final_failure_mode,
                    "spec_quality": asdict(f.quality),
                    "run_count": len(f.runs),
                    "retries": f.task.retry_count,
                }
                for f in findings
            ],
        }
        out_path.write_text(json.dumps(payload, indent=2, default=str))
        print(f"\nWrote JSON to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
