"""Step 4 — tag each item to a topic and sub-topic, score it, and fill the daily slots."""
from __future__ import annotations

from datetime import datetime
from typing import Dict, FrozenSet, List, Optional, Tuple

from .models import Item, Settings, Source, Topic
from .text import big_story_markers, keyword_pattern, same_event, title_similarity

TOP = "top_headlines"
MAX_DEDUPE_ROUNDS = 20       # safety stop for the cross-topic duplicate loop


def _count_hits(item: Item, keywords: List[str]) -> Tuple[int, List[str]]:
    """Title match counts 2, text match counts 1; each keyword counts once."""
    hits, matched = 0, []
    for keyword in keywords:
        pattern = keyword_pattern(keyword)
        if pattern.search(item.title):
            hits += 2
            matched.append(keyword)
        elif item.text and pattern.search(item.text):
            hits += 1
            matched.append(keyword)
    return hits, matched


def _topic_match(item: Item, topic: Topic) -> Tuple[int, Optional[str], List[str]]:
    """Total hits for a topic, its best sub-topic, and the keywords that matched."""
    total, best_sub, best_hits, matched_all = 0, None, 0, []
    for name, sub in topic.subtopics.items():
        hits, matched = _count_hits(item, sub.keywords)
        total += hits
        matched_all.extend(m for m in matched if m not in matched_all)
        if hits > best_hits:
            best_sub, best_hits = name, hits
    return total, best_sub, matched_all


def tag(item: Item, source: Source, topics: Dict[str, Topic]) -> None:
    """Pick the topic (home topic or one of the source's `also` topics) whose keywords fit best."""
    best: Optional[Tuple[int, str, Optional[str], List[str]]] = None
    for name in [source.topic] + source.also:
        topic = topics[name]
        if any(keyword_pattern(k).search(item.title) for k in topic.exclude_title_keywords):
            continue
        hits, subtopic, matched = _topic_match(item, topic)
        if hits < topic.min_keyword_hits:
            continue
        if best is None or hits > best[0]:
            best = (hits, name, subtopic, matched)
    if best is None:
        return
    item.keyword_hits, item.topic, subtopic, item.matched_keywords = best
    item.subtopic = subtopic or (source.subtopic if item.topic == source.topic else None)


def _recency(item: Item, now: datetime, settings: Settings) -> float:
    age_hours = max(0.0, (now - item.published).total_seconds() / 3600)
    return max(0.0, 1.0 - age_hours / settings.max_age_hours)


def _same(a: Item, b: Item, markers: FrozenSet[str]) -> bool:
    return same_event(a.title, a.url, b.title, b.url, markers)


def _is_policy_release(item: Item, topic: Topic) -> bool:
    """A priority-source item that earns the boost and the guaranteed slot: with no keyword list
    every item does; with one, only items whose title carries a keyword (a rate decision, minutes,
    a stability report), so routine notices compete like any other story."""
    if item.source_id not in topic.priority_sources:
        return False
    return (not topic.priority_title_keywords
            or any(keyword_pattern(k).search(item.title) for k in topic.priority_title_keywords))


def _coverage(item: Item, all_items: List[Item], markers: FrozenSet[str] = frozenset()) -> int:
    """How many other outlets carry the same event: independent coverage is the best
    available sign of significance before the LLM step exists."""
    return len({o.source_id for o in all_items
                if o.source_id != item.source_id and _same(item, o, markers)})


def score(item: Item, source: Source, topic: Topic, settings: Settings, now: datetime,
          coverage: int = 0) -> None:
    weights = settings.score_weights
    if item.topic == TOP:
        # No topic keywords for top headlines. Significance = how many other outlets carry the
        # story (70%) plus significance keywords (30%). The outlet's running order is not used.
        sig_hits, _ = _count_hits(item, topic.significance_keywords)
        relevance = (0.7 * min(1.0, coverage / max(1, topic.coverage_saturation))
                     + 0.3 * min(1.0, sig_hits / 4))
    else:
        relevance = min(1.0, item.keyword_hits / settings.keyword_saturation)
    parts = {
        "source": round(weights.source * source.weight, 3),
        "recency": round(weights.recency * _recency(item, now, settings), 3),
        "keyword": round(weights.keyword * relevance, 3),
    }
    if topic.priority_keywords and any(
        keyword_pattern(k).search(item.title + " " + item.text) for k in topic.priority_keywords
    ):
        parts["priority"] = settings.priority_boost
    if _is_policy_release(item, topic):
        parts["priority_source"] = topic.priority_source_boost
    elif source.id in topic.priority_sources and topic.routine_release_penalty:
        parts["routine_release"] = -topic.routine_release_penalty
    if any(keyword_pattern(k).search(item.title) for k in topic.demote_title_keywords):
        penalty = settings.demote_penalty if topic.demote_penalty is None else topic.demote_penalty
        parts["demoted"] = -penalty
    item.score_parts = parts
    item.score = round(sum(parts.values()), 3)


def _pick(pool: List[Item], count: int, chosen_all: List[Item], settings: Settings,
          min_score: float = 0.0, penalty: float = 0.0, already: Optional[List[Item]] = None,
          markers: FrozenSet[str] = frozenset()) -> List[Item]:
    """Greedy: best score first, skipping near-repeats of stories already chosen today."""
    picked: List[Item] = []
    remaining = list(pool)
    while remaining and len(picked) < count:
        def adjusted(candidate: Item) -> float:
            same = sum(1 for p in picked + (already or []) if p.source_id == candidate.source_id)
            same_sub = sum(1 for p in picked + (already or [])
                           if candidate.subtopic and p.subtopic == candidate.subtopic)
            return candidate.score - penalty * same - settings.same_subtopic_penalty * same_sub
        remaining.sort(key=adjusted, reverse=True)
        candidate = remaining.pop(0)
        if candidate.score < min_score:
            break
        if any(candidate.url == c.url
               or title_similarity(candidate.title, c.title) >= settings.slot_similarity
               or _same(candidate, c, markers)
               for c in chosen_all + picked):
            continue
        picked.append(candidate)
    return picked


