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
