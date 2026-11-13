"""Small text helpers shared by the filter and rank steps."""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from functools import lru_cache
from typing import FrozenSet
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_TRACKING = re.compile(r"^(utm_|at_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|cmp$|CMP$)")
_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an the and or of to in on for at by with from as is are was were be it its "
    "that this after over says say said new how why what".split()
)


@lru_cache(maxsize=None)
def keyword_pattern(keyword: str) -> "re.Pattern[str]":
    """Whole-word matcher. Short or all-caps keywords (AI, Fed, UK, Xi) are case-sensitive
    so that 'fed' the verb or 'ai' inside another word never counts."""
    case_sensitive = keyword.isupper() or (len(keyword) <= 4 and keyword[:1].isupper())
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.compile(r"(?<!\w)" + re.escape(keyword) + r"(?!\w)", flags)


def canonical_url(url: str) -> str:
    """Same article, same string: drop tracking parameters, fragments and trailing slashes."""
    parts = urlsplit(url.strip())
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _TRACKING.match(k)]
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return urlunsplit(("https", host, parts.path.rstrip("/"), urlencode(query), ""))


def clean_url(url: str) -> str:
    """The link we publish: original address minus tracking parameters and fragment."""
    parts = urlsplit(url.strip())
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _TRACKING.match(k)]
    path = re.sub(r"/{2,}", "/", parts.path)
    return urlunsplit((parts.scheme, parts.netloc, path, urlencode(query), ""))


def title_tokens(title: str) -> FrozenSet[str]:
    return frozenset(w for w in _WORD.findall(title.lower()) if w not in _STOP)


def title_similarity(a: str, b: str) -> float:
    """0–1. Word overlap first (cheap); character comparison only for plausible pairs."""
    ta, tb = title_tokens(a), title_tokens(b)
    if not ta or not tb:
        return 0.0
    jaccard = len(ta & tb) / len(ta | tb)
    if jaccard < 0.3:
        return jaccard
    ratio = SequenceMatcher(None, " ".join(sorted(ta)), " ".join(sorted(tb))).ratio()
    return max(jaccard, ratio)


# Words too common in headlines to show two stories are about the same event.
_EVENT_STOP = _STOP | frozenset(
    "news live update updates latest report reports reported could would will may "
    "more most than into amid about back first year years week day today market markets "
    "million billion percent says analysts expected weighs hits".split()
)


@lru_cache(maxsize=None)
def event_tokens(title: str, url: str) -> FrozenSet[str]:
    """Distinctive words from the headline and the readable part of the URL, lightly stemmed."""
    words = list(_WORD.findall(title.lower()))
    slug = urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]
    if slug.count("-") >= 2:  # real slugs, not opaque ids like c95y15830k77o
        words += re.findall(r"[a-z]+", re.sub(r"\.(html?|aspx?|php)$", "", slug.lower()))
    tokens = set()
    for word in words:
        if word in _EVENT_STOP or len(word) < 3 or word.isdigit():
            continue
        if len(word) > 4 and word.endswith("s"):
            word = word[:-1]
        tokens.add(word)
    return frozenset(tokens)


def _is_title_case(title: str) -> bool:
    """US-style headlines capitalise nearly every word, so capitals there say nothing."""
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'’]+", title) if len(w) > 3]
    return len(words) >= 3 and sum(w[0].isupper() for w in words) / len(words) >= 0.8


@lru_cache(maxsize=None)
def name_tokens(title: str) -> FrozenSet[str]:
    """Words in a headline that look like names (Nvidia, Huang, Lloyd's): capitalised and not the
    first word. Empty for headlines written in title case, where that test cannot work."""
    if _is_title_case(title):
        return frozenset()
    names = set()
    for word in re.findall(r"[A-Za-z0-9]+", title)[1:]:
        if word[0].isupper():
            lower = word.lower()
            if lower in _EVENT_STOP or len(lower) < 3:
                continue
            names.add(lower[:-1] if len(lower) > 4 and lower.endswith("s") else lower)
    return frozenset(names)


def big_story_markers(headlines, min_outlets: int) -> FrozenSet[str]:
    """Names carried in the headlines of at least `min_outlets` different outlets today: the
    mark of one dominant event (a chief executive's exit, a global outage). `headlines` is an
    iterable of (title, source id). 0 switches the rule off."""
    if min_outlets <= 0:
        return frozenset()
    outlets, as_name, plain = {}, {}, {}
    for title, source_id in headlines:
        tokens = event_tokens(title, "")
        names = name_tokens(title)
        title_case = _is_title_case(title)
        for token in tokens:
            outlets.setdefault(token, set()).add(source_id)
            if token in names:
                as_name[token] = as_name.get(token, 0) + 1
            elif not title_case:
                plain[token] = plain.get(token, 0) + 1
    return frozenset(t for t, seen in outlets.items()
                     if len(seen) >= min_outlets and as_name.get(t, 0) > plain.get(t, 0))


def same_event(title_a: str, url_a: str, title_b: str, url_b: str,
               markers: FrozenSet[str] = frozenset()) -> bool:
    """True when two stories are very likely about one news event: at least two distinctive
    words in common, making up 40%+ of the shorter story's words; or both headlines carry the
    name of one of today's big stories (`markers`), however differently they are worded."""
    ta, tb = event_tokens(title_a, url_a), event_tokens(title_b, url_b)
    common = ta & tb
    if len(common) >= 2 and len(common) / min(len(ta), len(tb)) >= 0.4:
        return True
    return bool(markers and common & markers
                and event_tokens(title_a, "") & event_tokens(title_b, "") & markers)
