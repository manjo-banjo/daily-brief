"""Step 1 (local trigger) — run fetch, filter and rank, then print and save the ranked list.

    python -m pipeline.run            # run now
    python -m pipeline.run --quiet    # save the JSON only

Writes out/ranked-YYYY-MM-DD.json (not committed). Summaries, quiz and the real
data/daily file arrive in session 2.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from typing import Dict, List

from .config import ROOT, load_sources, load_topics
from .fetch import fetch_all
from .filter import filter_items, load_used_urls
from .models import Item
from .rank import rank_and_allocate


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
    parser = argparse.ArgumentParser(description="Daily brief: fetch, filter, rank.")
    parser.add_argument("--quiet", action="store_true", help="do not print the report")
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

    failed = [r for r in reports if not r.ok]
    return 1 if len(failed) == len(reports) else 0


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
