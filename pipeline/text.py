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
        words += re.findall(r"[a-z]+", slug.lower())
    tokens = set()
    for word in words:
        if word in _EVENT_STOP or len(word) < 3 or word.isdigit():
            continue
        if len(word) > 4 and word.endswith("s"):
            word = word[:-1]
        tokens.add(word)
    return frozenset(tokens)


def same_event(title_a: str, url_a: str, title_b: str, url_b: str) -> bool:
    """True when two stories are very likely about one news event: at least two distinctive
    words in common, and those make up 40%+ of the shorter story's words."""
    ta, tb = event_tokens(title_a, url_a), event_tokens(title_b, url_b)
    shared = len(ta & tb)
    return shared >= 2 and shared / min(len(ta), len(tb)) >= 0.4
