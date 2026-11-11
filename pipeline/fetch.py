"""Step 2 — fetch every enabled source and normalise to title, URL, source, time, text."""
from __future__ import annotations

import calendar
import html
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import List, Optional, Tuple

import feedparser
import httpx

from .models import Item, Source, SourceReport
from .text import clean_url, keyword_pattern

USER_AGENT = "daily-brief/0.1 (personal news digest; RSS reader)"
TIMEOUT = httpx.Timeout(20.0, connect=10.0)
MAX_TEXT_CHARS = 4000
GUARDIAN_API = "https://content.guardianapis.com/search"

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def clean_text(raw: Optional[str]) -> str:
    """Strip HTML tags and tidy whitespace."""
    if not raw:
        return ""
    return _SPACE.sub(" ", html.unescape(_TAG.sub(" ", raw))).strip()[:MAX_TEXT_CHARS]


def _entry_time(entry) -> Optional[datetime]:
    for key in ("published_parsed", "updated_parsed"):
        parsed = entry.get(key)
        if parsed:
            return datetime.fromtimestamp(calendar.timegm(parsed), tz=timezone.utc)
    return None


def _entry_text(entry) -> str:
    best = entry.get("summary", "") or ""
    for content in entry.get("content", []) or []:
        value = content.get("value", "")
        if len(value) > len(best):
            best = value
    return clean_text(best)


def _make_item(source: Source, title: str, url: str, published, text: str, position: int) -> Optional[Item]:
    title = clean_text(title)
    if not title or not url:
        return None
    return Item(
        title=title,
        url=clean_url(url),
        source_id=source.id,
        source=source.name,
        published=published,
        # Paywalled / headline-only sources: never carry article text forward.
        text="" if source.access == "headline_only" else text,
        access=source.access,
        position=position,
    )


def fetch_rss(client: httpx.Client, source: Source) -> List[Item]:
    response = client.get(source.url)
    response.raise_for_status()
    feed = feedparser.parse(response.content)
    if not feed.entries:
        raise ValueError("feed parsed but contains no entries")
    items = []
    for position, entry in enumerate(feed.entries):
        item = _make_item(
            source, entry.get("title", ""), entry.get("link", ""),
            _entry_time(entry), _entry_text(entry), position,
        )
        if item:
            items.append(item)
    return items


def fetch_guardian_api(client: httpx.Client, source: Source, api_key: str) -> List[Item]:
    response = client.get(
        GUARDIAN_API,
        params={
            "section": source.section,
            "order-by": "newest",
            "page-size": 50,
            "show-fields": "trailText,bodyText",
            "api-key": api_key,
        },
    )
    if response.status_code != 200:
        # Never surface the request URL: it contains the API key.
        raise ValueError(f"Guardian API returned HTTP {response.status_code}")
    items = []
    for position, result in enumerate(response.json()["response"]["results"]):
        fields = result.get("fields", {}) or {}
        published = None
        if result.get("webPublicationDate"):
            published = datetime.fromisoformat(result["webPublicationDate"].replace("Z", "+00:00"))
        item = _make_item(
            source, result.get("webTitle", ""), result.get("webUrl", ""), published,
            clean_text(fields.get("bodyText") or fields.get("trailText")), position,
        )
        if item:
            items.append(item)
    return items


def fetch_hackernews(client: httpx.Client, source: Source) -> List[Item]:
    response = client.get(source.url)
    response.raise_for_status()
    patterns = [keyword_pattern(k) for k in source.require_keywords]
    items = []
    for position, hit in enumerate(response.json().get("hits", [])):
        title = hit.get("title") or ""
        if patterns and not any(p.search(title) for p in patterns):
            continue
        url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        published = None
        if hit.get("created_at"):
            published = datetime.fromisoformat(hit["created_at"].replace("Z", "+00:00"))
        item = _make_item(source, title, url, published, "", position)
        if item:
            items.append(item)
    return items


def fetch_source(source: Source) -> Tuple[List[Item], SourceReport]:
    report = SourceReport(id=source.id, name=source.name, topic=source.topic, ok=False)
    try:
        with httpx.Client(
            timeout=TIMEOUT, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        ) as client:
            if source.type == "guardian":
                api_key = os.environ.get("GUARDIAN_API_KEY", "").strip()
                if api_key:
                    report.via = "guardian-api"
                    items = fetch_guardian_api(client, source, api_key)
                else:
                    report.via = "rss-fallback"
                    items = fetch_rss(client, source)
            elif source.type == "hackernews":
                report.via = "hn-api"
                items = fetch_hackernews(client, source)
            else:
                report.via = "rss"
                items = fetch_rss(client, source)
        report.ok = True
        report.items = len(items)
        return items, report
    except httpx.HTTPStatusError as exc:
        report.error = f"HTTP {exc.response.status_code}"
    except httpx.HTTPError as exc:
        report.error = type(exc).__name__
    except Exception as exc:  # one bad source must never stop the run
        report.error = f"{type(exc).__name__}: {exc}"[:200]
    return [], report


def fetch_all(sources: List[Source]) -> Tuple[List[Item], List[SourceReport]]:
    enabled = [s for s in sources if s.enabled]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(fetch_source, enabled))
    items = [item for batch, _ in results for item in batch]
    reports = [report for _, report in results]
    return items, reports