def _allocate_topic(pool: List[Item], topic: Topic, chosen_all: List[Item], settings: Settings,
                    markers: FrozenSet[str] = frozenset()) -> List[Item]:
    penalty = settings.same_source_penalty if topic.same_source_penalty is None else topic.same_source_penalty
    picked: List[Item] = []

    def fill(candidates: List[Item], count: int, min_score: float = 0.0) -> None:
        rest = [i for i in candidates if i not in picked]
        picked.extend(_pick(rest, count, chosen_all + picked, settings,
                            min_score=min_score, penalty=penalty, already=list(picked),
                            markers=markers))

    slotted = {name: sub.slots for name, sub in topic.subtopics.items() if sub.slots}
    if slotted:
        for name, slots in slotted.items():
            fill([i for i in pool if i.subtopic == name], slots)
        if len(picked) < topic.slots and topic.thin_fallback:
            fill([i for i in pool if i.subtopic == topic.thin_fallback], topic.slots - len(picked))
        if len(picked) < topic.slots:
            fill(pool, topic.slots - len(picked))
        return picked

    if topic.priority_sources:  # a fresh policy release from a priority source always takes a slot
        fill([i for i in pool if _is_policy_release(i, topic)], 1)
    guaranteed = topic.min_slots if topic.min_slots is not None else topic.slots
    fill(pool, guaranteed - len(picked))
    if topic.slots > guaranteed:
        fill(pool, topic.slots - len(picked), min_score=topic.second_slot_min_score or 0.0)
    return picked


def _event_conflicts(selected: Dict[str, List[Item]], topics: Dict[str, Topic],
                     markers: FrozenSet[str] = frozenset()) -> List[Item]:
    """Stories picked under two topics for one event: returns the lower-scoring copy of each pair
    (on a tie, the one in the later topic), so the event stays where it scores highest."""
    order = {name: n for n, name in enumerate(topics)}
    flat = [(name, item) for name, picks in selected.items() for item in picks]
    losers: List[Item] = []
    for a in range(len(flat)):
        for b in range(a + 1, len(flat)):
            (ta, ia), (tb, ib) = flat[a], flat[b]
            if ta == tb or not _same(ia, ib, markers):
                continue
            loser = ia if (ia.score, -order[ta]) < (ib.score, -order[tb]) else ib
            if loser not in losers:
                losers.append(loser)
    return losers


def rank_and_allocate(
    items: List[Item],
    sources: Dict[str, Source],
    topics: Dict[str, Topic],
    settings: Settings,
    now: datetime,
) -> Tuple[Dict[str, List[Item]], Dict[str, List[Item]], int, int]:
    """Returns (selected per topic, runners-up per topic, untagged count, cross-topic duplicates removed)."""
    untagged = 0
    for item in items:
        source = sources[item.source_id]
        tag(item, source, topics)
        if item.topic is None:
            untagged += 1
        else:
            score(item, source, topics[item.topic], settings, now)

    # Names in many outlets' headlines mark today's dominant events; each of those fills one slot.
    markers = big_story_markers(((i.title, i.source_id) for i in items), settings.big_story_min_outlets)

    pools = {name: sorted((i for i in items if i.topic == name), key=lambda i: i.score, reverse=True)
             for name in topics if name != TOP}

    # One event, one slot: allocate, find any event picked under two topics, ban the weaker copy
    # and allocate again until no event is repeated.
    banned: List[Item] = []
    for _ in range(MAX_DEDUPE_ROUNDS):
        selected: Dict[str, List[Item]] = {}
        chosen_all: List[Item] = []
        for name, pool in pools.items():
            live = [i for i in pool if i not in banned]
            selected[name] = _allocate_topic(live, topics[name], chosen_all, settings, markers)
            chosen_all += selected[name]
        losers = _event_conflicts(selected, topics, markers)
        if not losers:
            break
        banned += losers

    runners: Dict[str, List[Item]] = {}
    for name, pool in pools.items():
        rest = [i for i in pool if i not in selected[name] and i not in banned
                and not any(_same(i, c, markers) for c in chosen_all)]
        runners[name] = rest[: settings.runners_up]

    if TOP in topics:
        # Top headlines = the most significant stories not already picked above. Any item from a
        # general-news source is eligible, whatever topic it was tagged to. Topics above keep
        # their events; this one takes only what is left.
        pool = []
        for item in items:
            source = sources[item.source_id]
            if (TOP not in [source.topic] + source.also or item in chosen_all or item in banned
                    or any(_same(item, c, markers) for c in chosen_all)):
                continue
            candidate = item.model_copy(update={"topic": TOP, "subtopic": None,
                                                "keyword_hits": 0, "matched_keywords": []})
            score(candidate, source, topics[TOP], settings, now, coverage=_coverage(item, items, markers))
            pool.append(candidate)
        pool.sort(key=lambda i: i.score, reverse=True)
        selected[TOP] = _allocate_topic(pool, topics[TOP], chosen_all, settings, markers)
        runners[TOP] = [i for i in pool if i not in selected[TOP]
                        and not any(_same(i, c, markers) for c in selected[TOP])][: settings.runners_up]

    ordered = {name: selected.get(name, []) for name in topics}
    return ordered, runners, untagged, len(banned)
