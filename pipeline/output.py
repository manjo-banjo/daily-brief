"""Step 8 — assemble the brief, check it against the schema, write it, archive the quiz, prune."""
from __future__ import annotations

import hashlib
import json
import math
from datetime import date as Date
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .llm import LLM
from .models import BriefStory, DailyBrief, Item, LLMInfo, MarketIdea, Question, Topic, TopicInfo
from .text import canonical_url

KEEP_DAYS = 7
WORDS_PER_MINUTE = 200


def build_stories(selected: Dict[str, List[Item]]) -> Tuple[List[BriefStory], Dict[str, str]]:
    """Ranked items -> brief stories (headline and link only for now) plus their feed text by id."""
    stories: List[BriefStory] = []
    texts: Dict[str, str] = {}
    for topic_id, items in selected.items():
        for item in items:
            story_id = "s" + hashlib.sha1(canonical_url(item.url).encode("utf-8")).hexdigest()[:8]
            stories.append(BriefStory(id=story_id, topic=topic_id, subtopic=item.subtopic, title=item.title,
                                      url=item.url, source=item.source, published=item.published))
            if item.access != "headline_only":
                texts[story_id] = item.text
    return stories, texts


def headlines_only(stories: List[BriefStory]) -> List[BriefStory]:
    keep = {"id", "topic", "subtopic", "title", "url", "source", "published"}
    return [BriefStory(**s.model_dump(include=keep)) for s in stories]


def _read_minutes(stories: List[BriefStory], idea: Optional[MarketIdea]) -> int:
    words = 0
    for s in stories:
        words += sum(len(t.split()) for t in (s.title, s.summary, s.why_it_matters, s.access_note) if t)
    if idea:
        words += sum(len(str(v).split()) for v in idea.model_dump(exclude={"id", "topic", "based_on", "url"}).values() if v)
    return max(1, math.ceil(words / WORDS_PER_MINUTE))


def build_brief(
    date: str, generated_at: str, topics: Dict[str, Topic], stories: List[BriefStory],
    idea: Optional[MarketIdea], quiz: List[Question], llm: LLM, issues: List[str],
) -> DailyBrief:
    """Raises pydantic.ValidationError if the result does not match the schema."""
    if not any(not s.headline_only for s in stories):
        status = "headlines_only"
    else:
        status = "partial" if issues else "full"
    brief = DailyBrief(
        date=date, generated_at=generated_at, status=status,
        read_minutes=_read_minutes(stories, idea),
        topics=[TopicInfo(id=key, label=topic.label) for key, topic in topics.items()],
        stories=stories, market_idea=idea, quiz=quiz,
        llm=LLMInfo(provider=llm.provider, model=llm.model, calls=llm.calls), issues=issues,
    )
    # Round-trip so every nested value is re-checked, including ones set after creation.
    return DailyBrief.model_validate(brief.model_dump())


def _dump(data: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_daily(brief: DailyBrief, directory: Path) -> Path:
    path = directory / f"{brief.date}.json"
    _dump(brief.model_dump(mode="json"), path)
    return path


def append_archive(brief: DailyBrief, directory: Path) -> Path:
    """Monthly file: headlines, links and the quiz. No summaries. A rerun replaces the day."""
    path = directory / f"{brief.date[:7]}.json"
    archive = {"month": brief.date[:7], "days": []}
    if path.exists():
        try:
            archive = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            pass
    stories = {s.id: s for s in brief.stories}
    idea = brief.market_idea

    def origin(story_id: str) -> dict:
        if idea is not None and story_id == idea.id:
            return {"headline": idea.title, "url": idea.url, "source": idea.source}
        story = stories[story_id]
        return {"headline": story.title, "url": story.url, "source": story.source}

    day = {
        "date": brief.date,
        "stories": [{"id": s.id, "topic": s.topic, "headline": s.title, "url": s.url, "source": s.source}
                    for s in brief.stories],
        "questions": [{**q.model_dump(mode="json", exclude={"evidence", "tests"}), **origin(q.story_id)}
                      for q in brief.quiz],
    }
    days = [d for d in archive.get("days", []) if d.get("date") != brief.date] + [day]
    archive["days"] = sorted(days, key=lambda d: d["date"])
    _dump(archive, path)
    return path


def prune_daily(directory: Path, today: str, keep_days: int = KEEP_DAYS) -> List[str]:
    """Delete daily files more than `keep_days` days old. Returns the names removed."""
    removed = []
    for path in sorted(directory.glob("*.json")):
        try:
            age = (Date.fromisoformat(today) - Date.fromisoformat(path.stem)).days
        except ValueError:
            continue
        if age > keep_days:
            path.unlink()
            removed.append(path.name)
    return removed
