"""Step 5 — one LLM call per topic writes each story's summary, "why it matters" line and
primer concept tag. Macro also gets an access note per story and the daily market idea.

A topic gets one retry. Whatever is still invalid after that stays headline and link only.
"""
from __future__ import annotations

import json
from typing import Dict, List, Optional, Tuple

from .config import ROOT
from .llm import LLM, LLMError, LLMFatal
from .models import BriefStory, Concept, MarketIdea, Topic
from .validate import check_market_idea, check_summary

PROMPTS = ROOT / "prompts"
MIN_TEXT_CHARS = 80      # less feed text than this cannot support a summary
MAX_TEXT_CHARS = 2500    # per story, keeps a topic call well inside the free-tier input limit
MAX_TOKENS = 2000


def _prompt(topic: Topic) -> str:
    story_shape = '{"id": "<story id>", "summary": "...", "why_it_matters": "...", "concept": "<concept id or null>"'
    if topic.access_note:
        story_shape += ', "access_note": "..."'
    shape = '{"stories": [' + story_shape + "}]"
    if topic.market_idea:
        shape += (', "market_idea": {"based_on": "<story id>", "title": "...", "what_the_trade_is": "...", '
                  '"how_it_is_expressed": "...", "retail_access": "...", "what_makes_it_work": "...", '
                  '"what_breaks_it": "...", "concept": "<concept id>"}')
    shape += "}"
    extra = ""
    if topic.access_note or topic.market_idea:
        extra = (PROMPTS / "summary_macro.txt").read_text(encoding="utf-8")
    concepts = "\n".join(f"- {key}: {label}" for key, label in topic.concepts.items()) or "- (none: always use null)"
    template = (PROMPTS / "summary.txt").read_text(encoding="utf-8")
    for name, value in {"topic_label": topic.label, "lens": topic.lens, "concepts": concepts,
                        "extra": extra, "shape": shape}.items():
        template = template.replace("{{" + name + "}}", value)
    return template


def _concept(topic: Topic, concept_id: Optional[str]) -> Optional[Concept]:
    return Concept(id=concept_id, label=topic.concepts[concept_id]) if concept_id else None


def summarise_topic(
    llm: LLM, topic_id: str, topic: Topic, stories: List[BriefStory], texts: Dict[str, str],
) -> Tuple[Optional[MarketIdea], List[str]]:
    """Fills in `stories` in place. Returns the market idea (macro only) and a list of issues."""
    ready = [s for s in stories if len(texts.get(s.id, "")) >= MIN_TEXT_CHARS]
    if not ready:
        return None, []
    by_id = {s.id: s for s in ready}
    system = _prompt(topic)
    payload = [{"id": s.id, "headline": s.title, "outlet": s.source, "text": texts[s.id][:MAX_TEXT_CHARS]}
               for s in ready]
    idea: Optional[MarketIdea] = None
    errors: List[str] = []

    for attempt in (1, 2):
        user = json.dumps({"stories": payload}, ensure_ascii=False)
        if errors:
            user += "\n\nYour previous answer was rejected. Fix these problems:\n- " + "\n- ".join(errors)
        errors = []
        try:
            reply = llm.complete_json(system, user, MAX_TOKENS)
        except LLMFatal as exc:  # a retry cannot fix it
            errors.append(f"call failed: {exc}")
            break
        except LLMError as exc:
            errors.append(f"call failed: {exc}")
            continue
        rows = reply.get("stories")
        for raw in rows if isinstance(rows, list) else []:
            story = by_id.get(raw.get("id")) if isinstance(raw, dict) else None
            if story is None or not story.headline_only:
                continue
            fields, error = check_summary(raw, topic)
            if fields is None:
                errors.append(f"story {story.id}: {error}")
                continue
            story.summary = fields["summary"]
            story.why_it_matters = fields["why_it_matters"]
            story.access_note = fields.get("access_note")
            story.concept = _concept(topic, fields["concept"])
            story.headline_only = False
        errors += [f"story {s.id}: missing from the answer" for s in ready
                   if s.headline_only and not any(e.startswith(f"story {s.id}:") for e in errors)]
        if topic.market_idea and idea is None:
            fields, error = check_market_idea(reply.get("market_idea"), list(by_id), topic)
            if fields is None:
                errors.append(error)
            else:
                base = by_id[fields.pop("based_on")]
                concept = _concept(topic, fields.pop("concept"))
                idea = MarketIdea(topic=topic_id, based_on=base.id, url=base.url, source=base.source,
                                  concept=concept, **fields)
        if not errors:
            break

    return idea, [f"{topic.label}: {e}" for e in errors]
