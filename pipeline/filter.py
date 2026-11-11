"""Step 3 — drop old items, duplicates and anything used on a previous day."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Set, Tuple

from .models import Item, Settings, Source
from .text import canonical_url, keyword_pattern, title_similarity


def load_used_urls(daily_dir: Path, today: str) -> Set[str]:
    """URLs of stories already published in earlier daily files (data/daily/*.json)."""
    used: Set[str] = set()
    if not daily_dir.exists():
        return used
    for path in sorted(daily_dir.glob("*.json")):
        if path.stem >= today:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for story in data.get("stories", []):
            if story.get("url"):
                used.add(canonical_url(story["url"]))
    return used


def filter_items(
    items: List[Item],
    sources: Dict[str, Source],
    settings: Settings,
    now: datetime,
    used_urls: Set[str],
) -> Tuple[List[Item], Dict[str, int]]:
    stats = {"fetched": len(items), "no_date": 0, "too_old": 0, "already_used": 0,
             "excluded_title": 0,
             "duplicate_url": 0, "duplicate_title": 0}
    cutoff = now - timedelta(hours=settings.max_age_hours)

    fresh: List[Item] = []
    for item in items:
        if item.published is None:
            stats["no_date"] += 1  # age cannot be checked, so it cannot be trusted as news
        elif item.published < cutoff:
            stats["too_old"] += 1
        elif any(keyword_pattern(k).search(item.title) for k in settings.exclude_title_keywords):
            stats["excluded_title"] += 1
        elif canonical_url(item.url) in used_urls:
            stats["already_used"] += 1
        else:
            fresh.append(item)

    # Strongest source first, so the copy that survives a duplicate clash is the best one.
    fresh.sort(key=lambda i: (-sources[i.source_id].weight, -len(i.text), i.position))

    kept: List[Item] = []
    seen_urls: Set[str] = set()
    for item in fresh:
        url = canonical_url(item.url)
        if url in seen_urls:
            stats["duplicate_url"] += 1
            continue
        if any(title_similarity(item.title, other.title) >= settings.title_similarity for other in kept):
            stats["duplicate_title"] += 1
            continue
        seen_urls.add(url)
        kept.append(item)

    stats["kept"] = len(kept)
    return kept, stats
