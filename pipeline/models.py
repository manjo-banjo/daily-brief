"""Data shapes shared by every pipeline step (checked by pydantic)."""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Source(BaseModel):
    id: str
    name: str
    topic: str
    also: List[str] = Field(default_factory=list)
    subtopic: Optional[str] = None
    type: str = "rss"  # rss | guardian | hackernews
    url: str
    section: Optional[str] = None
    weight: float = Field(default=0.5, ge=0, le=1)
    access: str = "full"  # full | headline_only
    feed_order: Optional[str] = None  # "editorial" when feed position signals importance
    require_keywords: List[str] = Field(default_factory=list)
    enabled: bool = True
    reason: Optional[str] = None


class Subtopic(BaseModel):
    slots: Optional[int] = None
    keywords: List[str] = Field(default_factory=list)


class Topic(BaseModel):
    label: str
    slots: int
    min_slots: Optional[int] = None
    second_slot_min_score: Optional[float] = None
    min_keyword_hits: int = 0
    thin_fallback: Optional[str] = None
    priority_keywords: List[str] = Field(default_factory=list)
    exclude_title_keywords: List[str] = Field(default_factory=list)
    demote_title_keywords: List[str] = Field(default_factory=list)
    demote_penalty: Optional[float] = None  # overrides settings.demote_penalty for this topic
    same_source_penalty: Optional[float] = None
    priority_sources: List[str] = Field(default_factory=list)  # source ids that get a boost and one guaranteed slot
    priority_source_boost: float = 0.0
    significance_keywords: List[str] = Field(default_factory=list)  # top headlines: words that signal a major story
    coverage_saturation: int = 3  # top headlines: other outlets carrying the story for full marks
    lens: str = ""  # what the summary step should look for in this topic
    concepts: Dict[str, str] = Field(default_factory=dict)  # primer concept id -> label
    access_note: bool = False  # macro: add a "how this can be accessed" note to each story
    market_idea: bool = False  # macro: the LLM writes one market idea from the day's stories
    subtopics: Dict[str, Subtopic] = Field(default_factory=dict)


class ScoreWeights(BaseModel):
    source: float
    recency: float
    keyword: float


class Settings(BaseModel):
    max_age_hours: float = 36
    title_similarity: float = 0.85
    slot_similarity: float = 0.55
    score_weights: ScoreWeights
    keyword_saturation: int = 6
    priority_boost: float = 0.1
    runners_up: int = 5
    same_source_penalty: float = 0.05
    demote_penalty: float = 0.15
    same_subtopic_penalty: float = 0.0
    exclude_title_keywords: List[str] = Field(default_factory=list)


class Item(BaseModel):
    """One normalised story: the output of the fetch step."""

    title: str
    url: str
    source_id: str
    source: str
    published: Optional[datetime] = None
    text: str = ""
    access: str = "full"
    position: int = 0  # place in the feed, 0 = first

    # Filled in by the rank step.
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    keyword_hits: int = 0
    matched_keywords: List[str] = Field(default_factory=list)
    score: float = 0.0
    score_parts: Dict[str, float] = Field(default_factory=dict)


class SourceReport(BaseModel):
    id: str
    name: str
    topic: str
    ok: bool
    items: int = 0
    via: str = ""
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# The published brief: data/daily/YYYY-MM-DD.json (schema checked before every write).

class Concept(BaseModel):
    id: str
    label: str


class BriefStory(BaseModel):
    id: str
    topic: str
    subtopic: Optional[str] = None
    title: str = Field(min_length=1)
    url: str = Field(pattern=r"^https?://")
    source: str
    published: Optional[datetime] = None
    headline_only: bool = True  # true until a valid summary is attached
    summary: Optional[str] = None
    why_it_matters: Optional[str] = None
    access_note: Optional[str] = None  # macro only
    concept: Optional[Concept] = None


class MarketIdea(BaseModel):
    id: str = "idea"
    topic: str
    title: str = Field(min_length=1)
    based_on: str  # story id
    url: str
    source: str
    what_the_trade_is: str = Field(min_length=1)
    how_it_is_expressed: str = Field(min_length=1)
    retail_access: str = Field(min_length=1)
    what_makes_it_work: str = Field(min_length=1)
    what_breaks_it: str = Field(min_length=1)
    concept: Optional[Concept] = None
    disclaimer: str = "An explanation of a trade in the news, not a recommendation."


class Question(BaseModel):
    id: str
    story_id: str
    topic: str
    question: str = Field(min_length=1)
    options: List[str] = Field(min_length=4, max_length=4)
    answer: int = Field(ge=0, le=3)  # index of the correct option
    explanation: str = Field(min_length=1)
    evidence: str = Field(min_length=1)  # the words in the summary that state the answer
    tests: str = "fact"  # why | fact
    concept: Optional[Concept] = None


class TopicInfo(BaseModel):
    id: str
    label: str


class LLMInfo(BaseModel):
    provider: str
    model: str
    calls: int = 0


class DailyBrief(BaseModel):
    date: str
    generated_at: str
    edition: str = "daily"
    status: str  # full | partial | headlines_only
    read_minutes: int = 0
    topics: List[TopicInfo]
    stories: List[BriefStory]
    market_idea: Optional[MarketIdea] = None
    quiz: List[Question] = Field(default_factory=list)
    llm: LLMInfo
    issues: List[str] = Field(default_factory=list)  # what degraded and why
