"""Step 9 (notify) — push "today's brief is ready" to the phone through ntfy.sh.

    python -m pipeline.notify

Reads the newest data/daily file. The topic name comes from the NTFY_TOPIC secret and is never
printed. SITE_URL (optional) makes the notification open the app when tapped.
A failed push is reported as a warning; it never fails the job.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date as Date

import httpx

from .config import ROOT


def main() -> int:
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        print("::warning::NTFY_TOPIC is not set; no push sent")
        return 0
    files = sorted((ROOT / "data" / "daily").glob("*.json"))
    if not files:
        print("::warning::no daily brief found; no push sent")
        return 0
    brief = json.loads(files[-1].read_text(encoding="utf-8"))
    day = Date.fromisoformat(brief["date"]).strftime("%a %d %b").replace(" 0", " ")
    stories, questions = len(brief["stories"]), len(brief["quiz"])
    if brief["status"] == "headlines_only":
        message = f"Headlines only today: {stories} stories, no quiz."
    else:
        message = f"{stories} stories, {questions} questions, about {brief['read_minutes']} min."
    body = {"topic": topic, "title": f"Daily brief: {day}", "message": message, "tags": ["newspaper"]}
    site = os.environ.get("SITE_URL", "").strip()
    if site:
        body["click"] = site
    try:
        response = httpx.post("https://ntfy.sh/", json=body, timeout=20.0)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        status = getattr(getattr(exc, "response", None), "status_code", "")
        print(f"::warning::ntfy push failed ({type(exc).__name__} {status})")
        return 0
    print(f"Push sent: {message}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
