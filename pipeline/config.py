"""Load and check config/sources.yaml and config/topics.yaml."""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple

import yaml

from .models import Settings, Source, Topic

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"


def load_topics() -> Tuple[Settings, Dict[str, Topic]]:
    raw = yaml.safe_load((CONFIG_DIR / "topics.yaml").read_text(encoding="utf-8"))
    settings = Settings(**raw["settings"])
    topics = {key: Topic(**value) for key, value in raw["topics"].items()}
    return settings, topics


def load_sources(topics: Dict[str, Topic]) -> List[Source]:
    raw = yaml.safe_load((CONFIG_DIR / "sources.yaml").read_text(encoding="utf-8"))
    sources = [Source(**entry) for entry in raw["sources"]]
    seen = set()
    for source in sources:
        if source.id in seen:
            raise ValueError(f"sources.yaml: duplicate id '{source.id}'")
        seen.add(source.id)
        for topic in [source.topic] + source.also:
            if topic not in topics:
                raise ValueError(f"sources.yaml: '{source.id}' uses unknown topic '{topic}'")
    return sources
