"""Step 7 — checks on what the LLM returns. Each check gives back clean fields or a reason.

The schema check on the finished brief is the DailyBrief model in models.py; these functions
check the content rules pydantic cannot: sentence counts, known concept tags and, for the quiz,
that the answer is stated in the text the reader saw.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from .models import Topic

MAX_SUMMARY_SENTENCES = 5   # the prompt asks for 3; sentence counting is approximate ("U.S." etc.)
MAX_WHY_WORDS = 45          # the prompt asks for 30
MAX_EVIDENCE_WORDS = 60     # the prompt asks for 40
LONGEST_RATIO = 1.2         # tell: the correct option is this much longer than any wrong one...
LONGEST_MIN_CHARS = 10      # ...and by at least this many characters
COPIED_RUN_WORDS = 5        # tell: the correct option lifts this many words in a row from the text
IDEA_FIELDS = ["title", "what_the_trade_is", "how_it_is_expressed", "retail_access",
               "what_makes_it_work", "what_breaks_it"]

_SENTENCE_END = re.compile(r"[.!?][\"'”’)]*(?:\s+|$)")
_SPACE = re.compile(r"\s+")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_BANNED_OPTION = re.compile(r"\b(all|none|both) of the above\b|\ball of these\b|\bnone of these\b", re.I)
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "})


def _text(value) -> str:
    return _SPACE.sub(" ", value).strip() if isinstance(value, str) else ""


def sentence_count(text: str) -> int:
    return len(_SENTENCE_END.findall(text.strip() + " ")) or (1 if text.strip() else 0)


def _concept(value, topic: Topic) -> Optional[str]:
    """An unknown concept tag is dropped, not treated as an error."""
    return value if isinstance(value, str) and value in topic.concepts else None


def check_summary(raw: dict, topic: Topic) -> Tuple[Optional[dict], str]:
    summary, why = _text(raw.get("summary")), _text(raw.get("why_it_matters"))
    if not summary:
        return None, "summary is empty"
    if sentence_count(summary) > MAX_SUMMARY_SENTENCES:
        return None, f"summary has more than {MAX_SUMMARY_SENTENCES} sentences"
    if not why:
        return None, "why_it_matters is empty"
    if len(why.split()) > MAX_WHY_WORDS:
        return None, f"why_it_matters is over {MAX_WHY_WORDS} words"
    fields = {"summary": summary, "why_it_matters": why, "concept": _concept(raw.get("concept"), topic)}
    if topic.access_note:
        note = _text(raw.get("access_note"))
        if not note:
            return None, "access_note is empty"
        fields["access_note"] = note
    return fields, ""


def check_market_idea(raw, story_ids: List[str], topic: Topic) -> Tuple[Optional[dict], str]:
    if not isinstance(raw, dict):
        return None, "market_idea is missing"
    if raw.get("based_on") not in story_ids:
        return None, "market_idea.based_on is not one of the story ids"
    fields: Dict[str, Optional[str]] = {"based_on": raw["based_on"]}
    for name in IDEA_FIELDS:
        value = _text(raw.get(name))
        if not value:
            return None, f"market_idea.{name} is empty"
        fields[name] = value
    fields["concept"] = _concept(raw.get("concept"), topic)
    return fields, ""


def _normalise(text: str) -> str:
    return _SPACE.sub(" ", text.translate(_QUOTES).lower()).strip()


def evidence_in_text(evidence: str, text: str) -> bool:
    """True when the quoted evidence appears word for word in the text the reader saw.
    An ellipsis in the quote splits it into parts that must each appear."""
    haystack = _normalise(text)
    parts = [p.strip(" \"'.,;:") for p in re.split(r"\.{3}|…", _normalise(evidence))]
    parts = [p for p in parts if p]
    return bool(parts) and all(p in haystack for p in parts)


def _numbers(text: str) -> List[str]:
    return [n.replace(",", "") for n in _NUMBER.findall(text)]


def check_question(raw: dict, text: str) -> Tuple[Optional[dict], str]:
    """`text` is exactly what the reader saw for the story (summary, why it matters, notes)."""
    question, explanation = _text(raw.get("question")), _text(raw.get("explanation"))
    evidence = _text(raw.get("evidence"))
    options = raw.get("options")
    answer = raw.get("answer")
    if not question:
        return None, "question is empty"
    if not isinstance(options, list) or len(options) != 4 or not all(_text(o) for o in options):
        return None, "needs exactly 4 non-empty options"
    options = [_text(o) for o in options]
    if len({o.lower().rstrip(".") for o in options}) != 4:
        return None, "options are not all different"
    if any(_BANNED_OPTION.search(o) for o in options):
        return None, "uses an 'all/none of the above' option"
    if isinstance(answer, bool) or not isinstance(answer, int) or not 0 <= answer <= 3:
        return None, "answer must be an index from 0 to 3"
    if not explanation:
        return None, "explanation is empty"
    if not evidence or len(evidence.split()) > MAX_EVIDENCE_WORDS:
        return None, "evidence is empty or too long"
    if not evidence_in_text(evidence, text):
        return None, "evidence is not a word-for-word quote from the item text, so the answer is not shown to be stated there"
    missing = [n for n in _numbers(options[answer]) if n not in _numbers(text)]
    if missing:
        return None, f"the correct option uses a number that is not in the item text ({', '.join(missing)})"
    tests = raw.get("tests") if raw.get("tests") in ("why", "fact") else "fact"
    return {"question": question, "options": options, "answer": answer,
            "explanation": explanation, "evidence": evidence, "tests": tests}, ""


def _words(text: str) -> List[str]:
    return re.findall(r"[a-z0-9']+", _normalise(text))


def question_tell(fields: dict, text: str) -> str:
    """A giveaway that lets the reader pick the answer without understanding the story; empty when
    there is none. These are style faults, not errors: the quiz step asks once for a rewrite and
    keeps the question if the rewrite is no better."""
    options, answer = fields["options"], fields["answer"]
    longest_wrong = max(len(o) for i, o in enumerate(options) if i != answer)
    if (len(options[answer]) > LONGEST_RATIO * longest_wrong
            and len(options[answer]) - longest_wrong >= LONGEST_MIN_CHARS):
        return ("the correct option is clearly the longest of the four; shorten it or lengthen the "
                "wrong options so all four are about the same length")
    haystack = " " + " ".join(_words(text)) + " "
    right = _words(options[answer])
    for start in range(len(right) - COPIED_RUN_WORDS + 1):
        if " " + " ".join(right[start:start + COPIED_RUN_WORDS]) + " " in haystack:
            return ("the correct option copies a run of words from the item text; say the same idea "
                    "in different words, so the question tests understanding and not recognition")
    return ""
