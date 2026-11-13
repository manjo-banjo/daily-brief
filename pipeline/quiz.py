"""Step 6 — one LLM call writes one multiple-choice question per summarised story (and one for
the market idea). Questions that fail validation get one retry; any still failing are dropped.
A valid question with a giveaway (the correct option is the longest, or copies the text) also
gets the one retry, but is kept if the rewrite is no better.

Review-queue questions are not added here: which questions were missed is known only on the
phone, so the app draws them from the quiz archive.
"""
from __future__ import annotations

import json
import random
from typing import Dict, List, Optional, Tuple

from .config import ROOT
from .llm import LLM, LLMError, LLMFatal
from .models import BriefStory, MarketIdea, Question
from .validate import check_question, question_tell

MAX_TOKENS = 3500


def reader_text(story: BriefStory) -> str:
    """Exactly what the reader sees for a story; quiz answers must be stated here."""
    text = f"{story.summary} Why it matters: {story.why_it_matters}"
    if story.access_note:
        text += f" How this can be accessed: {story.access_note}"
    return text


def idea_text(idea: MarketIdea) -> str:
    return (f"Market idea: {idea.title}. What the trade is: {idea.what_the_trade_is} "
            f"How it is expressed: {idea.how_it_is_expressed} How a UK retail investor could access it: "
            f"{idea.retail_access} What makes it work: {idea.what_makes_it_work} "
            f"What breaks it: {idea.what_breaks_it}")


def _shuffle(fields: dict, seed: str) -> None:
    """Models favour some answer positions; a fixed-seed shuffle spreads the correct option."""
    order = list(range(4))
    random.Random(seed).shuffle(order)
    fields["options"] = [fields["options"][i] for i in order]
    fields["answer"] = order.index(fields["answer"])


def write_quiz(
    llm: LLM, date: str, stories: List[BriefStory], idea: Optional[MarketIdea],
) -> Tuple[List[Question], List[str]]:
    items: Dict[str, dict] = {}
    for story in stories:
        if not story.headline_only:
            items[story.id] = {"headline": story.title, "text": reader_text(story),
                               "topic": story.topic, "concept": story.concept}
    if idea is not None:
        items[idea.id] = {"headline": idea.title, "text": idea_text(idea),
                          "topic": idea.topic, "concept": idea.concept}
    if not items:
        return [], []

    system = (ROOT / "prompts" / "quiz.txt").read_text(encoding="utf-8")
    done: Dict[str, Question] = {}
    errors: Dict[str, str] = {}
    spare: Dict[str, Question] = {}   # valid questions with a giveaway, used if the retry fails

    for attempt in (1, 2):
        todo = [key for key in items if key not in done]
        if not todo:
            break
        user = json.dumps({"items": [{"id": k, "headline": items[k]["headline"], "text": items[k]["text"]}
                                     for k in todo]}, ensure_ascii=False)
        if errors:
            user += ("\n\nYour previous questions for these items were rejected. Fix these problems:\n- "
                     + "\n- ".join(f"{k}: {v}" for k, v in errors.items()))
        errors = {}
        try:
            reply = llm.complete_json(system, user, MAX_TOKENS)
        except LLMFatal as exc:  # a retry cannot fix it
            errors = {k: f"call failed: {exc}" for k in todo}
            break
        except LLMError as exc:
            errors = {k: f"call failed: {exc}" for k in todo}
            continue
        rows = reply.get("questions")
        for raw in rows if isinstance(rows, list) else []:
            key = raw.get("story_id") if isinstance(raw, dict) else None
            if key not in todo or key in done:
                continue
            fields, error = check_question(raw, items[key]["text"])
            if fields is None:
                errors[key] = error
                continue
            tell = question_tell(fields, items[key]["text"])
            question_id = f"{date}-{key}"
            _shuffle(fields, question_id)
            question = Question(id=question_id, story_id=key, topic=items[key]["topic"],
                                concept=items[key]["concept"], **fields)
            if tell and attempt == 1:
                spare[key] = question
                errors[key] = tell
            else:
                done[key] = question
        for key in todo:
            if key not in done and key not in errors:
                errors[key] = "no question in the answer"

    for key, question in spare.items():   # the rewrite failed or never came: the first version stands
        if key not in done:
            done[key] = question
            errors.pop(key, None)

    questions = [done[key] for key in items if key in done]
    issues = [f"Quiz: no valid question for '{items[k]['headline'][:60]}' ({v})" for k, v in errors.items()]
    return questions, issues
