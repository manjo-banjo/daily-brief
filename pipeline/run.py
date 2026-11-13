"""Step 1 (trigger) — run the whole pipeline: fetch, filter, rank, summarise, quiz, validate, write.

    python -m pipeline.run               # build today's brief and write it to data/
    python -m pipeline.run --dry-run     # write the brief to out/ only; data/ is not touched
    python -m pipeline.run --no-llm      # skip the LLM step: headlines-only brief
    python -m pipeline.run --print-brief # also print the finished brief JSON
    python -m pipeline.run --quiet       # no ranking report

Always writes out/ranked-YYYY-MM-DD.json (not committed) for review. Any failure in the LLM
step still publishes a headlines-only brief.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Optional

from .config import ROOT, load_sources, load_topics
from .fetch import fetch_all
from .filter import filter_items, load_used_urls
from .llm import LLM
from .models import BriefStory, DailyBrief, Item, MarketIdea, Topic
from .output import append_archive, build_brief, build_stories, headlines_only, prune_daily, write_daily
from .quiz import write_quiz
from .rank import rank_and_allocate
from .summarise import summarise_topic


def _age(item: Item, now: datetime) -> str:
    hours = (now - item.published).total_seconds() / 3600
    return f"{hours:.0f}h"


def _story(item: Item) -> dict:
    return {
        "title": item.title,
        "url": item.url,
        "source": item.source,
        "source_id": item.source_id,
        "published": item.published.isoformat() if item.published else None,
        "topic": item.topic,
        "subtopic": item.subtopic,
        "access": item.access,
        "score": item.score,
        "score_parts": item.score_parts,
        "matched_keywords": item.matched_keywords,
        "text": item.text,
    }


def main(argv: List[str] = None) -> int:
    parser = argparse.ArgumentParser(description="Daily brief: build today's brief and quiz.")
    parser.add_argument("--quiet", action="store_true", help="do not print the ranking report")
    parser.add_argument("--dry-run", action="store_true", help="write the brief to out/ and leave data/ alone")
    parser.add_argument("--no-llm", action="store_true", help="skip summaries and quiz (headlines only)")
    parser.add_argument("--print-brief", action="store_true", help="print the finished brief JSON")
    args = parser.parse_args(argv)

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    settings, topics = load_topics()
    source_list = load_sources(topics)
    sources = {s.id: s for s in source_list}

    items, reports = fetch_all(source_list)
    used = load_used_urls(ROOT / "data" / "daily", today)
    kept, stats = filter_items(items, sources, settings, now, used)
    selected, runners, untagged, cross_dupes = rank_and_allocate(kept, sources, topics, settings, now)
    stats["untagged"] = untagged
    stats["cross_topic_duplicates"] = cross_dupes

    total = sum(len(v) for v in selected.values())
    output = {
        "date": today,
        "generated_at": now.isoformat(timespec="seconds"),
        "story_count": total,
        "filter_stats": stats,
        "sources": [r.model_dump() for r in reports],
        "skipped_sources": [{"id": s.id, "name": s.name, "reason": s.reason}
                            for s in source_list if not s.enabled],
        "topics": {
            name: {
                "label": topics[name].label,
                "slots": topics[name].slots,
                "stories": [_story(i) for i in selected[name]],
                "runners_up": [_story(i) for i in runners.get(name, [])],
            }
            for name in topics
        },
    }
    out_dir = ROOT / "out"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"ranked-{today}.json"
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")

    if not args.quiet:
        _print_report(now, reports, source_list, stats, topics, selected, runners, total)
        print(f"\nSaved {out_path.relative_to(ROOT)}")

    if total == 0:
        print("No stories found (every source failed or nothing was fresh); no brief written.")
        return 1

    brief = make_brief(today, now.isoformat(timespec="seconds"), topics, selected, use_llm=not args.no_llm)

    if args.dry_run:
        path = out_dir / f"brief-{today}.json"
        path.write_text(json.dumps(brief.model_dump(mode="json"), indent=2, ensure_ascii=False), encoding="utf-8")
        written = [path]
        removed: List[str] = []
    else:
        daily_dir = ROOT / "data" / "daily"
        written = [write_daily(brief, daily_dir), append_archive(brief, ROOT / "data" / "archive")]
        removed = prune_daily(daily_dir, today)

    _report_brief(brief, [str(p.relative_to(ROOT)) for p in written], removed, reports)
    if args.print_brief:
        print("\n" + json.dumps(brief.model_dump(mode="json"), indent=2, ensure_ascii=False))
    return 0


def make_brief(today: str, generated_at: str, topics: Dict[str, Topic],
               selected: Dict[str, List[Item]], use_llm: bool = True, llm: Optional[LLM] = None) -> DailyBrief:
    """Steps 5–7. Whatever goes wrong in the LLM step, a headlines-only brief still comes back."""
    llm = llm or LLM()
    stories, texts = build_stories(selected)
    idea: Optional[MarketIdea] = None
    quiz = []
    issues: List[str] = []
    try:
        if not use_llm:
            issues.append("LLM step skipped (--no-llm)")
        else:
            for topic_id, topic in topics.items():
                topic_idea, topic_issues = summarise_topic(
                    llm, topic_id, topic, [s for s in stories if s.topic == topic_id], texts)
                idea = idea or topic_idea
                issues += topic_issues
            quiz, quiz_issues = write_quiz(llm, today, stories, idea)
            issues += quiz_issues
        return build_brief(today, generated_at, topics, stories, idea, quiz, llm, issues)
    except Exception as exc:  # the habit must not break on a bad day
        issues.append(f"LLM step failed, published headlines only: {type(exc).__name__}: {str(exc)[:300]}")
        return build_brief(today, generated_at, topics, headlines_only(stories), None, [], llm, issues)


def _report_brief(brief: DailyBrief, written: List[str], removed: List[str], reports) -> None:
    summarised = sum(1 for s in brief.stories if not s.headline_only)
    why = sum(1 for q in brief.quiz if q.tests == "why")
    failed = [r.name for r in reports if not r.ok]
    lines = [
        f"Brief {brief.date}: {brief.status}",
        f"Stories: {len(brief.stories)} ({summarised} summarised, {len(brief.stories) - summarised} headline and link only)",
        f"Market idea: {'yes' if brief.market_idea else 'no'}",
        f"Quiz: {len(brief.quiz)} questions ({why} test the why)",
        f"Read time: about {brief.read_minutes} min",
        f"LLM: {brief.llm.provider} / {brief.llm.model}, {brief.llm.calls} calls",
        f"Sources failed: {len(failed)} of {len(reports)}" + (f" ({', '.join(failed)})" if failed else ""),
        f"Written: {', '.join(written)}" + (f"; pruned: {', '.join(removed)}" if removed else ""),
    ] + [f"Issue: {issue}" for issue in brief.issues]
    print("\n" + "\n".join(lines))
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:  # shown on the run's page in GitHub Actions
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n".join(f"- {line}" for line in lines) + "\n")


def _print_report(now, reports, source_list, stats, topics, selected: Dict[str, List[Item]], runners, total):
    print(f"Daily brief — ranked story list — {now.strftime('%a %d %b %Y %H:%M')} UTC\n")
    print("SOURCES")
    for r in reports:
        status = f"ok   {r.items:>3} items" if r.ok else f"FAIL {r.error}"
        print(f"  {r.name:<34} {status}  ({r.via})")
    for s in source_list:
        if not s.enabled:
            print(f"  {s.name:<34} off  {s.reason}")
    print(
        f"\nFILTER  fetched {stats['fetched']} · older than cutoff {stats['too_old']} · "
        f"no date {stats['no_date']} · live blogs etc. {stats['excluded_title']} · already used {stats['already_used']} · "
        f"duplicates {stats['duplicate_url'] + stats['duplicate_title']} · kept {stats['kept']} · "
        f"no topic match {stats['untagged']} · same event under two topics (weaker copy removed) {stats['cross_topic_duplicates']}"
    )
    print(f"\nRANKED LIST  ({total} stories)")
    for name, topic in topics.items():
        picks = selected[name]
        print(f"\n{topic.label.upper()}  ({len(picks)}/{topic.slots} slots)")
        for i, item in enumerate(picks, 1):
            sub = f" · {item.subtopic}" if item.subtopic else ""
            flag = " · headline only" if item.access == "headline_only" else ""
            print(f"  {i}. {item.title}")
            print(f"     {item.source}{sub} · {_age(item, now)} old · score {item.score:.2f}{flag}")
            print(f"     {item.url}")
        if not picks:
            print("  (nothing qualified)")
        for item in runners.get(name, [])[:3]:
            print(f"     next: [{item.score:.2f}] {item.title[:90]} — {item.source}")


if __name__ == "__main__":
    sys.exit(main())
